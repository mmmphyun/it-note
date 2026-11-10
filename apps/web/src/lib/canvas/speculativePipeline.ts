import type {
  PrefetchedHypothesisSlot,
  SpeculativeInferenceRequest,
  InferRequestBody,
  InferResponseBody
} from '@itnote/shared';

export interface SpeculativePipelineOptions {
  idleDurationMs?: number; // 펜 유휴 감지 대기 시간 (기본값 1500ms)
  minThrottleIntervalMs?: number; // 최소 호출 간격 (연타 방어 3000ms)
  fetcher?: (body: InferRequestBody, signal: AbortSignal) => Promise<InferResponseBody>;
}

export class SpeculativePipeline {
  private idleTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private currentAbortController: AbortController | null = null;
  private prefetchedSlot: PrefetchedHypothesisSlot | null = null;
  private lastTriggerTime = 0;

  private readonly idleDurationMs: number;
  private readonly minThrottleIntervalMs: number;
  private readonly fetcher: (body: InferRequestBody, signal: AbortSignal) => Promise<InferResponseBody>;

  constructor(options: SpeculativePipelineOptions = {}) {
    this.idleDurationMs = options.idleDurationMs ?? 1500;
    this.minThrottleIntervalMs = options.minThrottleIntervalMs ?? 3000;
    this.fetcher =
      options.fetcher ??
      (async (body, signal) => {
        const res = await fetch('/api/infer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal
        });
        if (!res.ok) {
          throw new Error(`Infer request failed: ${res.status}`);
        }
        return res.json();
      });
  }

  /**
   * 사용자가 펜을 대는 순간(pointerdown) 호출: 진행 중인 타이머 및 비동기 작업 즉각 취소
   */
  public handlePointerDown(): void {
    if (this.idleTimeoutId !== null) {
      clearTimeout(this.idleTimeoutId);
      this.idleTimeoutId = null;
    }

    if (this.currentAbortController) {
      this.currentAbortController.abort('New stroke started by user');
      this.currentAbortController = null;
    }

    // 새 필기가 시작되었으므로 이전 가설 캐시는 만료됨
    if (this.prefetchedSlot) {
      this.prefetchedSlot.isStale = true;
      this.prefetchedSlot = null;
    }
  }

  /**
   * 사용자가 펜을 뗀 순간(pointerup) 호출: 1.5초 유휴 디바운스 시작
   */
  public handlePointerUp(requestData: SpeculativeInferenceRequest): void {
    this.handlePointerDown(); // 기존 작업 초기화

    this.idleTimeoutId = setTimeout(() => {
      this.idleTimeoutId = null;
      this.triggerSpeculativeFetch(requestData);
    }, this.idleDurationMs);
  }

  /**
   * 1.5초 유휴 만료 시 백그라운드 선제 추론 실행
   */
  private async triggerSpeculativeFetch(requestData: SpeculativeInferenceRequest): Promise<void> {
    const now = Date.now();
    // 3초 연타 쓰로틀 가드
    if (now - this.lastTriggerTime < this.minThrottleIntervalMs) {
      return;
    }
    this.lastTriggerTime = now;

    this.currentAbortController = new AbortController();
    const signal = this.currentAbortController.signal;

    try {
      const payload: InferRequestBody = {
        croppedImageBase64: requestData.croppedImageBase64,
        rawTextInput: requestData.rawTextInput,
        previousEvaporatedContext: requestData.previousEvaporatedContext,
        rejectedHypotheses: requestData.rejectedHypotheses,
        userContext: {
          recentConfirmedNotes: requestData.linkedContexts.map(c => c.sentence)
        }
      };

      const result = await this.fetcher(payload, signal);

      if (!signal.aborted && result && result.sentence) {
        this.prefetchedSlot = {
          hypothesisSentence: result.sentence,
          candidateKey: result.rerankerResult?.selectedKey,
          confidenceScore: result.rerankerResult?.confidenceScore ?? 0.9,
          fetchedAt: Date.now(),
          isStale: false
        };
      }
    } catch (err) {
      // AbortError는 정상 취소이므로 무시, 그 외 에러는 조용히 null 처리 (90초 만료 시 온디맨드 재시도)
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      this.prefetchedSlot = null;
    } finally {
      if (this.currentAbortController?.signal === signal) {
        this.currentAbortController = null;
      }
    }
  }

  /**
   * 잉크 투명도 0.0 도달 시점(증발 완료)에 호출: 0ms로 캐시된 가설 인출
   */
  public consumePrefetchedHypothesis(): PrefetchedHypothesisSlot | null {
    if (this.prefetchedSlot && !this.prefetchedSlot.isStale) {
      const slot = this.prefetchedSlot;
      this.prefetchedSlot = null; // 1회 소비 후 비움
      return slot;
    }
    return null;
  }

  /**
   * 현재 캐시 상태 확인 (테스트/디버그용)
   */
  public getActiveSlot(): PrefetchedHypothesisSlot | null {
    return this.prefetchedSlot;
  }
}
