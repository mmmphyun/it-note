import { describe, it, expect, afterEach, vi } from 'vitest';
import type { CandidateHypothesisPool, JevRerankerInput } from '@itnote/shared';
import * as ort from 'onnxruntime-node';
import {
  buildBatchTensors,
  computeSoftmax,
  runNeuralJevReranker,
  setNeuralSessionForTesting,
  isNeuralEngineReady,
} from '../services/neuralJevEngine';

describe('Neural Jev Engine (KLUE-RoBERTa Batch Reranker)', () => {
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
    setNeuralSessionForTesting(null);
  });

  it('5개 후보 문장을 [5, seqLen] 크기의 단일 배치 텐서로 변환해야 한다', () => {
    const seqLen = 64;
    const { inputIds, attentionMask } = buildBatchTensors(dummyPool, '사용자 맥락', seqLen);

    expect(inputIds.dims).toEqual([5, seqLen]);
    expect(attentionMask.dims).toEqual([5, seqLen]);
    expect(inputIds.type).toBe('int64');
    expect(attentionMask.type).toBe('int64');

    // 5개 배치 각각 [CLS]=2 로 시작해야 함
    const ids = inputIds.data as BigInt64Array;
    for (let b = 0; b < 5; b++) {
      expect(ids[b * seqLen]).toBe(2n);
    }
  });

  it('로짓 배열에 대해 소프트맥스 확률 분포를 정상 산출해야 한다', () => {
    const logits = [1.0, 3.5, 0.5, 2.0, 1.2];
    const probs = computeSoftmax(logits);

    expect(probs.length).toBe(5);
    const sum = probs.reduce((acc, p) => acc + p, 0);
    // 반올림 오차 감안 0.95 ~ 1.05 범위
    expect(sum).toBeGreaterThanOrEqual(0.95);
    expect(sum).toBeLessThanOrEqual(1.05);

    // 가장 큰 로짓 인덱스(1번)가 최고 확률이어야 함
    const maxProbIdx = probs.indexOf(Math.max(...probs));
    expect(maxProbIdx).toBe(1);
  });

  it('세션이 없는 경우 휴리스틱 Fallback으로 즉시 최적 후보를 반환해야 한다', async () => {
    expect(isNeuralEngineReady()).toBe(false);

    const result = await runNeuralJevReranker(sampleInput);

    expect(result).toBeDefined();
    expect(result.selectedKey).toBeDefined();
    expect(result.winningSentence).toBe(dummyPool[result.selectedKey]);
    expect(result.confidenceScore).toBeGreaterThan(0);
    expect(Object.keys(result.candidateScores).length).toBe(5);
  });

  it('신경망 세션 주입 시 Batch=5 1회 순전파를 실행하고 최고 로짓 후보를 Choice로 확정해야 한다', async () => {
    // 특정 후보(candidate_pivot)가 우세한 모의 로짓 반환 세션
    const mockRun = vi.fn().mockImplementation(async () => {
      // 5개 후보에 대한 모델 출력 로짓
      const mockLogits = new Float32Array([0.2, 0.4, 3.8, 0.5, 0.3]);
      const tensor = new ort.Tensor('float32', mockLogits, [5]);
      return { logits: tensor };
    });

    const mockSession = {
      run: mockRun,
      outputNames: ['logits'],
    } as unknown as ort.InferenceSession;

    setNeuralSessionForTesting(mockSession);
    expect(isNeuralEngineReady()).toBe(true);

    const startTime = performance.now();
    const result = await runNeuralJevReranker({
      candidates: dummyPool,
      userContext: {
        rejectedHistory: ['이전 가설 기각됨'],
      },
    });
    const duration = performance.now() - startTime;

    // 단 1회만 호출(Batch=5 단일 패스)
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(result.selectedKey).toBe('candidate_pivot');
    expect(result.winningSentence).toBe(dummyPool.candidate_pivot);
    expect(result.confidenceScore).toBeGreaterThan(0.5);
    expect(result.reasonNoul).toContain('기각 이력');

    // 80ms 이내 처리 SLA 확인
    expect(duration).toBeLessThan(80);
  });
});
