import { describe, it, expect } from 'vitest';
import { runHeuristicSystem1 } from '../services/system1Jev';
import { runHeuristicSystem2 } from '../services/system2Writer';
import type { InferRequestBody } from '@itnote/shared';

describe('Rejection Refinement & Negative Constraints Tests', () => {
  it('rejectedHypotheses가 주어지면 기각된 문장 내용을 배제하고 새로운 관점의 문장을 생성해야 한다', () => {
    const rejectedSentence = '가상 DOM 오버헤드가 큰 React 대신 Svelte 5와 Hono로 모노레포를 구성하는 계획 맞나요?';

    const req: InferRequestBody = {
      croppedImageBase64: 'data:image/png;base64,dummy',
      previousEvaporatedContext: null,
      rejectedHypotheses: [rejectedSentence],
    };

    const s1 = runHeuristicSystem1(req);
    const newSentence = runHeuristicSystem2({
      decision: s1.decision,
      keywords: s1.keywords,
      request: req,
    });

    // 기각된 원본 문장과 동일하지 않아야 함
    expect(newSentence).not.toBe(rejectedSentence);
    // 대체 관점 (보안/CI-CD/파이프라인) 반영 확인
    expect(newSentence).toContain('보안 파이프라인');
  });

  it('취소선 의도(THOUGHT_PIVOT)가 감지되면 취소된 키워드와 대체 키워드가 함께 반영된 선회 문장을 생성해야 한다', () => {
    const req: InferRequestBody = {
      croppedImageBase64: 'data:image/png;base64,dummy',
      previousEvaporatedContext: null,
      rejectedHypotheses: [],
    };

    const s1 = runHeuristicSystem1(req);
    // 강제로 취소선 의도 부여
    s1.decision.strikethroughIntent.selected = 'THOUGHT_PIVOT';
    s1.keywords.struckOut = ['몽고DB'];
    s1.keywords.active = ['PostgreSQL'];

    const sentence = runHeuristicSystem2({
      decision: s1.decision,
      keywords: s1.keywords,
      request: req,
    });

    expect(sentence).toContain('몽고DB');
    expect(sentence).toContain('PostgreSQL');
    expect(sentence).toContain('선회');
  });
});
