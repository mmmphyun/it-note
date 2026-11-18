import type {
  CandidateHypothesisPool,
  CandidateKey,
  JevRerankerInput,
  JevRerankerResult,
} from '@itnote/shared';
import { runJevReranker } from './system1Jev.js';

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

const DECISIONS_API_URL = 'https://generativelanguage.googleapis.com/v1beta/decisions';
const DECISIONS_TIMEOUT_MS = 3000;

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
        `Given user context (${contextStr}), is the following Korean hypothesis sentence accurate, natural, and aligned with the user's intent without repeating rejected options? Candidate: "${candidates[key]}"`,
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DECISIONS_TIMEOUT_MS);

  try {
    const res = await fetch(DECISIONS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(req),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Decisions API returned HTTP ${res.status}`);
    }
    return (await res.json()) as DecisionsApiResponse;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Google System 1 (gemini-decision-1) 기반 5-Way Rubric Score Reranker
 * 각 후보 문장을 독립 점수([0.00, 1.00])로 채점하여 최적 1문장을 확정한다.
 */
export async function runNeuralJevReranker(input: JevRerankerInput): Promise<JevRerankerResult> {
  const { candidates, userContext } = input;
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const shouldInvokeApi =
    customEvaluator !== null || (process.env.NODE_ENV !== 'test' && Boolean(apiKey));

  if (!shouldInvokeApi) {
    return runJevReranker(input);
  }

  const contextSegments: string[] = [];
  if (userContext.persona?.role) {
    contextSegments.push(`직무: ${userContext.persona.role}`);
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

  try {
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

    // 사용자 맥락 신호 보정 (과도한 쏠림 없이 독립 점수 스케일 유지)
    if (userContext.rejectedHistory && userContext.rejectedHistory.length > 0) {
      rawScores.candidate_pivot += 0.18;
    }
    if (userContext.linkedContexts && userContext.linkedContexts.length > 0) {
      rawScores.candidate_longterm += userContext.linkedContexts[0].similarity * 0.15;
    }
    if (userContext.currentRoutine) {
      rawScores.candidate_routine += 0.12;
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
      candidate_project: 'gemini-decision-1 판별: 프로젝트 및 작업 목표 정합도 최상위 판정',
      candidate_routine: 'gemini-decision-1 판별: 현재 시간대 루틴 수행 과제 적합 판정',
      candidate_pivot: 'gemini-decision-1 판별: 기각 이력 및 취소선 의도 반영 최적 대안 판정',
      candidate_longterm: 'gemini-decision-1 판별: 과거 확정 노트와의 의미적 연관성 최상위 판정',
      candidate_definition: 'gemini-decision-1 판별: 개념 정의 및 핵심 요약 일치도 최상위 판정',
    };

    return {
      selectedKey: bestKey,
      winningSentence: candidates[bestKey],
      confidenceScore: maxScore,
      reasonNoul: reasonMap[bestKey],
      candidateScores,
      scoringEngine: 'gemini-decision-1',
    };
  } catch (err) {
    console.warn('[neuralJevEngine] gemini-decision-1 failed, falling back to heuristic:', err);
    return runJevReranker(input);
  }
}
