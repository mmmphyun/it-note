import type { TegakiPlugin, TegakiTimingContext, TegakiFrame } from 'tegaki/core';

/**
 * 속도 레벨 (1 ~ 10)에 따른 획순 타이밍 설정값 계산
 * Level 1 (22.4초, 극저속) ~ Level 4 (5.1초, 자연스러운 손글씨) ~ Level 10 (0.3초, 초고속)
 */
export function getTegakiTiming(level: number) {
  const factors: Record<number, number> = {
    1: 4.0,   // 약 22.4초
    2: 2.8,   // 약 11.4초
    3: 2.2,   // 약 7.3초
    4: 1.8,   // 약 5.1초 (기본 권장)
    5: 1.4,   // 약 3.3초
    6: 1.1,   // 약 2.2초
    7: 0.85,  // 약 1.4초
    8: 0.65,  // 약 0.9초
    9: 0.45,  // 약 0.5초
    10: 0.3,  // 약 0.3초
  };

  const factor = factors[Math.min(10, Math.max(1, Math.round(level)))] ?? 1.8;
  const advancePct = Math.round(35 * factor);

  return {
    factor,
    glyphGap: 0.03 * factor,
    wordGap: 0.06 * factor,
    lineGap: 0.09 * factor,
    unknownDuration: 0.05 * factor,
    stagger: {
      advance: `${advancePct}%` as `${number}%`,
      duration: 0.08 * factor,
    },
  };
}

/**
 * 두 점 사이의 이동 거리에 따른 공중 이동 시간(초) 산출
 * 사람이 손을 떼고 다음 획 시작점으로 이동할 때의 최소/최대 시간 제약
 */
export function calculateGlideDuration(distancePx: number, factor: number): number {
  const minTime = 0.03 * factor;
  const maxTime = 0.25 * factor;
  // 기준 속도: 초당 약 350px 이동 + 초기 손들기 0.02초
  const rawTime = (distancePx / 350) * factor + 0.02 * factor;
  return Math.max(minTime, Math.min(maxTime, rawTime));
}

/**
 * 직전 획 끝점(p0)에서 다음 획 시작점(p1)까지의 공중 이동(Air-Glide) 좌표 보간
 * Smoothstep(S-Curve)과 포물선 리프트(공중 부양 호)를 적용해 사람이 펜을 떼어 이동하는 물리 동작을 재현합니다.
 *
 * @param p0 직전 획 끝점
 * @param p1 다음 획 시작점
 * @param u 진행률 (0.0 ~ 1.0)
 */
export function interpolateAirGlide(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  u: number
): { x: number; y: number } {
  const clampedU = Math.max(0, Math.min(1, u));

  // 1. Smoothstep 이징을 통한 부드러운 가속 및 감속
  const s = clampedU * clampedU * (3 - 2 * clampedU);
  const x = p0.x + (p1.x - p0.x) * s;
  let y = p0.y + (p1.y - p0.y) * s;

  // 2. 종이에서 손을 뗄 때 발생하는 상향 리프트(Air-lift arc)
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const maxLift = Math.min(6, Math.max(1.5, dist * 0.08));
  const lift = Math.sin(clampedU * Math.PI) * maxLift;

  y -= lift;

  return { x, y };
}

export interface AirGlideOptions {
  speedLevel?: number;
  onPosition: (pos: { x: number; y: number; isAirborne: boolean }) => void;
  onComplete?: () => void;
}

interface StrokeSchedule {
  start: number;
  duration: number;
  end: number;
  startPoint: { x: number; y: number };
  endPoint: { x: number; y: number };
}

/**
 * 획과 획 사이의 순간이동을 제거하고 공중 곡선 이동(Air Glide)을 구현하는 통합 플러그인
 * 1. timing 훅: 획 간 물리적 이동 거리를 계산하여 타임라인에 실제 공중 이동 시간 슬롯을 확보합니다.
 * 2. onFrame 훅: 종이에 쓰는 중일 때는 실제 획 헤드를 1:1 추적하고, 획 간 공백에서는 곡선 보간을 수행합니다.
 */
export function createAirGlidePlugin(options: AirGlideOptions): TegakiPlugin {
  const { speedLevel = 4, onPosition } = options;
  const timingConfig = getTegakiTiming(speedLevel);
  const factor = timingConfig.factor;

  let schedules: StrokeSchedule[] = [];

  return {
    name: 'stylus-air-glide',

    timing(ctx: TegakiTimingContext) {
      const strokes = ctx.strokes;
      if (!strokes || strokes.length === 0) return undefined;

      schedules = [];
      let currentCursor = 0;
      const timedStrokes: Array<{ start: number; duration: number }> = [];

      for (let i = 0; i < strokes.length; i++) {
        const stroke = strokes[i];
        const origDuration = stroke.duration;
        const startPt = stroke.path.pointAt(0);
        const endPt = stroke.path.pointAt(1);

        if (i > 0) {
          const prevEnd = schedules[i - 1].endPoint;
          const dx = startPt.x - prevEnd.x;
          const dy = startPt.y - prevEnd.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          const glideTime = calculateGlideDuration(dist, factor);
          currentCursor += glideTime;
        }

        const start = currentCursor;
        const end = start + origDuration;

        schedules.push({
          start,
          duration: origDuration,
          end,
          startPoint: { x: startPt.x, y: startPt.y },
          endPoint: { x: endPt.x, y: endPt.y },
        });

        timedStrokes.push({ start, duration: origDuration });
        currentCursor = end;
      }

      return {
        strokes: timedStrokes,
        duration: currentCursor + 0.05 * factor,
      };
    },

    onFrame(frame: TegakiFrame) {
      if (!frame) return;

      const hasActive = frame.active && frame.active.length > 0 && frame.active[0].head;

      // 1. 현재 어떤 획을 종이에 대고 쓰는 중인 경우
      if (hasActive) {
        const head = frame.active[0].head;
        onPosition({
          x: head.x,
          y: head.y,
          isAirborne: false,
        });
        return;
      }

      // 2. 획과 획 사이 공중 이동 구간(Airborne Glide)인 경우
      if (schedules.length === 0) return;

      const t = frame.time;

      // 현재 시간이 어떤 두 획 사이에 있는지 탐색
      for (let i = 0; i < schedules.length - 1; i++) {
        const curr = schedules[i];
        const next = schedules[i + 1];

        if (t >= curr.end && t <= next.start) {
          const gap = next.start - curr.end;
          const u = gap > 0 ? (t - curr.end) / gap : 1;
          const pos = interpolateAirGlide(curr.endPoint, next.startPoint, u);

          onPosition({
            x: pos.x,
            y: pos.y,
            isAirborne: true,
          });
          return;
        }
      }

      // 첫 획 시작 전: 첫 획의 시작점에 대기
      if (t < schedules[0].start) {
        onPosition({
          x: schedules[0].startPoint.x,
          y: schedules[0].startPoint.y,
          isAirborne: true,
        });
        return;
      }

      // 마지막 획 종료 후
      if (t >= schedules[schedules.length - 1].end) {
        const last = schedules[schedules.length - 1];
        onPosition({
          x: last.endPoint.x,
          y: last.endPoint.y,
          isAirborne: false,
        });
      }
    },
  };
}
