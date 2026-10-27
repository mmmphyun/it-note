/**
 * O / X 제스처 기하학 판별 모듈 (Shoelace, CCW, 관통선)
 */

export interface Point {
  x: number;
  y: number;
}

export type GestureType = 'O' | 'X' | 'NONE';

/**
 * 두 점 사이의 유클리드 거리
 */
export function distance(p1: Point, p2: Point): number {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

/**
 * 획의 총 경로 길이 (L)
 */
export function pathLength(points: Point[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += distance(points[i - 1], points[i]);
  }
  return len;
}

/**
 * 획의 바운딩 박스 [minX, minY, maxX, maxY]
 */
export function getBoundingBox(points: Point[]): [number, number, number, number] {
  if (points.length === 0) return [0, 0, 0, 0];
  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return [minX, minY, maxX, maxY];
}

/**
 * 신발끈 공식(Shoelace formula)으로 다각형 내부 면적 계산
 */
export function shoelaceArea(points: Point[]): number {
  const n = points.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    sum += points[i].x * points[next].y - points[next].x * points[i].y;
  }
  return Math.abs(sum) / 2;
}

/**
 * CCW (Counter Clockwise) 외적 부호 판정
 */
function ccw(a: Point, b: Point, c: Point): number {
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (Math.abs(cross) < 1e-9) return 0;
  return cross > 0 ? 1 : -1;
}

/**
 * 두 선분 AB와 CD의 교차 여부 판정
 */
export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const ccw1 = ccw(a, b, c) * ccw(a, b, d);
  const ccw2 = ccw(c, d, a) * ccw(c, d, b);
  return ccw1 < 0 && ccw2 < 0;
}

/**
 * 두 획이 서로 교차하는지 검사
 */
export function strokesIntersect(stroke1: Point[], stroke2: Point[]): boolean {
  for (let i = 1; i < stroke1.length; i++) {
    for (let j = 1; j < stroke2.length; j++) {
      if (segmentsIntersect(stroke1[i - 1], stroke1[i], stroke2[j - 1], stroke2[j])) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 수평 방향 반전(지그재그 꺾임) 횟수 계산
 */
export function countDirectionReversals(points: Point[]): number {
  if (points.length < 3) return 0;
  let reversals = 0;
  let lastSign = 0;

  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    if (Math.abs(dx) > 3) {
      const sign = dx > 0 ? 1 : -1;
      if (lastSign !== 0 && sign !== lastSign) {
        reversals++;
      }
      lastSign = sign;
    }
  }
  return reversals;
}

/**
 * 단일 획의 동그라미(O) 여부 판정
 */
export function isCircleGesture(points: Point[]): boolean {
  if (points.length < 5) return false;
  const L = pathLength(points);
  if (L < 20) return false;

  const startEndDist = distance(points[0], points[points.length - 1]);
  const closureRatio = startEndDist / L;
  if (closureRatio >= 0.35) return false;

  const [minX, minY, maxX, maxY] = getBoundingBox(points);
  const bboxArea = (maxX - minX) * (maxY - minY);
  if (bboxArea <= 0) return false;

  const area = shoelaceArea(points);
  const areaRatio = area / bboxArea;
  return areaRatio >= 0.35;
}

/**
 * AI 문장 바운딩 박스 위에서 그어진 획들의 O / X 제스처 판정
 * targetBbox: [x, y, width, height]
 */
export function recognizeOxGesture(
  strokes: Point[][],
  targetBbox: [number, number, number, number]
): GestureType {
  if (strokes.length === 0) return 'NONE';

  // 1. 단일 획 검사
  if (strokes.length === 1) {
    const stroke = strokes[0];
    if (isCircleGesture(stroke)) {
      return 'O';
    }

    // 단일 획 취소선 / 엑스 판정
    const L = pathLength(stroke);
    if (L < 15) return 'NONE';

    const [minX, , maxX] = getBoundingBox(stroke);
    const strokeWidth = maxX - minX;
    const targetWidth = targetBbox[2];

    const spansTarget = strokeWidth >= targetWidth * 0.4;
    const startEndDist = distance(stroke[0], stroke[stroke.length - 1]);
    const linearity = startEndDist / L;
    const reversals = countDirectionReversals(stroke);

    const spansTargetAndStraight = spansTarget && linearity > 0.75;
    const isZigzagScratch = reversals >= 3;

    if (spansTargetAndStraight || isZigzagScratch) {
      return 'X';
    }
    return 'NONE';
  }

  // 2. 2개 획 교차 검사 (X)
  if (strokes.length === 2) {
    if (strokesIntersect(strokes[0], strokes[1])) {
      return 'X';
    }
  }

  return 'NONE';
}
