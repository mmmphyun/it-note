import type { Stroke } from '@itnote/shared';
import { getStroke } from 'perfect-freehand';

export interface CroppedImageResult {
  bbox: [number, number, number, number]; // [minX, minY, maxX, maxY]
  base64: string;
  strokeCount: number;
}

/**
 * 증발 직전 필기 획의 최소 바운딩 박스를 메모리 상에서 PNG Base64로 추출
 * 로컬 디스크 파일시스템에는 저장하지 않음 (Zero-Retention)
 */
export function extractCroppedStrokes(
  strokes: Stroke[],
  padding = 16
): CroppedImageResult | null {
  if (strokes.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const s of strokes) {
    for (const p of s.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }

  if (minX === Infinity || minY === Infinity) return null;

  const width = Math.max(1, Math.ceil(maxX - minX + padding * 2));
  const height = Math.max(1, Math.ceil(maxY - minY + padding * 2));

  // Node 테스트 환경 방어
  if (typeof document === 'undefined') {
    return {
      bbox: [minX, minY, maxX, maxY],
      base64: 'data:image/png;base64,MOCK_BUFFER',
      strokeCount: strokes.length,
    };
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#FAF8F5';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#222222';

  for (const s of strokes) {
    const points = s.points.map((p) => [
      p.x - minX + padding,
      p.y - minY + padding,
      p.pressure ?? 0.5,
    ]);
    const outline = getStroke(points, {
      size: 4,
      thinning: 0.5,
      smoothing: 0.5,
      streamline: 0.5,
    });
    if (outline.length < 2) continue;

    ctx.beginPath();
    ctx.moveTo(outline[0][0], outline[0][1]);
    for (let i = 1; i < outline.length; i++) {
      ctx.lineTo(outline[i][0], outline[i][1]);
    }
    ctx.closePath();
    ctx.fill();
  }

  return {
    bbox: [minX, minY, maxX, maxY],
    base64: canvas.toDataURL('image/png'),
    strokeCount: strokes.length,
  };
}
