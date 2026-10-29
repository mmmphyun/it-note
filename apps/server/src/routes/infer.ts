import { Hono } from 'hono';
import type { InferRequestBody, JevDecisionResult } from '@itnote/shared';
import { runSystem1Jev } from '../services/system1Jev';
import { runSystem2Writer } from '../services/system2Writer';

export const inferRoute = new Hono();

// Zero-retention 원칙: 원본 필기 이미지는 디스크에 기록하지 않고 메모리에서 처리 후 즉시 해제
inferRoute.post('/', async (c) => {
  let body: InferRequestBody;
  try {
    body = await c.req.json<InferRequestBody>();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.croppedImageBase64 && !body.rawTextInput) {
    return c.json({ error: 'croppedImageBase64 or rawTextInput is required' }, 400);
  }

  // 1. System 1 (Jev/OpenJev 의사결정)
  const system1Output = await runSystem1Jev(body);

  // 2. System 2 (단일 문장 생성)
  const sentence = await runSystem2Writer({
    decision: system1Output.decision,
    keywords: system1Output.keywords,
    request: body,
  });

  const response: JevDecisionResult = {
    jevDecision: system1Output.decision,
    extractedKeywords: system1Output.keywords,
    sentence,
  };

  return c.json(response);
});
