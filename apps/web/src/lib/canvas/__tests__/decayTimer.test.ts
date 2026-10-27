import { describe, it, expect } from 'vitest';
import { calculateDecayState } from '../decayTimer';

describe('decayTimer - 30초 대기 + 60초 증발 상태 머신', () => {
  it('일반 모드: 0초부터 30초(30,000ms)까지는 불투명도 1.0 및 idle 상태를 유지해야 한다', () => {
    expect(calculateDecayState(0, false)).toEqual({
      opacity: 1,
      isEvaporated: false,
      phase: 'idle',
    });

    expect(calculateDecayState(15000, false)).toEqual({
      opacity: 1,
      isEvaporated: false,
      phase: 'idle',
    });

    expect(calculateDecayState(29999, false)).toEqual({
      opacity: 1,
      isEvaporated: false,
      phase: 'idle',
    });
  });

  it('일반 모드: 30초 이후부터 90초까지 60초 동안 불투명도가 선형 감소해야 한다', () => {
    // 30초 경과 시점: 시작 (1.0)
    const at30s = calculateDecayState(30000, false);
    expect(at30s.opacity).toBeCloseTo(1.0, 5);
    expect(at30s.phase).toBe('fading');
    expect(at30s.isEvaporated).toBe(false);

    // 60초 경과 시점: 절반 (0.5)
    const at60s = calculateDecayState(60000, false);
    expect(at60s.opacity).toBeCloseTo(0.5, 5);
    expect(at60s.phase).toBe('fading');
    expect(at60s.isEvaporated).toBe(false);

    // 75초 경과 시점: 3/4 진행 (0.25)
    const at75s = calculateDecayState(75000, false);
    expect(at75s.opacity).toBeCloseTo(0.25, 5);
    expect(at75s.phase).toBe('fading');
    expect(at75s.isEvaporated).toBe(false);
  });

  it('일반 모드: 90초(90,000ms) 이상 경과 시 증발 완료(isEvaporated: true, opacity: 0)여야 한다', () => {
    const at90s = calculateDecayState(90000, false);
    expect(at90s.opacity).toBe(0);
    expect(at90s.isEvaporated).toBe(true);
    expect(at90s.phase).toBe('evaporated');

    const at120s = calculateDecayState(120000, false);
    expect(at120s.opacity).toBe(0);
    expect(at120s.isEvaporated).toBe(true);
  });

  it('패스트 디버그 모드 (?fast=1): 3초 대기 후 5초 동안 선형 증발(총 8초)해야 한다', () => {
    // 0 ~ 3초 대기
    expect(calculateDecayState(1500, true)).toEqual({
      opacity: 1,
      isEvaporated: false,
      phase: 'idle',
    });

    // 3초 ~ 8초 증발 (5.5초 경과 시점 -> (5500 - 3000)/5000 = 0.5 진행 -> opacity 0.5)
    const midFade = calculateDecayState(5500, true);
    expect(midFade.opacity).toBeCloseTo(0.5, 5);
    expect(midFade.phase).toBe('fading');
    expect(midFade.isEvaporated).toBe(false);

    // 8초 이상: 완전 증발
    const evaporated = calculateDecayState(8000, true);
    expect(evaporated.opacity).toBe(0);
    expect(evaporated.isEvaporated).toBe(true);
    expect(evaporated.phase).toBe('evaporated');
  });
});
