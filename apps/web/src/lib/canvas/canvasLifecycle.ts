import type { Stroke, StrokePoint, AiHypothesis, ConfirmedNote, InferRequestBody, InferResponseBody } from '@itnote/shared';
import { calculateDecayState, type DecayState, type SpeedMode } from './decayTimer';
import { extractCroppedStrokes, type CroppedImageResult } from './cropExtractor';
import { recognizeOxGesture, type Point } from './gestureRecognizer';

export interface CanvasLifecycleCallbacks {
  onCropExtracted?: (crop: CroppedImageResult) => void;
  onHypothesisSpawned?: (hypo: AiHypothesis) => void;
  onHypothesisConfirmed?: (note: ConfirmedNote) => void;
  onHypothesisRejected?: (hypo: AiHypothesis) => void;
  onInferRequested?: (req: InferRequestBody) => Promise<InferResponseBody | null>;
  onFeedbackRefined?: (newSentence: string) => void;
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
 * 단어들의 예상 렌더링 픽셀 너비를 산출 (Nanum Pen Script 32px 기준 여유 마진 적용)
 * - 한글 글자당 약 24px (fontSize * 0.75)
 * - 영문 대문자 약 19.2px (fontSize * 0.60)
 * - 영문 소문자/숫자/기호 약 14.4px (fontSize * 0.45)
 * - 공백(space) 약 14px
 */
export function estimateWordWidth(word: string, fontSize = 32): number {
  let width = 0;
  for (let i = 0; i < word.length; i++) {
    const code = word.charCodeAt(i);
    if (code >= 0xac00 && code <= 0xd7a3) {
      width += fontSize * 0.75;
    } else if (code >= 65 && code <= 90) {
      width += fontSize * 0.6;
    } else {
      width += fontSize * 0.45;
    }
  }
  return width;
}

/**
 * AI 가설 문장을 가용 폭(availableWidth)과 어절 너비에 맞춰 수학적으로 자동 개행.
 * 단어 중간 절단(soft-break)을 원천 차단하여 브라우저 Range 측정 오차 및 자간 왜곡 방지.
 * 
 * @param sentence 원본 문장
 * @param availableWidth 현재 위치에서 가용 가능한 최대 너비 (기본 520px, 최소 300px)
 * @param maxLines 허용 최대 줄 수 (기본 3)
 */
export function formatHandwrittenSentence(
  sentence: string,
  availableWidth = 520,
  maxLines = 3
): string {
  const words = sentence.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 3) return sentence.trim();

  const spaceWidth = 14;
  const effectiveWidth = Math.max(300, Math.min(680, availableWidth));

  const lines: string[] = [];
  let currentLineWords: string[] = [];
  let currentLineWidth = 0;

  for (const word of words) {
    const wordW = estimateWordWidth(word);
    const needed = currentLineWords.length === 0 ? wordW : currentLineWidth + spaceWidth + wordW;

    if (needed > effectiveWidth && currentLineWords.length > 0 && lines.length < maxLines - 1) {
      lines.push(currentLineWords.join(' '));
      currentLineWords = [word];
      currentLineWidth = wordW;
    } else {
      currentLineWords.push(word);
      currentLineWidth = needed;
    }
  }

  if (currentLineWords.length > 0) {
    lines.push(currentLineWords.join(' '));
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
  preferredWidth = 520,
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

  // 화면 우측 가용 폭 계산 (화면 경계 마진 24px)
  const availableRight = visMaxX - candidateX - 24;

  // 2. 우측 화면 공간이 부족한 경우 (최소 320px 미확보 시): 획의 아래쪽(+24px)으로 전환
  if (availableRight < 320) {
    candidateX = Math.max(visMinX + 24, minX);
    candidateY = maxY + 24;
  }

  // 3. 뷰포트 내 잔여 가용 너비 계산 (최소 320px, 최대 680px)
  const maxAvailable = Math.max(320, visMaxX - candidateX - 24);
  const dynamicWidth = Math.min(preferredWidth, maxAvailable);

  // 4. 하단 화면 밖으로 넘칠 경우: 뷰포트 내부로 상향 보정
  if (candidateY + boxHeight > visMaxY - 24) {
    candidateY = Math.max(visMinY + 24, visMaxY - boxHeight - 24);
  }

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
  lastEvaporatedContext: string | null = null;
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

      if (this.callbacks.onInferRequested) {
        const req: InferRequestBody = {
          croppedImageBase64: 'data:image/png;base64,rejection-refinement',
          strokeMetadata: {
            strokeCount: 2,
            bbox,
            canvasSize: [2400, 1800],
          },
          previousEvaporatedContext: this.lastEvaporatedContext,
          rejectedHypotheses: [...this.rejectedHypotheses],
        };
        this.callbacks.onInferRequested(req).then((res) => {
          if (res && this.activeHypothesis && !this.activeHypothesis.isConfirmed) {
            const adjustedBbox = calculateVisibleHypothesisBbox(res.jevDecision.marginBox.coordinates, this.currentViewport, 520, 105);
            const dynamicWidth = adjustedBbox[2];
            const formatted = formatHandwrittenSentence(res.sentence, dynamicWidth);
            this.activeHypothesis.sentence = formatted;
            this.lastEvaporatedContext = formatted;
          }
        }).catch(() => {});
      }
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
        } else if (this.callbacks.onInferRequested) {
          // AI 문장 바깥 여백에 펜으로 글씨를 쓴 경우: 답장 vs 새 단어 판별
          const strokesForCrop = this.hypothesisGestureStrokes.map((pts, i) => ({
            id: `reply-${i}`,
            points: pts.map((p) => ({ x: p.x, y: p.y, t: 0, pressure: 0.6 })),
            startTime: 0,
            endTime: 0,
          }));
          const crop = extractCroppedStrokes(strokesForCrop);
          this.hypothesisGestureStrokes = [];
          if (crop) {
            const req: InferRequestBody = {
              croppedImageBase64: crop.base64,
              strokeMetadata: {
                strokeCount: crop.strokeCount,
                bbox: crop.bbox,
                canvasSize: [2400, 1800],
              },
              activeHypothesisSentence: this.activeHypothesis.sentence,
              previousEvaporatedContext: this.lastEvaporatedContext,
              rejectedHypotheses: [...this.rejectedHypotheses],
            };
            this.callbacks.onInferRequested(req).then((res) => {
              if (res && this.activeHypothesis && !this.activeHypothesis.isConfirmed && !this.activeHypothesis.isRejected) {
                const adjustedBbox = calculateVisibleHypothesisBbox(res.jevDecision.marginBox.coordinates, this.currentViewport, 520, 105);
                const dynamicWidth = adjustedBbox[2];
                const formatted = formatHandwrittenSentence(res.sentence, dynamicWidth);
                this.activeHypothesis.sentence = formatted;
                this.activeHypothesis.bbox = adjustedBbox;
                this.lastEvaporatedContext = formatted;
                this.callbacks.onFeedbackRefined?.(formatted);
              }
            }).catch(() => {});
          }
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

        if (this.callbacks.onInferRequested) {
          const req: InferRequestBody = {
            croppedImageBase64: cropped.base64,
            strokeMetadata: {
              strokeCount: cropped.strokeCount,
              bbox: cropped.bbox,
              canvasSize: [2400, 1800],
            },
            previousEvaporatedContext: this.lastEvaporatedContext,
            rejectedHypotheses: [...this.rejectedHypotheses],
          };
          this.callbacks.onInferRequested(req).then((res) => {
            if (res && this.activeHypothesis && !this.activeHypothesis.isConfirmed && !this.activeHypothesis.isRejected) {
              const adjustedBbox = calculateVisibleHypothesisBbox(res.jevDecision.marginBox.coordinates, this.currentViewport, 520, 105);
              const dynamicWidth = adjustedBbox[2];
              const formatted = formatHandwrittenSentence(res.sentence, dynamicWidth);
              this.activeHypothesis.sentence = formatted;
              this.activeHypothesis.bbox = adjustedBbox;
              this.lastEvaporatedContext = formatted;
            }
          }).catch(() => {});
        }
      }
      this.strokes = [];
      this.lastPointerUpTime = null;
    }

    return decay;
  }

  setViewport(viewport: ViewportBounds): void {
    this.currentViewport = viewport;
  }

  spawnHypothesis(bbox: [number, number, number, number], now: number, customSentence?: string): void {
    const rawSentence = customSentence ?? this.mockSentences[this.mockSentenceIndex % this.mockSentences.length];
    const tiltDeg = generateRandomTilt();

    // 1. 뷰포트 가시 영역 보정: 사용자가 보고 있는 화면 밖으로 잘림 방지 (기본 선호 너비 520px)
    const adjustedBbox = calculateVisibleHypothesisBbox(bbox, this.currentViewport, 520, 105);
    const dynamicWidth = adjustedBbox[2];

    // 2. 산출된 동적 가용 너비에 맞춰 어절 단위 최적 개행 포맷팅 (단어 중간 분절 원천 차단)
    const formattedSentence = formatHandwrittenSentence(rawSentence, dynamicWidth);

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
    this.lastEvaporatedContext = formattedSentence;
    this.callbacks.onHypothesisSpawned?.(hypothesis);
  }
}
