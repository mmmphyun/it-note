import { GoogleGenAI, type Decisions } from '@google/genai';
import type {
  CandidateHypothesisPool,
  CandidateKey,
  JevRerankerInput,
  JevRerankerResult,
} from '@itnote/shared';
import { getGeminiClient } from './geminiClient.js';
import { generateContentWithTransientRetry, runJevReranker } from './system1Jev.js';

export type DecisionQuestionType = 'noul' | 'choice' | 'score';

export interface DecisionQuestion {
  type: DecisionQuestionType;
  instructions: string;
  criteria?: Record<string, string>;
}

export interface DecisionsApiRequest {
  model: 'gemini-decision-1';
  input: string;
  questions: Record<string, DecisionQuestion>;
}

export interface DecisionAnswer {
  type: DecisionQuestionType;
  noul?: number;
  selected_option?: string;
  score?: number;
  confidence?: number;
}

export interface DecisionsApiResponse {
  answers?: Record<string, DecisionAnswer>;
}

export type DecisionEvaluatorFn = (req: DecisionsApiRequest) => Promise<DecisionsApiResponse>;

const CANDIDATE_KEYS: CandidateKey[] = [
  'candidate_project',
  'candidate_routine',
  'candidate_pivot',
  'candidate_longterm',
  'candidate_definition',
];

let customEvaluator: DecisionEvaluatorFn | null = null;
let engineInitialized = false;

/**
 * 소프트맥스 확률 정규화 유틸리티
 */
export function computeSoftmax(logits: number[]): number[] {
  const maxLogit = Math.max(...logits);
  const exps = logits.map((z) => Math.exp(z - maxLogit));
  const sumExp = exps.reduce((acc, val) => acc + val, 0);
  return exps.map((val) => (sumExp === 0 ? 0 : Math.round((val / sumExp) * 100) / 100));
}

/**
 * 5개 후보 문장에 대한 Google Decisions API (gemini-decision-1) 병렬 채점 질문 생성
 */
export function buildDecisionQuestions(
  candidates: CandidateHypothesisPool,
  contextStr: string
): Record<CandidateKey, DecisionQuestion> {
  const questions = {} as Record<CandidateKey, DecisionQuestion>;
  for (const key of CANDIDATE_KEYS) {
    questions[key] = {
      type: 'noul',
      instructions:
        `Evaluate against user memo context (${contextStr}). Score TRUE (0.75-0.95) ONLY if the Korean question is a closed Yes/No hypothesis immediately answerable with circle O (Yes) or cross X (No), sounds natural in the real domain, and avoids repeating rejected sentences. Score FALSE (0.01-0.15) if it asks about unstated reasons or uses open prompts like "~이유가 따로 있으신가요?", "~이유가 있나요?", "어떤/무엇/왜", uses robotic DB phrasing ("데이터 단위", "기록 항목"), misinterprets a menu change price as a price hike, or only swaps word endings of a rejected sentence. Candidate: "${candidates[key]}"`,
    };
  }
  return questions;
}

/**
 * 서버 기동 시 gemini-decision-1 API 키 및 준비 상태 점검
 */
export async function preloadNeuralJevEngine(): Promise<boolean> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  engineInitialized = Boolean(apiKey || customEvaluator);
  return engineInitialized;
}

/**
 * 테스트용 gemini-decision-1 평가기 주입 인터페이스
 */
export function setDecisionEvaluatorForTesting(evaluator: DecisionEvaluatorFn | null): void {
  customEvaluator = evaluator;
  engineInitialized = evaluator !== null;
}

/**
 * 현재 gemini-decision-1 판별기 활성화 여부
 */
export function isNeuralEngineReady(): boolean {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  return customEvaluator !== null || (engineInitialized && Boolean(apiKey));
}

async function callGeminiDecisionsApi(
  req: DecisionsApiRequest,
  apiKey: string
): Promise<DecisionsApiResponse> {
  const aiV1Beta = new GoogleGenAI({ apiKey, apiVersion: 'v1beta' });
  const sdkQuestions: Record<string, Decisions.NoulQuestion> = {};
  for (const [k, q] of Object.entries(req.questions)) {
    sdkQuestions[k] = {
      type: 'noul',
      instructions: q.instructions,
    };
  }

  try {
    const sdkRes = await aiV1Beta.decisions.create({
      model: req.model,
      input: req.input,
      questions: sdkQuestions,
    });

    const mappedAnswers: Record<string, DecisionAnswer> = {};
    if (sdkRes.answers) {
      for (const [k, ans] of Object.entries(sdkRes.answers)) {
        if (ans.type === 'noul') {
          mappedAnswers[k] = {
            type: 'noul',
            noul: ans.noul,
            confidence: ans.confidence,
          };
        } else if (ans.type === 'score') {
          mappedAnswers[k] = {
            type: 'score',
            score: ans.score,
            confidence: ans.confidence,
          };
        } else {
          mappedAnswers[k] = {
            type: 'choice',
            confidence: ans.confidence,
          };
        }
      }
    }
    return { answers: mappedAnswers };
  } catch (decisionErr) {
    // gemini-decision-1 엔드포인트 권한/미지원 시 동일 API 키의 Gemini LLM 채점으로 대체 (하드코딩 폴백 없음)
    const fallbackClient = getGeminiClient();
    if (!fallbackClient) {
      throw decisionErr;
    }

    const scorePrompt = `Evaluate each of the 5 Korean hypothesis candidates against the user's memo context and return an independent probability score between 0.00 and 1.00 for each key in JSON format only.
Scoring Rubric:
- 0.75-0.95: Closed Yes/No (O/X) hypothesis directly answerable with Yes or No without needing user explanation, warm and natural in the real domain, AND fresh compared to rejected history.
- 0.40-0.65: Acceptable closed Yes/No alternative hypothesis reasonably distinct from rejected history.
- 0.01-0.25: Unanswerable with pure Yes/No because it asks for reasons ("~이유가 따로 있으신가요?", "~이유가 있나요?", "왜/어떤/무엇"), uses robotic DB phrasing ("데이터 단위", "기록하는", "수정"), misreads a menu change as a price hike, OR merely paraphrases rejected history.

Context: ${req.input}
Questions:
${Object.entries(req.questions)
  .map(([k, q]) => `- ${k}: ${q.instructions}`)
  .join('\n')}`;

    const llmRes = await generateContentWithTransientRetry(fallbackClient, {
      model: 'gemini-3.5-flash-lite',
      contents: scorePrompt,
      config: {
        responseMimeType: 'application/json',
        maxOutputTokens: 300,
        temperature: 0.1,
        responseSchema: {
          type: 'OBJECT',
          properties: {
            candidate_project: { type: 'NUMBER' },
            candidate_routine: { type: 'NUMBER' },
            candidate_pivot: { type: 'NUMBER' },
            candidate_longterm: { type: 'NUMBER' },
            candidate_definition: { type: 'NUMBER' },
          },
          required: CANDIDATE_KEYS,
        },
      },
    });

    const parsed = JSON.parse(llmRes.text?.trim() ?? '{}') as Record<string, number>;
    const answers: Record<string, DecisionAnswer> = {};
    for (const k of CANDIDATE_KEYS) {
      const val = typeof parsed[k] === 'number' ? parsed[k] : 0.5;
      answers[k] = { type: 'noul', noul: val, confidence: val };
    }
    return { answers };
  }
}

/**
 * Google System 1 (gemini-decision-1) 기반 5-Way Rubric Score Reranker
 * 각 후보 문장을 독립 점수([0.00, 1.00])로 채점하여 최적 1문장을 확정한다.
 */
export async function runNeuralJevReranker(input: JevRerankerInput): Promise<JevRerankerResult> {
  const { candidates, userContext } = input;
  const apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)?.trim();

  if (process.env.NODE_ENV === 'test' && customEvaluator === null) {
    return runJevReranker(input);
  }

  if (customEvaluator === null && !apiKey) {
    throw new Error('AI API 키(GEMINI_API_KEY)가 연결되지 않았습니다.');
  }

  const contextSegments: string[] = [];
  if (userContext.rawTextInput) {
    contextSegments.push(`원문메모: ${userContext.rawTextInput}`);
  }
  if (userContext.activeKeywords?.length) {
    contextSegments.push(`활성키워드: ${userContext.activeKeywords.join(', ')}`);
  }
  if (userContext.struckOutKeywords?.length) {
    contextSegments.push(`취소키워드: ${userContext.struckOutKeywords.join(', ')}`);
  }
  if (userContext.chosenKeywords?.length) {
    contextSegments.push(`선택키워드: ${userContext.chosenKeywords.join(', ')}`);
  }
  if (userContext.domainRoute) {
    contextSegments.push(`판별도메인: ${userContext.domainRoute}`);
  }
  if (userContext.actionTask) {
    contextSegments.push(`행동태스크: ${userContext.actionTask}`);
  }
  if (userContext.previousEvaporatedContext) {
    contextSegments.push(`직전맥락: ${userContext.previousEvaporatedContext}`);
  }
  if (userContext.persona?.role) {
    contextSegments.push(`직무(참고용): ${userContext.persona.role}`);
  }
  if (userContext.currentRoutine) {
    contextSegments.push(`루틴: ${userContext.currentRoutine}`);
  }
  if (userContext.rejectedHistory?.length) {
    contextSegments.push(`기각이력: ${userContext.rejectedHistory.join(', ')}`);
  }
  if (userContext.linkedContexts?.length) {
    contextSegments.push(
      `연관노트: ${userContext.linkedContexts.map((c) => c.sentence).slice(0, 2).join(' / ')}`
    );
  }
  const contextStr = contextSegments.join(' | ') || '기본 사용자 맥락';

  const req: DecisionsApiRequest = {
    model: 'gemini-decision-1',
    input: contextStr,
    questions: buildDecisionQuestions(candidates, contextStr),
  };

  const response = customEvaluator
    ? await customEvaluator(req)
    : await callGeminiDecisionsApi(req, apiKey!);

  const answers = response.answers ?? {};
  const rawScores = {} as Record<CandidateKey, number>;

  for (const key of CANDIDATE_KEYS) {
    const ans = answers[key];
    const base =
      typeof ans?.noul === 'number'
        ? ans.noul
        : typeof ans?.score === 'number'
          ? ans.score
          : typeof ans?.confidence === 'number'
            ? ans.confidence
            : 0.5;
    rawScores[key] = base;
  }

  // 사용자 맥락 신호 미세 보정 (모델의 자연스러움 판별을 덮어쓰지 않도록 완화)
  if (userContext.rejectedHistory && userContext.rejectedHistory.length > 0) {
    rawScores.candidate_pivot += 0.08;
  }
  if (userContext.linkedContexts && userContext.linkedContexts.length > 0) {
    rawScores.candidate_longterm += userContext.linkedContexts[0].similarity * 0.1;
  }
  if (userContext.currentRoutine) {
    rawScores.candidate_routine += 0.05;
  }

  const candidateScores = {} as Record<CandidateKey, number>;
  let bestKey: CandidateKey = 'candidate_project';
  let maxScore = -1;

  for (const key of CANDIDATE_KEYS) {
    const normalized = Math.max(0, Math.min(1, Math.round(rawScores[key] * 100) / 100));
    candidateScores[key] = normalized;
    if (normalized > maxScore) {
      maxScore = normalized;
      bestKey = key;
    }
  }

  const reasonMap: Record<CandidateKey, string> = {
    candidate_project: 'gemini-decision-1 판별: 핵심 의도 및 행동 목적 정합도 최상위 판정',
    candidate_routine: 'gemini-decision-1 판별: 일상·상황 맥락 적합도 최상위 판정',
    candidate_pivot: 'gemini-decision-1 판별: 기각 이력 및 선택·전환 가설 최적 대안 판정',
    candidate_longterm: 'gemini-decision-1 판별: 취향·연속 맥락 및 과거 노트 연관성 최상위 판정',
    candidate_definition: 'gemini-decision-1 판별: 세부 조건·내역 정확도 최상위 판정',
  };

  return {
    selectedKey: bestKey,
    winningSentence: candidates[bestKey],
    confidenceScore: maxScore,
    reasonNoul: reasonMap[bestKey],
    candidateScores,
    scoringEngine: 'gemini-decision-1',
  };
}
