import type {
  JevDecision,
  ExtractedKeywords,
  InferRequestBody,
  StrikethroughIntent,
  VisualStructure,
  DomainRoute,
  InputClassification,
  ActionTask,
  CandidateHypothesisPool,
  JevRerankerInput,
  JevRerankerResult,
} from '@itnote/shared';
import type { GoogleGenAI } from '@google/genai';
import { getGeminiClient } from './geminiClient';

// ponytail: official @google/genai SDK with structured output

export interface System1Output {
  decision: JevDecision;
  keywords: ExtractedKeywords;
}

/**
 * System 1: Jev / OpenJev (/v1/systemone) 규격 인터페이스
 * 자유 텍스트 대신 정형화된 의사결정 프리미티브(Noul, Choice, Box)만 산출
 */
export async function runSystem1Jev(request: InferRequestBody): Promise<System1Output> {
  if (process.env.NODE_ENV === 'test') {
    return runHeuristicSystem1(request);
  }

  const jevApiKey = process.env.JEV_API_KEY;
  const jevEndpoint = process.env.JEV_ENDPOINT_URL || 'https://api.jev.ai/v1/systemone';
  const ai = getGeminiClient();

  if (jevApiKey && jevEndpoint) {
    try {
      return await callJevEndpoint(request, jevEndpoint, jevApiKey);
    } catch {
      // Jev 실패 시 Gemini 또는 Heuristic Fallback
    }
  }

  if (ai) {
    try {
      return await callGeminiStructuredJev(request, ai);
    } catch (err) {
      console.error('[System 1 Jev Error]', err instanceof Error ? err.message : err);
      // Gemini 실패 시 Heuristic Fallback
    }
  }

  return runHeuristicSystem1(request);
}

/**
 * 1. OpenJev / Jev 원시 HTTP 엔드포인트 호출 어댑터
 */
async function callJevEndpoint(
  request: InferRequestBody,
  endpoint: string,
  apiKey: string
): Promise<System1Output> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      imageBase64: request.croppedImageBase64,
      strokeMetadata: request.strokeMetadata,
      previousEvaporatedContext: request.previousEvaporatedContext,
      activeHypothesisSentence: request.activeHypothesisSentence,
      rejectedHypotheses: request.rejectedHypotheses,
      userContext: request.userContext,
    }),
  });

  if (!res.ok) {
    throw new Error(`Jev API returned status ${res.status}`);
  }

  const data = (await res.json()) as { decision: JevDecision; keywords: ExtractedKeywords };
  return {
    decision: data.decision,
    keywords: data.keywords,
  };
}

/**
 * 2. Gemini Structured Output 어댑터 (공식 @google/genai SDK)
 */
async function callGeminiStructuredJev(
  request: InferRequestBody,
  ai: GoogleGenAI
): Promise<System1Output> {

  const prompt = `You are System 1 (Jev Decision Engine). Analyze the user's note input and metadata.
Determine the decision primitives (Noul, Choice, Box) and extract active/struck-out keywords.

Input:
- Raw Text Input: ${request.rawTextInput ?? 'None (Handwriting image provided)'}
- Previous Evaporated Context: ${request.previousEvaporatedContext ?? 'null'}
- Active Hypothesis on Screen: ${request.activeHypothesisSentence ?? 'null'}
- Rejected Hypotheses (marked X): ${JSON.stringify(request.rejectedHypotheses ?? [])}
- User Persona: ${JSON.stringify(request.userContext?.persona ?? {})}
- Evolving Topics: ${JSON.stringify(request.userContext?.evolvingTopics ?? [])}

Crucial Persona Policy:
- The user's explicit input content is the primary ground truth.
- A user's profession/role (e.g., developer, student) is only a secondary background hint.
- Developers write everyday notes too (e.g. coffee choice, lunch menu, daily errands, groceries, casual ideas).
- NEVER force everyday personal notes into tech/work domains. Casual life notes MUST be classified as ROUTINE_TASK or GENERAL_IDEA.

Visual Markings & Gesture Rules:
- CIRCLE_ENCLOSURE: When a word or phrase is circled (enclosed in a round or oval boundary), the user has CHOSEN/SELECTED that specific option among alternatives (e.g., in "국밥 -> 순대, 수육" with '수육' circled, '수육' is the chosen option). Put it in 'chosen' under extractedKeywords and set actionTask to 'SELECTION_PIVOT'.
- UNDERLINE: When a line is drawn under a word, the user is EMPHASIZING that item. Put it in 'emphasized' under extractedKeywords.
- CHECKMARK: When a checkmark (v or 체크) is drawn next to or over an item, it is confirmed/chosen. Put it in 'chosen' under extractedKeywords.

Screen Location Independent Feedback Intent:
- The user may write anywhere on the screen (not necessarily right next to the AI sentence).
- If an active hypothesis sentence is present on screen (${request.activeHypothesisSentence ?? 'null'}), analyze whether the user's new input is responding to that hypothesis:
  - Affirmative response ("yes", "응", "ㅇㅇ", "맞아", "좋아", "ㅇ", "그렇게 해줘"): inputClassification = 'FEEDBACK_REPLY', feedbackIntent = 'CONFIRM_ACCEPT'.
  - Negative rejection ("no", "아니", "ㄴㄴ", "틀렸어", "ㄴ", "그거 말고"): inputClassification = 'FEEDBACK_REPLY', feedbackIntent = 'REJECT_CANCEL'.
  - Correction / Word replacement: inputClassification = 'FEEDBACK_REPLY', feedbackIntent = 'CORRECTION_MODIFY'.
  - Completely new thought: inputClassification = 'NEW_INDEPENDENT_MEMO', feedbackIntent = 'NONE'.

Action Tasks (Determine the user's primary human action):
- SELECTION_PIVOT: Dropping a previous option and adopting an alternative (e.g. ~~초코라떼~~ 얼그레이, ~~React~~ Svelte 5).
- ALTERNATIVE_COMPARE: Deliberating between multiple options (e.g. 국밥, 칼국수 / 모노레포 vs 멀티레포).
- PARAM_ADJUST: Changing a numeric value, time, price, port, or version (e.g. ~~4000원~~ 4500원, ~~2시~~ 3시).
- ITEM_ACCUMULATE: Listing multiple independent items (e.g. Docker, K8s, Helm / 우유, 계란, 빵).
- PIPELINE_FLOW: Step-by-step sequence or transition pipeline (e.g. MongoDB -> PostgreSQL).
- CAUSE_DIAGNOSE: Diagnosing root causes or troubleshooting hypotheses (e.g. OOM: 누수 의심).
- RECORD_CONFIRM: Plain recording of a finalized fact or completed expense.`;

  const contents: any[] = [{ text: prompt }];

  if (request.croppedImageBase64 && request.croppedImageBase64.startsWith('data:image/')) {
    const mimeMatch = request.croppedImageBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
    contents.push({
      inlineData: {
        mimeType,
        data: request.croppedImageBase64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, ''),
      },
    });
  }

  const response = await ai.models.generateContent({
    model: 'gemini-3.5-flash-lite',
    contents,
    config: {
      responseMimeType: 'application/json',
      maxOutputTokens: 1000,
      responseSchema: {
          type: 'OBJECT',
          properties: {
            isContinuousWithPrevious: {
              type: 'OBJECT',
              properties: {
                type: { type: 'STRING', enum: ['noul'] },
                probability: { type: 'NUMBER' },
                value: { type: 'BOOLEAN' },
              },
              required: ['type', 'probability', 'value'],
            },
            inputClassification: {
              type: 'OBJECT',
              properties: {
                type: { type: 'STRING', enum: ['choice'] },
                selected: { type: 'STRING', enum: ['FEEDBACK_REPLY', 'NEW_INDEPENDENT_MEMO', 'STRIKE_THROUGH'] },
                confidence: { type: 'NUMBER' },
              },
              required: ['type', 'selected', 'confidence'],
            },
            feedbackIntent: {
              type: 'OBJECT',
              properties: {
                type: { type: 'STRING', enum: ['choice'] },
                selected: { type: 'STRING', enum: ['CONFIRM_ACCEPT', 'REJECT_CANCEL', 'CORRECTION_MODIFY', 'NONE'] },
                confidence: { type: 'NUMBER' },
              },
              required: ['type', 'selected', 'confidence'],
            },
            strikethroughIntent: {
              type: 'OBJECT',
              properties: {
                type: { type: 'STRING', enum: ['choice'] },
                selected: { type: 'STRING', enum: ['THOUGHT_PIVOT', 'TYPO_CORRECTION', 'NONE'] },
                confidence: { type: 'NUMBER' },
              },
              required: ['type', 'selected', 'confidence'],
            },
            visualStructure: {
              type: 'OBJECT',
              properties: {
                type: { type: 'STRING', enum: ['choice'] },
                selected: { type: 'STRING', enum: ['CONTRAST_ARROW', 'MIND_MAP', 'LIST', 'ISOLATED'] },
                confidence: { type: 'NUMBER' },
              },
              required: ['type', 'selected', 'confidence'],
            },
            domainRoute: {
              type: 'OBJECT',
              properties: {
                type: { type: 'STRING', enum: ['choice'] },
                selected: { type: 'STRING', enum: ['SIDE_PROJECT_SPARK', 'DEVSECOPS_STUDY', 'ROUTINE_TASK', 'GENERAL_IDEA'] },
                confidence: { type: 'NUMBER' },
              },
              required: ['type', 'selected', 'confidence'],
            },
            actionTask: {
              type: 'OBJECT',
              properties: {
                type: { type: 'STRING', enum: ['choice'] },
                selected: {
                  type: 'STRING',
                  enum: [
                    'SELECTION_PIVOT',
                    'ALTERNATIVE_COMPARE',
                    'PARAM_ADJUST',
                    'ITEM_ACCUMULATE',
                    'PIPELINE_FLOW',
                    'CAUSE_DIAGNOSE',
                    'RECORD_CONFIRM',
                  ],
                },
                confidence: { type: 'NUMBER' },
              },
              required: ['type', 'selected', 'confidence'],
            },
            marginBox: {
              type: 'OBJECT',
              properties: {
                type: { type: 'STRING', enum: ['box'] },
                coordinates: {
                  type: 'ARRAY',
                  items: { type: 'NUMBER' },
                },
              },
              required: ['type', 'coordinates'],
            },
            extractedKeywords: {
              type: 'OBJECT',
              properties: {
                active: { type: 'ARRAY', items: { type: 'STRING' } },
                struckOut: { type: 'ARRAY', items: { type: 'STRING' } },
                chosen: { type: 'ARRAY', items: { type: 'STRING' } },
                emphasized: { type: 'ARRAY', items: { type: 'STRING' } },
              },
              required: ['active', 'struckOut'],
            },
          },
          required: [
            'isContinuousWithPrevious',
            'inputClassification',
            'strikethroughIntent',
            'visualStructure',
            'domainRoute',
            'actionTask',
            'marginBox',
            'extractedKeywords',
          ],
        },
      },
    });

  const rawText = response.text;
  if (!rawText) throw new Error('Empty response from Gemini');

  const parsed = JSON.parse(rawText);
  return {
    decision: {
      isContinuousWithPrevious: parsed.isContinuousWithPrevious,
      inputClassification: parsed.inputClassification,
      feedbackIntent: parsed.feedbackIntent,
      strikethroughIntent: parsed.strikethroughIntent,
      visualStructure: parsed.visualStructure,
      domainRoute: parsed.domainRoute,
      actionTask: parsed.actionTask,
      marginBox: parsed.marginBox,
    },
    keywords: {
      active: parsed.extractedKeywords?.active ?? [],
      struckOut: parsed.extractedKeywords?.struckOut ?? [],
      chosen: parsed.extractedKeywords?.chosen ?? [],
      emphasized: parsed.extractedKeywords?.emphasized ?? [],
    },
  };
}

/**
 * 3. Fallback Heuristic System 1 Engine
 * 오프라인, 테스트, 키 미설정 시 결정론적 판별 보장
 */
export function runHeuristicSystem1(request: InferRequestBody): System1Output {
  const [, minY, maxX] = request.strokeMetadata?.bbox ?? [100, 100, 300, 200];
  const activeHypothesis = request.activeHypothesisSentence;
  const previousEvaporated = request.previousEvaporatedContext;

  // 1. "새 단어" vs "AI 문장에 대한 답장" 및 피드백 의도 자율 판별
  let inputClass: InputClassification = 'NEW_INDEPENDENT_MEMO';
  let inputConfidence = 0.85;
  let feedbackIntent: import('@itnote/shared').FeedbackIntent = 'NONE';

  if (activeHypothesis) {
    inputClass = 'FEEDBACK_REPLY';
    inputConfidence = 0.89;

    const rawLower = (request.rawTextInput ?? '').trim().toLowerCase();
    if (/^(응|ㅇㅇ|yes|y|맞아|좋아|ㅇ|그래|확정|수락)/.test(rawLower)) {
      feedbackIntent = 'CONFIRM_ACCEPT';
    } else if (/^(아니|ㄴㄴ|no|n|틀렸어|ㄴ|취소|기각)/.test(rawLower)) {
      feedbackIntent = 'REJECT_CANCEL';
    } else if (/대신|말고|수정/.test(rawLower)) {
      feedbackIntent = 'CORRECTION_MODIFY';
    }
  }

  // 2. 증발 후 연속성 (Noul 시간차 추론)
  let isContinuous = false;
  let continuityProb = 0.15;
  if (previousEvaporated && previousEvaporated.trim().length > 0) {
    // 직전 증발 맥락이 존재하면 연속적 사고 흐름으로 판정
    isContinuous = true;
    continuityProb = 0.84;
  }

  // 3. 취소선 및 구조 판정, 마킹(선택/강조) 추출
  let strikethroughIntent: StrikethroughIntent = 'NONE';
  let visualStructure: VisualStructure = 'ISOLATED';
  const activeKeywords: string[] = ['Svelte 5', 'Hono'];
  const struckOutKeywords: string[] = [];
  const chosenKeywords: string[] = [];
  const emphasizedKeywords: string[] = [];

  if (request.rawTextInput) {
    const raw = request.rawTextInput.trim();

    // 동그라미 선택 표기 추출 (예: (수육), [수육])
    const circleMatches = Array.from(raw.matchAll(/[\(\[]([^\)\]]+)[\)\]]/g));
    for (const cm of circleMatches) {
      chosenKeywords.push(cm[1].trim());
    }

    // 밑줄 강조 표기 추출 (예: _항목_)
    const underMatches = Array.from(raw.matchAll(/_([^_]+)_/g));
    for (const um of underMatches) {
      emphasizedKeywords.push(um[1].trim());
    }

    if (raw.includes('->') || raw.includes('→')) {
      visualStructure = 'CONTRAST_ARROW';
      const parts = raw.split(/->|→/).map((s) => s.trim());
      activeKeywords.length = 0;
      activeKeywords.push(...parts.filter(Boolean));
    } else if (raw.includes('~~') || raw.includes(' 취소 ')) {
      strikethroughIntent = 'THOUGHT_PIVOT';
      visualStructure = 'CONTRAST_ARROW';
      
      // 다중 취소선 일괄 추출 (예: ~~초코라떼~~, ~~4000원~~)
      const matches = Array.from(raw.matchAll(/~~([^~]+)~~/g));
      for (const m of matches) {
        struckOutKeywords.push(m[1].trim());
      }

      // 취소선 제거 후 남은 텍스트에서 활성 키워드 추출
      const cleaned = raw.replace(/~~[^~]+~~/g, '').trim();
      const tokens = cleaned.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
      if (tokens.length > 0) {
        activeKeywords.length = 0;
        activeKeywords.push(...tokens);
      }
    } else {
      activeKeywords.length = 0;
      activeKeywords.push(...raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean));
    }
  }

  // 4. 여백 바운딩박스 계산 (필기 우측 또는 하단)
  const marginMinX = maxX + 36;
  const marginMinY = minY;
  const marginMaxX = Math.min(2350, marginMinX + 440);
  const marginMaxY = marginMinY + 105;

  let domainRoute: DomainRoute = 'GENERAL_IDEA';
  const fullTextLower = `${request.rawTextInput ?? ''} ${activeKeywords.join(' ')}`.toLowerCase();

  // 1. 일상/생활/식음료/루틴 메모
  if (/원|라떼|커피|밀크티|식사|점심|저녁|밥|마트|장보기|운동|헬스|일정|할일/.test(fullTextLower)) {
    domainRoute = 'ROUTINE_TASK';
  }
  // 2. 클라우드/인프라/보안 실무
  else if (/k8s|kubernetes|docker|iam|rbac|보안|devsecops|ci\/cd|pipeline|gitleaks|aws|gcp|terraform|linux/.test(fullTextLower)) {
    domainRoute = 'DEVSECOPS_STUDY';
  }
  // 3. 프로젝트/개발 기술 스택
  else if (/svelte|react|hono|vite|vue|node|db|postgres|mongo|redis|kafka|api|모노레포|프론트|백엔드/.test(fullTextLower)) {
    domainRoute = 'SIDE_PROJECT_SPARK';
  }
  // 4. 그 외 일반 아이디어 또는 페르소나 주제 참고
  else {
    domainRoute = 'GENERAL_IDEA';
  }

  // 5. 7대 행동 태스크 (ActionTask) 도출
  let actionTask: ActionTask = 'ITEM_ACCUMULATE';
  if (chosenKeywords.length > 0) {
    actionTask = 'SELECTION_PIVOT';
  } else if (strikethroughIntent === 'THOUGHT_PIVOT' || struckOutKeywords.length > 0) {
    if (struckOutKeywords.some((s) => /\d|원|시|분|port/i.test(s))) {
      actionTask = 'PARAM_ADJUST';
    } else {
      actionTask = 'SELECTION_PIVOT';
    }
  } else if (visualStructure === 'CONTRAST_ARROW') {
    actionTask = 'PIPELINE_FLOW';
  } else if (fullTextLower.includes('vs') || fullTextLower.includes(' 또는 ') || fullTextLower.includes('고민') || fullTextLower.includes('추천')) {
    actionTask = 'ALTERNATIVE_COMPARE';
  } else if (/원인|누수|에러|error|fail|oom|의심|점검/.test(fullTextLower)) {
    actionTask = 'CAUSE_DIAGNOSE';
  } else if (/완료|결제|확정|성공|끝/.test(fullTextLower)) {
    actionTask = 'RECORD_CONFIRM';
  } else if (activeKeywords.length > 1) {
    actionTask = 'ALTERNATIVE_COMPARE';
  }

  return {
    decision: {
      isContinuousWithPrevious: {
        type: 'noul',
        probability: continuityProb,
        value: isContinuous,
      },
      inputClassification: {
        type: 'choice',
        selected: inputClass,
        confidence: inputConfidence,
      },
      feedbackIntent: {
        type: 'choice',
        selected: feedbackIntent,
        confidence: 0.9,
      },
      strikethroughIntent: {
        type: 'choice',
        selected: strikethroughIntent,
        confidence: 0.91,
      },
      visualStructure: {
        type: 'choice',
        selected: visualStructure,
        confidence: 0.88,
      },
      domainRoute: {
        type: 'choice',
        selected: domainRoute,
        confidence: 0.79,
      },
      actionTask: {
        type: 'choice',
        selected: actionTask,
        confidence: 0.92,
      },
      marginBox: {
        type: 'box',
        coordinates: [marginMinX, marginMinY, marginMaxX, marginMaxY],
      },
    },
    keywords: {
      active: activeKeywords,
      struckOut: struckOutKeywords,
      chosen: chosenKeywords,
      emphasized: emphasizedKeywords,
    },
  };
}

/**
 * 차세대 Jev Discriminator: 5개 직교 후보 문장 중 최적의 1개를 Choice로 확정
 */
export function runJevReranker(input: JevRerankerInput): JevRerankerResult {
  const { candidates, userContext } = input;
  const hasStrikethrough = (userContext.rejectedHistory?.length ?? 0) > 0;
  const hasLinkedContext = (userContext.linkedContexts?.length ?? 0) > 0;
  const hasRoutine = Boolean(userContext.currentRoutine);

  // 기본 가중치 초기화
  const rawScores: Record<keyof CandidateHypothesisPool, number> = {
    candidate_project: 0.5,
    candidate_routine: 0.4,
    candidate_pivot: 0.2,
    candidate_longterm: 0.3,
    candidate_definition: 0.35,
  };

  // 맥락 신호에 따른 가중치 조정
  if (hasStrikethrough) {
    // 취소선이나 이전 기각이 존재하면 피벗 관점 대폭 상향
    rawScores.candidate_pivot += 0.6;
  }

  if (hasLinkedContext) {
    // 과거 연관 노트가 발견되었으면 장기 맥락 연결 관점 상향
    const topSimilarity = userContext.linkedContexts![0].similarity;
    rawScores.candidate_longterm += topSimilarity * 0.7;
  }

  if (hasRoutine) {
    // 현재 시간대 루틴이 일치하면 루틴 관점 상향
    rawScores.candidate_routine += 0.3;
  }

  // 소프트맥스(Softmax) 정규화
  const keys = Object.keys(rawScores) as Array<keyof CandidateHypothesisPool>;
  const expScores = keys.map((k) => Math.exp(rawScores[k]));
  const sumExp = expScores.reduce((acc, v) => acc + v, 0);

  const candidateScores = {} as Record<keyof CandidateHypothesisPool, number>;
  let bestKey: keyof CandidateHypothesisPool = 'candidate_project';
  let bestScore = -1;

  keys.forEach((k, idx) => {
    const norm = Math.round((expScores[idx] / sumExp) * 100) / 100;
    candidateScores[k] = norm;
    if (norm > bestScore) {
      bestScore = norm;
      bestKey = k;
    }
  });

  const reasonMap: Record<keyof CandidateHypothesisPool, string> = {
    candidate_project: '사용자의 프로필 및 개발 작업 맥락과 가장 높은 적합도를 보임',
    candidate_routine: '현재 요일 및 시간대 루틴 상태에 부합하는 실행 과제임',
    candidate_pivot: '취소선 및 이전 기각 이력을 배제한 최적의 대안 가설임',
    candidate_longterm: '과거에 확정했던 관련 노트 맥락과 가장 높은 의미적 일치도를 보임',
    candidate_definition: '핵심 키워드의 개념 정의 및 요약에 가장 충실함',
  };

  return {
    selectedKey: bestKey,
    winningSentence: candidates[bestKey],
    confidenceScore: bestScore,
    reasonNoul: reasonMap[bestKey],
    candidateScores,
  };
}
