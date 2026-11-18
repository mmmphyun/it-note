import type { InferRequestBody, InferResponseBody } from '@itnote/shared';

// ponytail: native fetch api client with explicit key-error propagation

let lastInferErrorMessage: string | null = null;

export function getLastInferError(): string | null {
  return lastInferErrorMessage;
}

export async function requestInference(req: InferRequestBody): Promise<InferResponseBody | null> {
  lastInferErrorMessage = null;
  try {
    const res = await fetch('/api/infer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { error?: string };
      lastInferErrorMessage =
        errBody.error ||
        `AI 추론 요청 실패 (HTTP ${res.status}). API 키 연결 상태를 확인해 주세요.`;
      return null;
    }

    return (await res.json()) as InferResponseBody;
  } catch {
    lastInferErrorMessage = 'AI 서버 또는 API 키가 연결되지 않았습니다.';
    return null;
  }
}
