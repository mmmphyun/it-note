import { describe, it, expect } from 'vitest';
import { runHeuristicSystem1 } from '../services/system1Jev';
import { runHeuristicSystem2 } from '../services/system2Writer';
import type { InferRequestBody } from '@itnote/shared';

describe('Continuity & Input Classification Tests', () => {
  it('직전 증발 키워드가 존재할 때 isContinuousWithPrevious (Noul)이 true로 판정되어야 한다', () => {
    const reqWithPrev: InferRequestBody = {
      croppedImageBase64: 'data:image/png;base64,dummy',
      previousEvaporatedContext: 'Svelte 5 캔버스 아키텍처',
      rejectedHypotheses: [],
    };

    const s1 = runHeuristicSystem1(reqWithPrev);
    expect(s1.decision.isContinuousWithPrevious.value).toBe(true);
    expect(s1.decision.isContinuousWithPrevious.probability).toBeGreaterThanOrEqual(0.8);

    const sentence = runHeuristicSystem2({
      decision: s1.decision,
      keywords: { active: ['Hono 백엔드'], struckOut: [] },
      request: reqWithPrev,
    });

    expect(sentence).toContain('Svelte 5 캔버스 아키텍처');
    expect(sentence).toContain('Hono 백엔드');
  });

  it('직전 증발 키워드가 없을 때 isContinuousWithPrevious (Noul)이 false로 판정되어야 한다', () => {
    const reqWithoutPrev: InferRequestBody = {
      croppedImageBase64: 'data:image/png;base64,dummy',
      previousEvaporatedContext: null,
      rejectedHypotheses: [],
    };

    const s1 = runHeuristicSystem1(reqWithoutPrev);
    expect(s1.decision.isContinuousWithPrevious.value).toBe(false);
    expect(s1.decision.isContinuousWithPrevious.probability).toBeLessThan(0.5);
  });

  it('화면에 AI 문장이 활성화되어 있을 때 사용자의 새 입력은 FEEDBACK_REPLY로 분류되어야 한다', () => {
    const reqWithActiveHypo: InferRequestBody = {
      croppedImageBase64: 'data:image/png;base64,dummy',
      activeHypothesisSentence: '가상 DOM 오버헤드가 큰 React 대신 Svelte 5를 채택하려는 계획 맞나요?',
      rejectedHypotheses: [],
    };

    const s1 = runHeuristicSystem1(reqWithActiveHypo);
    expect(s1.decision.inputClassification?.selected).toBe('FEEDBACK_REPLY');

    const sentence = runHeuristicSystem2({
      decision: s1.decision,
      keywords: { active: ['Redis 캐시 추가'], struckOut: [] },
      request: reqWithActiveHypo,
    });

    // 답장/보충 설명 피드백이 문장에 반영되어야 함
    expect(sentence).toContain('피드백');
  });

  it('화면에 AI 문장이 없을 때는 NEW_INDEPENDENT_MEMO로 분류되어야 한다', () => {
    const reqIndependent: InferRequestBody = {
      croppedImageBase64: 'data:image/png;base64,dummy',
      activeHypothesisSentence: null,
      rejectedHypotheses: [],
    };

    const s1 = runHeuristicSystem1(reqIndependent);
    expect(s1.decision.inputClassification?.selected).toBe('NEW_INDEPENDENT_MEMO');
  });
});
