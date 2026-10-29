import { describe, it, expect } from 'vitest';
import { runHeuristicSystem1 } from '../services/system1Jev';
import { runHeuristicSystem2 } from '../services/system2Writer';

describe('동그라미 선택 및 텍스트 피드백 자율 판별 엔진 검증', () => {
  it('단어에 동그라미 선택 표기 시 chosenKeywords 추출 및 SELECTION_PIVOT 단일 문장을 생성해야 함', () => {
    const s1 = runHeuristicSystem1({
      rawTextInput: '국밥 -> 순대, (수육)',
      previousEvaporatedContext: '오늘 점심 메뉴',
    });

    expect(s1.keywords.chosen).toContain('수육');
    expect(s1.decision.actionTask?.selected).toBe('SELECTION_PIVOT');

    const sentence = runHeuristicSystem2({
      decision: s1.decision,
      keywords: s1.keywords,
      request: { rawTextInput: '국밥 -> 순대, (수육)' },
    });

    expect(sentence).toContain('수육');
    expect(sentence).toContain('결정');
  });

  it('활성 가설이 존재하는 상태에서 긍정 텍스트("응") 입력 시 CONFIRM_ACCEPT로 분류해야 함', () => {
    const s1 = runHeuristicSystem1({
      rawTextInput: '응 맞아',
      activeHypothesisSentence: '오늘 점심은 순대국밥 어떠신가요?',
    });

    expect(s1.decision.inputClassification?.selected).toBe('FEEDBACK_REPLY');
    expect(s1.decision.feedbackIntent?.selected).toBe('CONFIRM_ACCEPT');

    const sentence = runHeuristicSystem2({
      decision: s1.decision,
      keywords: s1.keywords,
      request: {
        rawTextInput: '응 맞아',
        activeHypothesisSentence: '오늘 점심은 순대국밥 어떠신가요?',
      },
    });

    expect(sentence).toContain('동의');
    expect(sentence).toContain('확정');
  });

  it('활성 가설이 존재하는 상태에서 부정 텍스트("아니") 입력 시 REJECT_CANCEL로 분류해야 함', () => {
    const s1 = runHeuristicSystem1({
      rawTextInput: '아니 순대국밥 말고',
      activeHypothesisSentence: '오늘 점심은 순대국밥 어떠신가요?',
    });

    expect(s1.decision.inputClassification?.selected).toBe('FEEDBACK_REPLY');
    expect(s1.decision.feedbackIntent?.selected).toBe('REJECT_CANCEL');

    const sentence = runHeuristicSystem2({
      decision: s1.decision,
      keywords: s1.keywords,
      request: {
        rawTextInput: '아니 순대국밥 말고',
        activeHypothesisSentence: '오늘 점심은 순대국밥 어떠신가요?',
      },
    });

    expect(sentence).toContain('기각');
  });
});
