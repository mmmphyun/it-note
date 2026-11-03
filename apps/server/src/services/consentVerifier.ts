import type {
  ConsentVerificationRequest,
  ConsentVerificationResponse,
  ConsentSentiment,
} from '@itnote/shared';
import type { GoogleGenAI } from '@google/genai';
import { getGeminiClient } from './geminiClient';

// ponytail: official @google/genai SDK with structured output

const AFFIRMATIVE_REGEX = /^(동의|동의함|동의합니다|동의해요|네|예|ㅇㅇ|ㅇ|yes|y|ok|okay|sure|agree|agreed|좋아요|좋아|확인|승인|수락|찬성|o)$/i;
const DISAGREE_REGEX = /^(아니오|아니요|아니|거부|거절|싫어|싫어요|ㄴㄴ|ㄴ|no|nope|disagree|reject|반대|안해|취소|x)$/i;

/**
 * 필기 자필 서약 긍정/동의 여부 검증 서비스
 * LLM(Gemini Multimodal via @google/genai)을 통해 손글씨 이미지를 직접 읽고
 * '동의', '네', 'ㅇㅇ', 'yes' 등 긍정적 의사 표현인지 실시간 판정
 */
export async function verifyConsent(
  request: ConsentVerificationRequest
): Promise<ConsentVerificationResponse> {
  // 1. rawTextInput이 직접 주어진 경우 즉시 결정 규칙 적용 (테스트 및 폴백 지원)
  if (request.rawTextInput) {
    return evaluateTextSentiment(request.rawTextInput);
  }

  // 2. 획이 없는 빈 캔버스인 경우 즉시 불명확 반환
  if (request.strokeMetadata && request.strokeMetadata.strokeCount === 0) {
    return {
      isAgreed: false,
      recognizedText: '',
      sentiment: 'UNCLEAR',
      confidence: 0,
      reason: '필기 내용이 없습니다.',
    };
  }

  const ai = getGeminiClient();

  // 3. Gemini 클라이언트가 존재하는 경우 Multimodal 필기 인식 수행
  if (ai && request.imageBase64 && request.imageBase64.startsWith('data:image/')) {
    try {
      const geminiResult = await callGeminiConsentVerifier(request.imageBase64, ai);
      if (geminiResult) {
        return geminiResult;
      }
    } catch (err) {
      console.error('[ConsentVerifier] Gemini SDK call failed, falling back to heuristic:', err instanceof Error ? err.message : err);
    }
  }

  // 4. API 키가 없거나 외부 통신 실패 시 휴리스틱 폴백
  return fallbackHeuristicVerification(request);
}

/**
 * Gemini 3.5 Flash Lite 기반 멀티모달 필기 인식 및 동의 의사 검증
 */
async function callGeminiConsentVerifier(
  imageBase64: string,
  ai: GoogleGenAI
): Promise<ConsentVerificationResponse | null> {
  const mimeMatch = imageBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const base64Data = imageBase64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');

  const prompt = `You are an AI handwriting verifier for It!note.
The user was asked the question: "개인정보 및 필기 데이터 활용에 동의하시나요?" (Do you agree to the collection and use of personal and handwriting data?)
Examine the user's handwritten response in the image.

Tasks:
1. Transcribe the handwriting as accurately as possible into Korean or English (e.g. "동의", "몰라", "네", "ㅇㅇ", "yes", "거부", "아니오", "ㄴ", "X", "O", etc.). If completely illegible scribble or scratch, set recognizedText to "".
2. Classify the user's answer into ONE of the following 4 categories:
   - "AGREED": Clearly expresses affirmative consent (e.g. "동의", "동의함", "동의합니다", "네", "예", "ㅇㅇ", "ㅇ", "yes", "ok", "O")
   - "DISAGREED": Clearly expresses rejection or refusal (e.g. "아니오", "아니요", "아니", "거부", "거절", "싫어", "싫어요", "ㄴㄴ", "ㄴ", "no", "X")
   - "IRRELEVANT": The handwriting was clearly read, but is neither consent nor refusal (e.g. "몰라", "글쎄", "안녕", "배고파", "왜?", "사과", ambiguous hesitation or unrelated words)
   - "UNCLEAR": The handwriting cannot be transcribed at all (smudge, scribbles, scratches, single meaningless marks)
3. Write "reason" strictly in polite, concise Korean (한국어 1문장, 영어 절대 금지):
   - Example for AGREED: "동의 의사가 확인되었습니다."
   - Example for DISAGREED: "'아니오' 또는 거부 의사로 확인되었습니다."
   - Example for IRRELEVANT: "'인식된단어'(으)로 인식되었으나 동의 여부를 알 수 없는 답변입니다."
   - Example for UNCLEAR: "글씨를 명확히 판독하기 어렵습니다."`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.5-flash-lite',
    contents: [
      { text: prompt },
      { inlineData: { mimeType, data: base64Data } },
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          recognizedText: { type: 'STRING' },
          sentiment: { type: 'STRING', enum: ['AGREED', 'DISAGREED', 'IRRELEVANT', 'UNCLEAR'] },
          isAgreed: { type: 'BOOLEAN' },
          confidence: { type: 'NUMBER' },
          reason: { type: 'STRING' },
        },
        required: ['recognizedText', 'sentiment', 'isAgreed', 'confidence', 'reason'],
      },
    },
  });

  const rawJson = response.text;
  if (!rawJson) return null;

  try {
    const parsed = JSON.parse(rawJson);
    const sentiment: ConsentSentiment =
      parsed.sentiment === 'AGREED' ||
      parsed.sentiment === 'DISAGREED' ||
      parsed.sentiment === 'IRRELEVANT' ||
      parsed.sentiment === 'UNCLEAR'
        ? parsed.sentiment
        : 'UNCLEAR';

    let reason = parsed.reason ? String(parsed.reason).trim() : undefined;
    if (!reason || /[a-zA-Z]{3,}/.test(reason)) {
      if (sentiment === 'DISAGREED') {
        reason = `'${parsed.recognizedText || '거부'}' 의사로 확인되었습니다.`;
      } else if (sentiment === 'AGREED') {
        reason = `'${parsed.recognizedText || '동의'}' 의사가 확인되었습니다.`;
      } else if (sentiment === 'IRRELEVANT') {
        reason = `'${parsed.recognizedText || '해당 내용'}'(으)로 인식되었으나 동의 여부를 알 수 없는 답변입니다.`;
      } else {
        reason = '글씨를 명확히 판독하기 어렵습니다. 조금 더 또렷하게 적어주세요.';
      }
    }

    return {
      isAgreed: sentiment === 'AGREED',
      recognizedText: String(parsed.recognizedText || '').trim(),
      sentiment,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.9,
      reason,
    };
  } catch {
    return null;
  }
}

/**
 * 텍스트 기반 단어 판별 규칙
 */
export function evaluateTextSentiment(text: string): ConsentVerificationResponse {
  const cleaned = text.trim().replace(/[\s.,!?;~]+/g, '').toLowerCase();

  if (AFFIRMATIVE_REGEX.test(cleaned)) {
    return {
      isAgreed: true,
      recognizedText: text.trim(),
      sentiment: 'AGREED',
      confidence: 0.98,
      reason: '동의 의사가 명확히 확인되었습니다.',
    };
  }

  if (DISAGREE_REGEX.test(cleaned)) {
    return {
      isAgreed: false,
      recognizedText: text.trim(),
      sentiment: 'DISAGREED',
      confidence: 0.98,
      reason: '동의 거부 의사가 확인되었습니다.',
    };
  }

  // 부분 문자열 매칭 (예: "네 동의합니다", "저도 동의해요")
  if (
    cleaned.includes('동의') ||
    cleaned.includes('agree') ||
    cleaned.startsWith('네') ||
    cleaned.startsWith('예')
  ) {
    return {
      isAgreed: true,
      recognizedText: text.trim(),
      sentiment: 'AGREED',
      confidence: 0.9,
      reason: '긍정적인 동의 표현이 포함되어 있습니다.',
    };
  }

  // 글씨는 인식되었으나 Yes/No가 아닌 무관하거나 모호한 답변 (예: "몰라", "안녕", "글쎄")
  return {
    isAgreed: false,
    recognizedText: text.trim(),
    sentiment: 'IRRELEVANT',
    confidence: 0.85,
    reason: `'${text.trim()}'(으)로 인식되었으나 동의 여부를 알 수 없는 답변입니다.`,
  };
}

/**
 * 외부 AI 미연결 또는 테스트 환경용 휴리스틱 폴백
 */
function fallbackHeuristicVerification(
  request: ConsentVerificationRequest
): ConsentVerificationResponse {
  const strokeCount = request.strokeMetadata?.strokeCount ?? 0;

  if (strokeCount <= 0) {
    return {
      isAgreed: false,
      recognizedText: '',
      sentiment: 'UNCLEAR',
      confidence: 0,
      reason: '필기 내용이 없습니다.',
    };
  }

  // 필기 획만으로는 긍정 동의 여부를 단정할 수 없으므로 안전하게 UNCLEAR 및 비동의 처리
  return {
    isAgreed: false,
    recognizedText: '',
    sentiment: 'UNCLEAR',
    confidence: 0.3,
    reason: '글씨를 판독할 수 없습니다. 조금 더 또렷하게 적어주세요.',
  };
}
