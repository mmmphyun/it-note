import type {
  ConsentVerificationRequest,
  ConsentVerificationResponse,
  ConsentSentiment,
} from '@itnote/shared';
import type { GoogleGenAI } from '@google/genai';
import { getGeminiClient } from './geminiClient';

// ponytail: official @google/genai SDK with structured output

const AFFIRMATIVE_REGEX = /^(동의|동의함|동의합니다|동의해요|네|예|ㅇㅇ|ㅇ|yes|y|ok|okay|sure|agree|agreed|좋아요|좋아|확인|승인|수락|찬성)$/i;
const DISAGREE_REGEX = /^(아니오|아니요|아니|거부|거절|싫어|싫어요|ㄴㄴ|ㄴ|no|nope|disagree|reject|반대|안해|취소)$/i;

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
 * Gemini 3.1 Flash Lite 기반 멀티모달 필기 인식 및 동의 의사 검증
 */
async function callGeminiConsentVerifier(
  imageBase64: string,
  ai: GoogleGenAI
): Promise<ConsentVerificationResponse | null> {
  const base64Data = imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');

  const prompt = `You are an AI handwriting verifier for It!note.
The user was asked the question: "개인정보 및 필기 데이터 활용에 동의하시나요?" (Do you agree to the collection and use of personal and handwriting data?)
Examine the user's handwritten response in the image.

Tasks:
1. Transcribe the handwriting as accurately as possible into Korean or English (e.g. "동의", "동의함", "동의합니다", "네", "ㅇㅇ", "yes", "거부", "아니오", "ㄴ", "ㄴㄴ", etc.).
2. Determine whether the user's answer is an affirmative agreement/consent to the question.
   - Affirmative consent ("AGREED"): "네", "예", "동의", "동의함", "동의합니다", "동의해요", "ㅇㅇ", "ㅇ", "yes", "y", "ok", "okay", "sure", "agree", "좋아요", "확인", "승인", "수락"
   - Rejection / refusal ("DISAGREED"): "아니오", "아니요", "아니", "거부", "거절", "싫어", "싫어요", "ㄴㄴ", "ㄴ", "no", "nope", "disagree", "안해", "반대"
   - Unclear / scribble ("UNCLEAR"): Random scribbles, scratches, single meaningless lines, emojis, geometric shapes, or completely unrelated words.`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-flash-lite',
    contents: [
      { text: prompt },
      { inlineData: { mimeType: 'image/png', data: base64Data } },
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          recognizedText: { type: 'STRING' },
          sentiment: { type: 'STRING', enum: ['AGREED', 'DISAGREED', 'UNCLEAR'] },
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
      parsed.sentiment === 'AGREED' || parsed.sentiment === 'DISAGREED' || parsed.sentiment === 'UNCLEAR'
        ? parsed.sentiment
        : 'UNCLEAR';

    return {
      isAgreed: sentiment === 'AGREED',
      recognizedText: String(parsed.recognizedText || '').trim(),
      sentiment,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.9,
      reason: parsed.reason ? String(parsed.reason) : undefined,
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

  return {
    isAgreed: false,
    recognizedText: text.trim(),
    sentiment: 'UNCLEAR',
    confidence: 0.5,
    reason: '동의 여부를 판별하기 어려운 답변입니다. (예: 동의, 네, yes)',
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
    recognizedText: '인식 불명',
    sentiment: 'UNCLEAR',
    confidence: 0.3,
    reason: '필기 답변을 명확히 인식할 수 없습니다. 동의 답변(예: 동의, 네, yes)을 다시 적어주세요.',
  };
}
