import { describe, it, expect } from 'vitest';
import {
  distance,
  pathLength,
  shoelaceArea,
  getBoundingBox,
  isCircleGesture,
  strokesIntersect,
  countDirectionReversals,
  recognizeOxGesture,
  type Point,
} from '../gestureRecognizer';

describe('gestureRecognizer - O / X 펜 기하학 제스처 판별식', () => {
  const targetBbox: [number, number, number, number] = [100, 100, 400, 80];

  describe('동그라미 (O) 판정 - Shoelace 면적 및 폐곡선 비율', () => {
    it('원형 폐곡선 획은 O 제스처로 정확히 인식되어야 한다', () => {
      // 반경 50인 원형 궤적 (32개 점)
      const points: Point[] = [];
      const centerX = 200;
      const centerY = 140;
      const radius = 50;
      const steps = 32;

      for (let i = 0; i <= steps; i++) {
        const theta = (i / steps) * 2 * Math.PI;
        points.push({
          x: centerX + radius * Math.cos(theta),
          y: centerY + radius * Math.sin(theta),
        });
      }

      const L = pathLength(points);
      const startEndDist = distance(points[0], points[points.length - 1]);
      expect(startEndDist / L).toBeLessThan(0.35);

      const [minX, minY, maxX, maxY] = getBoundingBox(points);
      const bboxArea = (maxX - minX) * (maxY - minY);
      const area = shoelaceArea(points);
      const areaRatio = area / bboxArea;

      // 원의 면적 비율은 pi / 4 ~= 0.785로서 0.35 이상이어야 함
      expect(areaRatio).toBeGreaterThanOrEqual(0.35);
      expect(isCircleGesture(points)).toBe(true);
      expect(recognizeOxGesture([points], targetBbox)).toBe('O');
    });

    it('시작점과 끝점이 멀리 떨어진 열린 호(U자형 곡선)는 O로 판정되지 않아야 한다', () => {
      const openArc: Point[] = [];
      for (let i = 0; i <= 16; i++) {
        const theta = (i / 16) * Math.PI; // 반원
        openArc.push({
          x: 200 + 50 * Math.cos(theta),
          y: 140 + 50 * Math.sin(theta),
        });
      }
      expect(isCircleGesture(openArc)).toBe(false);
      expect(recognizeOxGesture([openArc], targetBbox)).toBe('NONE');
    });

    it('내부 면적이 거의 없는 직선 왕복 획은 O로 판정되지 않아야 한다', () => {
      const flatLine: Point[] = [
        { x: 100, y: 140 },
        { x: 150, y: 140 },
        { x: 200, y: 140 },
        { x: 150, y: 140 },
        { x: 100, y: 140 },
      ];
      expect(isCircleGesture(flatLine)).toBe(false);
    });
  });

  describe('엑스 (X) 판정 - CCW 2획 교차 및 단일 관통/지그재그 취소선', () => {
    it('서로 교차하는 2개의 획은 X 제스처로 정확히 인식되어야 한다', () => {
      const stroke1: Point[] = [
        { x: 150, y: 110 },
        { x: 250, y: 170 },
      ];
      const stroke2: Point[] = [
        { x: 150, y: 170 },
        { x: 250, y: 110 },
      ];

      expect(strokesIntersect(stroke1, stroke2)).toBe(true);
      expect(recognizeOxGesture([stroke1, stroke2], targetBbox)).toBe('X');
    });

    it('교차하지 않는 평행한 2개의 획은 X로 판정되지 않아야 한다', () => {
      const stroke1: Point[] = [
        { x: 150, y: 110 },
        { x: 250, y: 110 },
      ];
      const stroke2: Point[] = [
        { x: 150, y: 150 },
        { x: 250, y: 150 },
      ];

      expect(strokesIntersect(stroke1, stroke2)).toBe(false);
      expect(recognizeOxGesture([stroke1, stroke2], targetBbox)).toBe('NONE');
    });

    it('문장 폭의 40% 이상을 가로지르는 직선형 취소선은 X로 인식되어야 한다', () => {
      // targetBbox 가로폭 400의 50%인 200px 직선 취소선
      const straightThrough: Point[] = [
        { x: 120, y: 140 },
        { x: 180, y: 140 },
        { x: 240, y: 140 },
        { x: 320, y: 140 },
      ];

      expect(recognizeOxGesture([straightThrough], targetBbox)).toBe('X');
    });

    it('문장 위에서 3회 이상 좌우 반전되는 지그재그 덧칠/취소선은 X로 인식되어야 한다', () => {
      const zigzag: Point[] = [
        { x: 150, y: 130 },
        { x: 220, y: 135 }, // 1. 우측 이동
        { x: 160, y: 140 }, // 2. 좌측 반전
        { x: 230, y: 145 }, // 3. 우측 반전
        { x: 155, y: 150 }, // 4. 좌측 반전
        { x: 240, y: 155 }, // 5. 우측 반전
      ];

      const reversals = countDirectionReversals(zigzag);
      expect(reversals).toBeGreaterThanOrEqual(3);
      expect(recognizeOxGesture([zigzag], targetBbox)).toBe('X');
    });

    it('단독 대각선 획(X의 1번째 획)은 2번째 교차 획 없이 단독으로 X로 성급하게 판정되지 않아야 한다', () => {
      // 대각선 획 (\): 가로폭 160px, 세로폭 140px (높이 비율 > 35%)
      const diagonalSlash: Point[] = [
        { x: 150, y: 100 },
        { x: 310, y: 240 },
      ];
      expect(recognizeOxGesture([diagonalSlash], targetBbox)).toBe('NONE');
    });

    it('문장 폭의 40% 미만인 짧은 필기 획은 X로 오인식되지 않아야 한다', () => {
      const shortStroke: Point[] = [
        { x: 120, y: 140 },
        { x: 140, y: 140 }, // 폭 20px (targetWidth 400의 5%)
      ];
      expect(recognizeOxGesture([shortStroke], targetBbox)).toBe('NONE');
    });
  });
});
