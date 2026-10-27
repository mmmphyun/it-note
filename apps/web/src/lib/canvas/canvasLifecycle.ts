import type { Stroke, StrokePoint, AiHypothesis, ConfirmedNote } from '@itnote/shared';
import { calculateDecayState, type DecayState, type SpeedMode } from './decayTimer';
import { extractCroppedStrokes, type CroppedImageResult } from './cropExtractor';
import { recognizeOxGesture, type Point } from './gestureRecognizer';

export interface CanvasLifecycleCallbacks {
  onCropExtracted?: (crop: CroppedImageResult) => void;
  onHypothesisSpawned?: (hypo: AiHypothesis) => void;
  onHypothesisConfirmed?: (note: ConfirmedNote) => void;
  onHypothesisRejected?: (hypo: AiHypothesis) => void;
}

/**
 * 손글씨 특유의 확연한 아날로그 기울기 산출 (0도 부근 데드존 [-0.7°, +0.7°] 배제)
 * - 음수 기울기: -2.4° ~ -0.8° (우하향/좌상향)
 * - 양수 기울기: +0.8° ~ +2.2° (우상향)
 */
export function generateRandomTilt(): number {
  const isPositive = Math.random() >= 0.5;
  if (isPositive) {
    return Number((0.8 + Math.random() * 1.4).toFixed(2));
  } else {
    return Number((-2.4 + Math.random() * 1.6).toFixed(2));
  }
}

/**
 * 총 단어 수에 맞춰 1~3줄로 유동적 균등 분할 (최대 3줄 제약 엄수)
 * - 4단어 이하: 1줄
 * - 5~8단어: 2줄 균등 분할
 * - 9단어 이상: 3줄 균등 분할
 */
export function formatHandwrittenSentence(sentence: string, maxLines = 3): string {
  const words = sentence.trim().split(/\s+/).filter(Boolean);
  const n = words.length;
  if (n <= 4) return sentence;

  const targetLines = Math.min(maxLines, n <= 8 ? 2 : 3);
  const baseCount = Math.floor(n / targetLines);
  let remainder = n % targetLines;

  const lines: string[] = [];
  let index = 0;

  for (let lineIdx = 0; lineIdx < targetLines; lineIdx++) {
    const take = baseCount + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;

    const chunk = words.slice(index, index + take);
    if (chunk.length > 0) {
      lines.push(chunk.join(' '));
    }
    index += take;
  }

  return lines.join('\n');
}

export interface ViewportBounds {
  scrollX: number;
  scrollY: number;
  width: number;
  height: number;
}

/**
 * AI 가설 문장이 사용자의 현재 가시 화면(Viewport) 밖으로 잘리지 않고
 * 100% 화면 내에 안착하도록 위치를 보정 (우측 우선 -> 하단 전환 -> 뷰포트 클램핑)
 */
export function calculateVisibleHypothesisBbox(
  cropBbox: [number, number, number, number], // [minX, minY, maxX, maxY]
  viewport: ViewportBounds,
  boxWidth = 480,
  boxHeight = 110
): [number, number, number, number] {
  const [minX, minY, maxX, maxY] = cropBbox;

  // 가시 영역 계산 (캔버스 좌표계 기준)
  const visMinX = -viewport.scrollX;
  const visMinY = -viewport.scrollY;
  const visMaxX = visMinX + viewport.width;
  const visMaxY = visMinY + viewport.height;

  // 1. 기본 위치: 필기 획의 우측 여백 (+36px)
  let candidateX = maxX + 36;
  let candidateY = minY;

  // 2. 우측 화면 밖으로 넘칠 경우: 획의 아래쪽(+20px)으로 전환
  if (candidateX + boxWidth > visMaxX - 24) {
    candidateX = Math.max(visMinX + 24, minX);
    candidateY = maxY + 24;
  }

  // 3. 하단 화면 밖으로 넘칠 경우: 뷰포트 내부로 상향 보정
  if (candidateY + boxHeight > visMaxY - 24) {
    candidateY = Math.max(visMinY + 24, visMaxY - boxHeight - 24);
  }

  // 4. 좌우 최종 안전 클램핑 (화면 경계 이탈 100% 차단)
  const clampedX = Math.max(visMinX + 24, Math.min(visMaxX - boxWidth - 24, candidateX));
  const clampedY = Math.max(visMinY + 24, Math.min(visMaxY - boxHeight - 24, candidateY));

  return [clampedX, clampedY, boxWidth, boxHeight];
}

export class CanvasLifecycleEngine {
  strokes: Stroke[] = [];
  currentStroke: Stroke | null = null;
  lastPointerUpTime: number | null = null;
  activeHypothesis: AiHypothesis | null = null;
  confirmedNotes: ConfirmedNote[] = [];
  rejectedHypotheses: string[] = [];
  speedMode: SpeedMode = 'normal';
  callbacks: CanvasLifecycleCallbacks;
  currentViewport: ViewportBounds = { scrollX: 0, scrollY: 0, width: 1200, height: 800 };

  // AI 문장 위 O/X 마킹 누적 버퍼 (다중 획 교차 인식 및 오인식 무한 재작성 원천 차단)
  hypothesisGestureStrokes: Point[][] = [];

  private mockSentenceIndex = 0;
  private mockSentences = [
    '가상 DOM 오버헤드가 큰 React 대신 Svelte 5와 Hono로 모노레포를 구성하는 계획 맞나요?',
    '사이드 프로젝트 아키텍처를 순수 TypeScript와 Zero-UI 스타일러스 방식으로 전환하려는 의도인가요?',
    '취소선으로 기각된 가설을 배제하고 클라우드 보안 자동화 루틴을 설계하려는 맥락인가요?',
  ];

  constructor(callbacks: CanvasLifecycleCallbacks = {}, speedMode: boolean | SpeedMode = 'normal') {
    this.callbacks = callbacks;
    this.speedMode = typeof speedMode === 'boolean' ? (speedMode ? 'fast' : 'normal') : speedMode;
  }

  pointerDown(point: StrokePoint): void {
    // 추가 펜 입력 시 30초 대기 타이머 즉시 리셋
    this.lastPointerUpTime = null;

    this.currentStroke = {
      id: `stroke-${point.t}`,
      points: [point],
      startTime: point.t,
      endTime: point.t,
    };
  }

  pointerMove(point: StrokePoint): void {
    if (!this.currentStroke) return;
    this.currentStroke.points.push(point);
    this.currentStroke.endTime = point.t;
  }

  pointerUp(now: number): void {
    if (!this.currentStroke) return;

    // AI 문장 위 O/X 마킹 판정
    if (this.activeHypothesis && !this.activeHypothesis.isConfirmed && !this.activeHypothesis.isRejected) {
      const points: Point[] = this.currentStroke.points.map((p) => ({ x: p.x, y: p.y }));
      const [bx, by, bw, bh] = this.activeHypothesis.bbox;
      const margin = 100;
      const isNear = points.some(
        (p) => p.x >= bx - margin && p.x <= bx + bw + margin && p.y >= by - margin && p.y <= by + bh + margin
      );

      if (isNear) {
        this.hypothesisGestureStrokes.push(points);
        const gesture = recognizeOxGesture(this.hypothesisGestureStrokes, this.activeHypothesis.bbox);

        if (gesture === 'O') {
          this.activeHypothesis.isConfirmed = true;
          this.hypothesisGestureStrokes = [];
          const confirmed: ConfirmedNote = {
            id: `confirmed-${now}`,
            sentence: this.activeHypothesis.sentence,
            confirmedAt: now,
            keywords: ['Svelte 5', 'Hono', 'Zero-UI'],
            sourceBBox: this.activeHypothesis.bbox,
          };
          this.confirmedNotes.push(confirmed);
          this.callbacks.onHypothesisConfirmed?.(confirmed);
          this.currentStroke = null;
          return;
        }

        if (gesture === 'X') {
          this.activeHypothesis.isRejected = true;
          this.hypothesisGestureStrokes = [];
          this.rejectedHypotheses.push(this.activeHypothesis.sentence);
          this.callbacks.onHypothesisRejected?.(this.activeHypothesis);

          // 다음 대안 문장 생성
          const prevBbox = this.activeHypothesis.bbox;
          this.mockSentenceIndex++;
          this.spawnHypothesis(prevBbox, now);
          this.currentStroke = null;
          return;
        }

        // 제스처 판정 대기 중(예: X의 1번째 획): 일반 필기 획에 넣지 않고 보류하여 불필요한 재작성 루프 차단
        if (this.hypothesisGestureStrokes.length > 3) {
          this.hypothesisGestureStrokes = [];
        }
        this.currentStroke = null;
        return;
      }
    }

    this.strokes.push(this.currentStroke);
    this.currentStroke = null;
    this.lastPointerUpTime = now;
  }

  tick(now: number): DecayState {
    if (this.lastPointerUpTime === null || this.strokes.length === 0 || this.currentStroke !== null) {
      return { opacity: 1, isEvaporated: false, phase: 'idle' };
    }

    const elapsed = now - this.lastPointerUpTime;
    const decay = calculateDecayState(elapsed, this.speedMode);

    if (decay.isEvaporated) {
      const cropped = extractCroppedStrokes(this.strokes);
      if (cropped) {
        this.callbacks.onCropExtracted?.(cropped);
        this.spawnHypothesis(cropped.bbox, now);
      }
      this.strokes = [];
      this.lastPointerUpTime = null;
    }

    return decay;
  }

  setViewport(viewport: ViewportBounds): void {
    this.currentViewport = viewport;
  }

  spawnHypothesis(bbox: [number, number, number, number], now: number): void {
    const rawSentence = this.mockSentences[this.mockSentenceIndex % this.mockSentences.length];
    const formattedSentence = formatHandwrittenSentence(rawSentence);
    const tiltDeg = generateRandomTilt();

    // 뷰포트 가시 영역 보정: 사용자가 보고 있는 화면 밖으로 잘림 방지
    const adjustedBbox = calculateVisibleHypothesisBbox(bbox, this.currentViewport, 480, 105);

    const hypothesis: AiHypothesis = {
      id: `hypo-${now}`,
      sentence: formattedSentence,
      bbox: adjustedBbox,
      createdAt: now,
      isConfirmed: false,
      isRejected: false,
      tiltDeg,
    };
    this.activeHypothesis = hypothesis;
    this.callbacks.onHypothesisSpawned?.(hypothesis);
  }
}
