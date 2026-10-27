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
 * 텍스트 공백 정돈 (Tegaki HarfBuzz 셰이퍼가 CSS 너비에 따라 정상 자간으로 자동 개행)
 */
export function formatHandwrittenSentence(sentence: string): string {
  return sentence.trim().replace(/\s+/g, ' ');
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

  // 화면 우측 가용 폭 계산
  const availableRight = visMaxX - candidateX - 24;

  // 2. 우측 화면 밖으로 넘칠 경우: 획의 아래쪽(+24px)으로 전환
  if (availableRight < 380) {
    candidateX = Math.max(visMinX + 24, minX);
    candidateY = maxY + 24;
  }

  // 3. 하단 화면 밖으로 넘칠 경우: 뷰포트 내부로 상향 보정
  if (candidateY + boxHeight > visMaxY - 24) {
    candidateY = Math.max(visMinY + 24, visMaxY - boxHeight - 24);
  }

  // 4. 가용 폭에 맞춘 동적 너비 산출 (기본 480px, 최대 가용 공간에 맞춤)
  const dynamicWidth = Math.max(400, Math.min(boxWidth, visMaxX - candidateX - 24));

  // 5. 좌우 최종 안전 클램핑 (화면 경계 이탈 100% 차단)
  const clampedX = Math.max(visMinX + 24, Math.min(visMaxX - dynamicWidth - 24, candidateX));
  const clampedY = Math.max(visMinY + 24, Math.min(visMaxY - boxHeight - 24, candidateY));

  return [clampedX, clampedY, dynamicWidth, boxHeight];
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

  // AI 문장 위 O/X 마킹 누적 버퍼 및 입력 멈춤 감지 유예 타이머 (다중 획 및 단어 인식 지원)
  hypothesisGestureStrokes: Point[][] = [];
  lastGesturePointerUpTime: number | null = null;
  gestureIdleGraceMs: number = 1500;

  // 기각 시 스모크아웃 애니메이션(650ms) 후 다음 대안 문장 지연 생성 타이머
  pendingNextHypothesisTime: number | null = null;
  pendingNextHypothesisBbox: [number, number, number, number] | null = null;

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
    // 추가 펜 입력 시 30초 대기 타이머 및 제스처 유예 타이머 리셋
    this.lastPointerUpTime = null;
    this.lastGesturePointerUpTime = null;

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

  private executeHypothesisAction(gesture: 'O' | 'X', now: number): void {
    if (!this.activeHypothesis) return;

    if (gesture === 'O') {
      this.activeHypothesis.isConfirmed = true;
      this.hypothesisGestureStrokes = [];
      this.lastGesturePointerUpTime = null;
      const confirmed: ConfirmedNote = {
        id: `confirmed-${now}`,
        sentence: this.activeHypothesis.sentence,
        confirmedAt: now,
        keywords: ['Svelte 5', 'Hono', 'Zero-UI'],
        sourceBBox: this.activeHypothesis.bbox,
      };
      this.confirmedNotes.push(confirmed);
      this.callbacks.onHypothesisConfirmed?.(confirmed);
      return;
    }

    if (gesture === 'X') {
      this.activeHypothesis.isRejected = true;
      this.hypothesisGestureStrokes = [];
      this.lastGesturePointerUpTime = null;
      this.rejectedHypotheses.push(this.activeHypothesis.sentence);
      this.callbacks.onHypothesisRejected?.(this.activeHypothesis);

      // 650ms 동안 스모크아웃(연기 소멸) 애니메이션을 온전히 표출한 뒤 대안 문장 생성
      this.pendingNextHypothesisTime = now + 650;
      this.pendingNextHypothesisBbox = this.activeHypothesis.bbox;
      return;
    }
  }

  pointerUp(now: number): void {
    if (!this.currentStroke) return;

    // AI 문장 활성화 중: 사용자의 모든 펜 입력은 AI 피드백/의사표현 버퍼로 누적 수집 (반경 제한 폐기)
    if (this.activeHypothesis && !this.activeHypothesis.isConfirmed && !this.activeHypothesis.isRejected) {
      const points: Point[] = this.currentStroke.points.map((p) => ({ x: p.x, y: p.y }));
      this.hypothesisGestureStrokes.push(points);

      // 사용자 입력 멈춤 감지를 위한 1500ms 유예 타이머 시작 (다중 획 X, '응', '맞아', '아니' 등)
      this.lastGesturePointerUpTime = now;
      this.currentStroke = null;
      return;
    }

    this.strokes.push(this.currentStroke);
    this.currentStroke = null;
    this.lastPointerUpTime = now;
  }

  tick(now: number): DecayState {
    // 0. 기각 후 지연된 대안 문장 생성 타이머 평가 (650ms 스모크아웃 보장)
    if (this.pendingNextHypothesisTime !== null && now >= this.pendingNextHypothesisTime) {
      this.pendingNextHypothesisTime = null;
      this.mockSentenceIndex++;
      const bbox = this.pendingNextHypothesisBbox ?? [180, 140, 420, 200];
      this.pendingNextHypothesisBbox = null;
      this.spawnHypothesis(bbox, now);
    }

    // 1. AI 문장 제스처/단어 다중 획 입력 유예 타이머 평가 (사용자 입력이 1.5초간 멈춘 후 최종 판정)
    if (
      this.lastGesturePointerUpTime !== null &&
      this.hypothesisGestureStrokes.length > 0 &&
      this.activeHypothesis &&
      !this.activeHypothesis.isConfirmed &&
      !this.activeHypothesis.isRejected
    ) {
      const elapsedGesture = now - this.lastGesturePointerUpTime;
      if (elapsedGesture >= this.gestureIdleGraceMs) {
        this.lastGesturePointerUpTime = null;
        const gesture = recognizeOxGesture(this.hypothesisGestureStrokes, this.activeHypothesis.bbox);

        if (gesture === 'O' || gesture === 'X') {
          this.executeHypothesisAction(gesture, now);
        }
      }
    }

    // 2. AI 가설이 활성화 중인 동안에는 일반 메모 잉크 증발 및 조기 재작성 전면 동결
    if (this.activeHypothesis && !this.activeHypothesis.isConfirmed && !this.activeHypothesis.isRejected) {
      return { opacity: 1, isEvaporated: false, phase: 'idle' };
    }

    // 3. 일반 메모 잉크 증발 타이머
    if (this.lastPointerUpTime === null || this.strokes.length === 0 || this.currentStroke !== null) {
      return { opacity: 1, isEvaporated: false, phase: 'idle' };
    }

    const elapsed = now - this.lastPointerUpTime;
    const decay = calculateDecayState(elapsed, this.speedMode);

    if (decay.isEvaporated) {
      const cropped = extractCroppedStrokes(this.strokes);
      // AI 가설 문장이 이미 표시 중인 동안에는 중복 재생성을 원천 차단
      if (cropped && !this.activeHypothesis) {
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
