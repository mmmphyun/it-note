import { describe, it, expect } from 'vitest';
import { app } from '../index';
import { runHeuristicSystem1 } from '../services/system1Jev';
import type { InferRequestBody } from '@itnote/shared';

describe('System 1 Jev Adapter & API Schema', () => {
  it('runHeuristicSystem1은 유효한 JevDecision 규격(Noul, Choice, Box)을 반환해야 한다', () => {
    const req: InferRequestBody = {
      croppedImageBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      strokeMetadata: {
        strokeCount: 4,
        bbox: [100, 120, 350, 220],
        canvasSize: [2400, 1800],
      },
      previousEvaporatedContext: null,
      rejectedHypotheses: [],
    };

    const result = runHeuristicSystem1(req);

    // Noul 규격 검증
    expect(result.decision.isContinuousWithPrevious.type).toBe('noul');
    expect(typeof result.decision.isContinuousWithPrevious.probability).toBe('number');
    expect(typeof result.decision.isContinuousWithPrevious.value).toBe('boolean');

    // Choice 규격 검증
    expect(result.decision.strikethroughIntent.type).toBe('choice');
    expect(['THOUGHT_PIVOT', 'TYPO_CORRECTION', 'NONE']).toContain(result.decision.strikethroughIntent.selected);

    // Box 규격 검증
    expect(result.decision.marginBox.type).toBe('box');
    expect(result.decision.marginBox.coordinates.length).toBe(4);
    expect(result.decision.marginBox.coordinates[0]).toBeGreaterThanOrEqual(350); // 필기 우측 여백 (+36)
  });

  it('POST /api/infer 엔드포인트는 Hono 요청을 받아 200과 JevDecisionResult를 반환해야 한다', async () => {
    const reqBody: InferRequestBody = {
      croppedImageBase64: 'data:image/png;base64,test-image',
      strokeMetadata: {
        strokeCount: 8,
        bbox: [100, 120, 420, 260],
        canvasSize: [2400, 1800],
      },
      previousEvaporatedContext: null,
      rejectedHypotheses: [],
      userContext: {
        persona: { role: 'DevSecOps 취준생', interests: ['사이드 프로젝트', '보안'] },
      },
    };

    const res = await app.request('/api/infer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('jevDecision');
    expect(json).toHaveProperty('extractedKeywords');
    expect(json).toHaveProperty('sentence');
    expect(typeof json.sentence).toBe('string');
  });

  it('croppedImageBase64 누락 시 400 Bad Request를 반환해야 한다', async () => {
    const res = await app.request('/api/infer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strokeMetadata: { strokeCount: 0, bbox: [0, 0, 0, 0], canvasSize: [0, 0] } }),
    });

    expect(res.status).toBe(400);
  });
});
