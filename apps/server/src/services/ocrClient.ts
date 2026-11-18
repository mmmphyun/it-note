/**
 * Python ko-hand-ocr 사이드카(OCR_ENDPOINT_URL) HTTP 어댑터
 * 사이드카 미설정 또는 장애 시 null을 반환해 Gemini 멀티모달 폴백을 보장한다.
 */

export interface OcrSidecarResult {
  text: string;
  latencyMs: number;
  source: 'ko-hand-ocr';
}

export type OcrFetcher = (
  url: string,
  body: string
) => Promise<{ text: string; latencyMs?: number } | null>;

const OCR_TIMEOUT_MS = 2000;
let customOcrFetcher: OcrFetcher | null = null;

/**
 * 단위 테스트용 모의 OCR Fetcher 주입
 */
export function setOcrFetcherForTesting(fetcher: OcrFetcher | null): void {
  customOcrFetcher = fetcher;
}

/**
 * Python ko-hand-ocr HTTP 사이드카를 호출해 손글씨 텍스트를 추출한다.
 */
export async function recognizeHandwritingWithSidecar(
  imageBase64?: string
): Promise<OcrSidecarResult | null> {
  if (!imageBase64 || imageBase64.trim().length === 0) {
    return null;
  }

  const endpoint = process.env.OCR_ENDPOINT_URL?.trim();
  if (!customOcrFetcher && (process.env.NODE_ENV === 'test' || !endpoint)) {
    return null;
  }

  const targetUrl = endpoint || 'http://localhost:8090/ocr';
  const payload = JSON.stringify({ imageBase64 });

  try {
    if (customOcrFetcher) {
      const mocked = await customOcrFetcher(targetUrl, payload);
      if (!mocked || !mocked.text || mocked.text.trim().length === 0) {
        return null;
      }
      return {
        text: mocked.text.trim(),
        latencyMs: mocked.latencyMs ?? 0,
        source: 'ko-hand-ocr',
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);
    const startedAt = performance.now();

    try {
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: controller.signal,
      });
      if (!res.ok) {
        return null;
      }
      const data = (await res.json()) as { text?: string; latencyMs?: number };
      const recognized = typeof data.text === 'string' ? data.text.trim() : '';
      if (!recognized) {
        return null;
      }
      return {
        text: recognized,
        latencyMs: typeof data.latencyMs === 'number' ? data.latencyMs : Math.round(performance.now() - startedAt),
        source: 'ko-hand-ocr',
      };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}
