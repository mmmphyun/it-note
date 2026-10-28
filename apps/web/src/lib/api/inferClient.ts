import type { InferRequestBody, InferResponseBody } from '@itnote/shared';

// ponytail: native fetch api client with graceful fallback

export async function requestInference(req: InferRequestBody): Promise<InferResponseBody | null> {
  try {
    const res = await fetch('/api/infer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });

    if (!res.ok) {
      return null;
    }

    return (await res.json()) as InferResponseBody;
  } catch {
    return null;
  }
}
