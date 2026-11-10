import { describe, it, expect } from 'vitest';
import { runJevReranker } from '../services/system1Jev';
import { generateCandidateHypothesisPool } from '../services/system2Writer';
import type { CandidateHypothesisPool, JevDecision, ExtractedKeywords, InferRequestBody } from '@itnote/shared';

describe('Candidate Reranker Pipeline (5-Way 직교 생성 및 Jev Discriminator)', () => {
  const mockDecision: JevDecision = {
    isContinuousWithPrevious: { type: 'noul', probability: 0.9, value: true },
    strikethroughIntent: { type: 'choice', selected: 'NONE', confidence: 0.9 },
    visualStructure: { type: 'choice', selected: 'ISOLATED', confidence: 0.8 },
    domainRoute: { type: 'choice', selected: 'SIDE_PROJECT_SPARK', confidence: 0.85 },
    marginBox: { type: 'box', coordinates: [100, 100, 300, 200] },
  };

  const mockKeywords: ExtractedKeywords = {
    active: ['Svelte 5', 'Hono'],
    struckOut: [],
  };

  const mockRequest: InferRequestBody = {
    rawTextInput: 'Svelte 5 Hono',
    previousEvaporatedContext: '모노레포 구축',
  };

  it('generateCandidateHypothesisPool은 5개의 상이한 관점을 가진 가설 문장을 생성해야 한다', async () => {
    const pool = await generateCandidateHypothesisPool({
      decision: mockDecision,
      keywords: mockKeywords,
      request: mockRequest,
    });

    expect(pool.candidate_project).toBeDefined();
    expect(pool.candidate_routine).toBeDefined();
    expect(pool.candidate_pivot).toBeDefined();
    expect(pool.candidate_longterm).toBeDefined();
    expect(pool.candidate_definition).toBeDefined();

    // 문장들이 서로 중복되지 않고 질문 형태여야 함
    expect(pool.candidate_project).toContain('?');
    expect(pool.candidate_routine).toContain('?');
  });

  it('과거 연관 맥락이 존재할 경우 Jev Reranker는 candidate_longterm에 높은 점수를 부여해야 한다', () => {
    const candidates: CandidateHypothesisPool = {
      candidate_project: 'Svelte 5와 Hono로 프로젝트를 최적화하려는 구상 맞나요?',
      candidate_routine: 'Svelte 5 작업을 오늘 루틴에 맞춰 진행하시려는 계획인가요?',
      candidate_pivot: '다른 대안을 배제하고 단일 파이프라인으로 확정하려는 의도인가요?',
      candidate_longterm: '직전에 메모한 "모노레포 구축" 흐름에 이어 결합하려는 생각 맞나요?',
      candidate_definition: 'Svelte 5와 Hono 아키텍처에 대한 요약 맞나요?',
    };

    const result = runJevReranker({
      candidates,
      userContext: {
        linkedContexts: [
          { noteId: 'prev-1', sentence: '모노레포 구축', similarity: 0.95 },
        ],
      },
    });

    expect(result.selectedKey).toBe('candidate_longterm');
    expect(result.winningSentence).toBe(candidates.candidate_longterm);
    expect(result.confidenceScore).toBeGreaterThan(0.25);
  });

  it('취소선이나 기각 이력이 존재할 경우 candidate_pivot을 우선 선택해야 한다', () => {
    const candidates: CandidateHypothesisPool = {
      candidate_project: '프로젝트 개발 구상 맞나요?',
      candidate_routine: '오늘 루틴 실행인가요?',
      candidate_pivot: '이전 기각된 방안 대신 새로운 대안으로 피벗하려는 결정인가요?',
      candidate_longterm: '과거 맥락과의 연결인가요?',
      candidate_definition: '개념 요약인가요?',
    };

    const result = runJevReranker({
      candidates,
      userContext: {
        rejectedHistory: ['가상 DOM 모노레포 구축'],
      },
    });

    expect(result.selectedKey).toBe('candidate_pivot');
    expect(result.winningSentence).toBe(candidates.candidate_pivot);
  });
});
