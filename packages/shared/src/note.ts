/**
 * 펜 스트로크, 잉크 클러스터, AI 가설 문장 및 확정 노트 타입 정의
 */

export interface StrokePoint {
  x: number;
  y: number;
  t: number;
  pressure?: number;
  tiltX?: number;
  tiltY?: number;
}

export interface Stroke {
  id: string;
  points: StrokePoint[];
  startTime: number;
  endTime: number;
}

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface InkCluster {
  id: string;
  strokes: Stroke[];
  bbox: BoundingBox;
  createdAt: number;
}

export interface AiHypothesis {
  id: string;
  sentence: string;
  bbox: [number, number, number, number]; // [x, y, width, height]
  createdAt: number;
  isConfirmed: boolean;
  isRejected: boolean;
}

export interface ConfirmedNote {
  id: string;
  sentence: string;
  confirmedAt: number;
  keywords: string[];
  sourceBBox?: [number, number, number, number];
}
