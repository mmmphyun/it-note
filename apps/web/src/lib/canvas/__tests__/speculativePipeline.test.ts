import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SpeculativePipeline } from '../speculativePipeline';
import type { SpeculativeInferenceRequest, InferResponseBody } from '@itnote/shared';

describe('SpeculativePipeline (1.5초 펜 유휴 선제 추론 및 AbortController 관리)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const mockRequest: SpeculativeInferenceRequest = {
    rawTextInput: 'Svelte 5 Runes',
    linkedContexts: []
  };

  const mockResponse: InferResponseBody = {
    sentence: 'Svelte 5 Runes 상태 관리로 캔버스 렌더링 성능을 개선합니다.',
    jevDecision: {} as any,
    extractedKeywords: { active: ['svelte', 'runes'], struckOut: [] },
    rerankerResult: {
      selectedKey: 'candidate_project',
      winningSentence: 'Svelte 5 Runes 상태 관리로 캔버스 렌더링 성능을 개선합니다.',
      confidenceScore: 0.95,
      reasonNoul: '프로젝트 맥락 일치',
      candidateScores: {
        candidate_project: 0.95,
        candidate_routine: 0.1,
        candidate_pivot: 0.05,
        candidate_longterm: 0.2,
        candidate_definition: 0.3
      }
    }
  };

  it('펜을 뗀 후 1.5초 유휴 시점에 백그라운드 선제 추론이 호출되어야 한다', async () => {
    const fetcher = vi.fn().mockResolvedValue(mockResponse);
    const pipeline = new SpeculativePipeline({ idleDurationMs: 1500, fetcher });

    pipeline.handlePointerUp(mockRequest);
    expect(fetcher).not.toHaveBeenCalled();

    // 1.5초 경과
    await vi.advanceTimersByTimeAsync(1500);
    expect(fetcher).toHaveBeenCalledTimes(1);

    // 캐시 확인
    const slot = pipeline.consumePrefetchedHypothesis();
    expect(slot).not.toBeNull();
    expect(slot?.hypothesisSentence).toBe(mockResponse.sentence);
    expect(slot?.candidateKey).toBe('candidate_project');

    // 소비 후 비워짐
    expect(pipeline.consumePrefetchedHypothesis()).toBeNull();
  });

  it('1.5초가 지나기 전에 펜을 다시 대면 선제 추론 타이머가 취소되어야 한다', async () => {
    const fetcher = vi.fn().mockResolvedValue(mockResponse);
    const pipeline = new SpeculativePipeline({ idleDurationMs: 1500, fetcher });

    pipeline.handlePointerUp(mockRequest);
    // 1초 후 펜 다시 터치
    await vi.advanceTimersByTimeAsync(1000);
    pipeline.handlePointerDown();

    // 추가로 시간이 흘러도 fetcher 미호출
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetcher).not.toHaveBeenCalled();
    expect(pipeline.consumePrefetchedHypothesis()).toBeNull();
  });

  it('비동기 요청 도중 펜을 다시 대면 AbortController가 취소(abort)되어야 한다', async () => {
    let capturedSignal: AbortSignal | null = null;
    const fetcher = vi.fn().mockImplementation((_body, signal) => {
      capturedSignal = signal;
      return new Promise((resolve) => setTimeout(() => resolve(mockResponse), 1000));
    });

    const pipeline = new SpeculativePipeline({ idleDurationMs: 1500, fetcher });

    pipeline.handlePointerUp(mockRequest);
    await vi.advanceTimersByTimeAsync(1500); // fetcher 기동

    expect(capturedSignal).not.toBeNull();
    const sig1 = capturedSignal as AbortSignal | null;
    expect(sig1?.aborted).toBe(false);

    // 비동기 응답 도착 전 펜 재터치
    pipeline.handlePointerDown();
    const sig2 = capturedSignal as AbortSignal | null;
    expect(sig2?.aborted).toBe(true);

    // 완료 시점 경과 후에도 캐시는 비어있어야 함
    await vi.advanceTimersByTimeAsync(1000);
    expect(pipeline.consumePrefetchedHypothesis()).toBeNull();
  });
});
