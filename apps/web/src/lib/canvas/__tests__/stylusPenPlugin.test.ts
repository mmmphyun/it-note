import { describe, it, expect } from 'vitest';
import {
  interpolateAirGlide,
  calculateGlideDuration,
  createAirGlidePlugin
} from '../stylusPenPlugin';

describe('stylusPenPlugin: Air-Glide Interpolation', () => {
  const p0 = { x: 10, y: 20 };
  const p1 = { x: 110, y: 70 };

  it('u=0일 때 정확히 시작점(p0)의 좌표를 반환해야 함', () => {
    const pos = interpolateAirGlide(p0, p1, 0);
    expect(pos.x).toBeCloseTo(10, 5);
    expect(pos.y).toBeCloseTo(20, 5);
  });

  it('u=1일 때 정확히 도착점(p1)의 좌표를 반환해야 함', () => {
    const pos = interpolateAirGlide(p0, p1, 1);
    expect(pos.x).toBeCloseTo(110, 5);
    expect(pos.y).toBeCloseTo(70, 5);
  });

  it('공중 이동 중간(u=0.5)에서 x는 중간점에 도달하고 y는 공중 부양 리프트(위로 들림)가 적용되어야 함', () => {
    const pos = interpolateAirGlide(p0, p1, 0.5);
    // x 중간점: 10 + (110 - 10) * 0.5 = 60
    expect(pos.x).toBeCloseTo(60, 1);
    // 단순 선형 y 중간점은 45이나, 위로 살짝 뜨므로(y 감소) 45보다 작아야 함
    expect(pos.y).toBeLessThan(45);
  });

  it('거리가 멀수록 공중 이동 시간이 증가하되 상한과 하한 내에 위치해야 함', () => {
    const factor = 1.8; // 레벨 4 기준
    const shortDuration = calculateGlideDuration(10, factor); // 10px 이동
    const longDuration = calculateGlideDuration(200, factor); // 200px 이동

    expect(shortDuration).toBeGreaterThan(0);
    expect(longDuration).toBeGreaterThan(shortDuration);
    expect(shortDuration).toBeGreaterThanOrEqual(0.03 * factor);
    expect(longDuration).toBeLessThanOrEqual(0.25 * factor);
  });

  it('createAirGlidePlugin의 timing 훅이 획 사이에 공중 이동 시간을 올바르게 배분해야 함', () => {
    const plugin = createAirGlidePlugin({
      speedLevel: 4,
      onPosition: () => {},
    });

    expect(plugin.name).toBe('stylus-air-glide');
    expect(typeof plugin.timing).toBe('function');
    expect(typeof plugin.onFrame).toBe('function');

    // 모의 획 데이터 2개 생성
    const mockCtx = {
      duration: 2.0,
      fontSize: 32,
      random: () => () => 0.5,
      strokes: [
        {
          start: 0,
          duration: 0.5,
          path: {
            pointAt: (t: number) => (t === 0 ? { x: 0, y: 0 } : { x: 50, y: 20 }),
          },
        },
        {
          start: 0.5,
          duration: 0.6,
          path: {
            pointAt: (t: number) => (t === 0 ? { x: 80, y: 30 } : { x: 120, y: 60 }),
          },
        },
      ],
    };

    // @ts-expect-error 모의 객체 전달
    const timed = plugin.timing!(mockCtx);
    expect(timed).toBeDefined();
    expect(timed!.strokes).toHaveLength(2);

    const s0 = timed!.strokes[0];
    const s1 = timed!.strokes[1];

    expect(s0.start).toBe(0);
    expect(s0.duration).toBe(0.5);

    // s1의 시작은 s0의 종료(0.5)보다 뒤여야 함 (공중 이동 시간 부여)
    expect(s1.start).toBeGreaterThan(0.5);
    expect(s1.duration).toBe(0.6);
  });
});
