import { describe, it, expect, afterEach, vi } from 'vitest';
import type { CandidateHypothesisPool, JevRerankerInput } from '@itnote/shared';
import {
  buildDecisionQuestions,
  computeSoftmax,
  runNeuralJevReranker,
  setDecisionEvaluatorForTesting,
  isNeuralEngineReady,
  type DecisionsApiRequest,
} from '../services/neuralJevEngine';
import {
  recognizeHandwritingWithSidecar,
  setOcrFetcherForTesting,
} from '../services/ocrClient';

describe('System 1 Decision Engine (gemini-decision-1 & ko-hand-ocr)', () => {
  const dummyPool: CandidateHypothesisPool = {
    candidate_project: 'Svelte 5 룬 기반으로 가상 DOM 오버헤드를 제거합니다.',
    candidate_routine: '수요일 오후 개인 프로젝트 스프린트 일정에 집중합니다.',
    candidate_pivot: 'MongoDB 대신 PostgreSQL로 스택을 전면 선회합니다.',
    candidate_longterm: '과거 노트에 기록했던 Zero-Knowledge E2EE 암호화를 연계합니다.',
    candidate_definition: 'Dual-Process AI 아키텍처의 의사결정 계층 구조를 정의합니다.',
  };

  const sampleInput: JevRerankerInput = {
    candidates: dummyPool,
    userContext: {
      persona: { role: 'DevSecOps 엔지니어' },
      currentRoutine: '개인 프로젝트 시간',
    },
  };

  afterEach(() => {
    setDecisionEvaluatorForTesting(null);
    setOcrFetcherForTesting(null);
  });

  it('buildDecisionQuestions는 5개 직교 후보 각각에 대한 gemini-decision-1 질문 스키마를 생성해야 한다', () => {
    const questions = buildDecisionQuestions(dummyPool, '직무: DevSecOps');
    const keys = Object.keys(questions);

    expect(keys).toHaveLength(5);
    expect(questions.candidate_project.type).toBe('noul');
    expect(questions.candidate_pivot.instructions).toContain(dummyPool.candidate_pivot);
  });

  it('로짓 배열에 대해 소프트맥스 확률 분포를 정상 산출해야 한다', () => {
    const logits = [1.0, 3.5, 0.5, 2.0, 1.2];
    const probs = computeSoftmax(logits);

    expect(probs.length).toBe(5);
    const sum = probs.reduce((acc, p) => acc + p, 0);
    expect(sum).toBeGreaterThanOrEqual(0.95);
    expect(sum).toBeLessThanOrEqual(1.05);

    const maxProbIdx = probs.indexOf(Math.max(...probs));
    expect(maxProbIdx).toBe(1);
  });

  it('평가기 미설정 시 휴리스틱 Fallback으로 [0, 1] 독립 점수와 최적 후보를 반환해야 한다', async () => {
    expect(isNeuralEngineReady()).toBe(false);

    const result = await runNeuralJevReranker(sampleInput);

    expect(result).toBeDefined();
    expect(result.scoringEngine).toBe('heuristic');
    expect(result.winningSentence).toBe(dummyPool[result.selectedKey]);
    expect(result.confidenceScore).toBeGreaterThan(0.6);
    for (const score of Object.values(result.candidateScores)) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it('gemini-decision-1 평가기 주입 시 1회 호출로 5개 후보 독립 점수를 산출하고 최고점 후보를 확정해야 한다', async () => {
    const mockEvaluator = vi.fn(async (req: DecisionsApiRequest) => {
      expect(req.model).toBe('gemini-decision-1');
      return {
        answers: {
          candidate_project: { type: 'noul' as const, noul: 0.72, confidence: 0.85 },
          candidate_routine: { type: 'noul' as const, noul: 0.44, confidence: 0.8 },
          candidate_pivot: { type: 'noul' as const, noul: 0.81, confidence: 0.92 },
          candidate_longterm: { type: 'noul' as const, noul: 0.63, confidence: 0.81 },
          candidate_definition: { type: 'noul' as const, noul: 0.39, confidence: 0.77 },
        },
      };
    });

    setDecisionEvaluatorForTesting(mockEvaluator);
    expect(isNeuralEngineReady()).toBe(true);

    const result = await runNeuralJevReranker({
      candidates: dummyPool,
      userContext: {
        rejectedHistory: ['이전 가설 기각됨'],
      },
    });

    expect(mockEvaluator).toHaveBeenCalledTimes(1);
    expect(result.scoringEngine).toBe('gemini-decision-1');
    expect(result.selectedKey).toBe('candidate_pivot');
    expect(result.winningSentence).toBe(dummyPool.candidate_pivot);
    expect(result.candidateScores.candidate_project).toBe(0.72);
    expect(result.candidateScores.candidate_pivot).toBe(0.99);
    expect(result.reasonNoul).toContain('기각 이력');
  });

  it('ocrClient는 사이드카 Fetcher 주입 시 ko-hand-ocr 텍스트를 반환하고 미설정 시 null로 폴백해야 한다', async () => {
    const fallbackRes = await recognizeHandwritingWithSidecar('data:image/png;base64,abc');
    expect(fallbackRes).toBeNull();

    setOcrFetcherForTesting(async () => ({
      text: '몽고DB -> PostgreSQL',
      latencyMs: 38,
    }));

    const sidecarRes = await recognizeHandwritingWithSidecar('data:image/png;base64,abc');
    expect(sidecarRes).toEqual({
      text: '몽고DB -> PostgreSQL',
      latencyMs: 38,
      source: 'ko-hand-ocr',
    });
  });
});
