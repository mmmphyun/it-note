import type { Stroke, StrokePoint, AiHypothesis, ConfirmedNote } from '@itnote/shared';
import { calculateDecayState, type DecayState } from './decayTimer';
import { extractCroppedStrokes, type CroppedImageResult } from './cropExtractor';
import { recognizeOxGesture, type Point } from './gestureRecognizer';

export interface CanvasLifecycleCallbacks {
  onCropExtracted?: (crop: CroppedImageResult) => void;
  onHypothesisSpawned?: (hypo: AiHypothesis) => void;
  onHypothesisConfirmed?: (note: ConfirmedNote) => void;
  onHypothesisRejected?: (hypo: AiHypothesis) => void;
}

export class CanvasLifecycleEngine {
  strokes: Stroke[] = [];
  currentStroke: Stroke | null = null;
  lastPointerUpTime: number | null = null;
  activeHypothesis: AiHypothesis | null = null;
  confirmedNotes: ConfirmedNote[] = [];
  rejectedHypotheses: string[] = [];
  isFastMode = false;
  callbacks: CanvasLifecycleCallbacks;

  private mockSentenceIndex = 0;
  private mockSentences = [
    '가상 DOM 오버헤드가 큰 React 대신 Svelte 5와 Hono로 모노레포를 구성하는 계획 맞나요?',
    '사이드 프로젝트 아키텍처를 순수 TypeScript와 Zero-UI 스타일러스 방식으로 전환하려는 의도인가요?',
    '취소선으로 기각된 가설을 배제하고 클라우드 보안 자동화 루틴을 설계하려는 맥락인가요?',
  ];

  constructor(callbacks: CanvasLifecycleCallbacks = {}, isFastMode = false) {
    this.callbacks = callbacks;
    this.isFastMode = isFastMode;
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
      const gesture = recognizeOxGesture([points], this.activeHypothesis.bbox);

      if (gesture === 'O') {
        this.activeHypothesis.isConfirmed = true;
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
        this.rejectedHypotheses.push(this.activeHypothesis.sentence);
        this.callbacks.onHypothesisRejected?.(this.activeHypothesis);

        // 다음 대안 문장 생성
        const prevBbox = this.activeHypothesis.bbox;
        this.mockSentenceIndex++;
        this.spawnHypothesis(prevBbox, now);
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
    const decay = calculateDecayState(elapsed, this.isFastMode);

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

  spawnHypothesis(bbox: [number, number, number, number], now: number): void {
    const sentence = this.mockSentences[this.mockSentenceIndex % this.mockSentences.length];
    const hypothesis: AiHypothesis = {
      id: `hypo-${now}`,
      sentence,
      bbox: [Math.min(1900, bbox[2] + 40), bbox[1], 480, 80],
      createdAt: now,
      isConfirmed: false,
      isRejected: false,
    };
    this.activeHypothesis = hypothesis;
    this.callbacks.onHypothesisSpawned?.(hypothesis);
  }
}
