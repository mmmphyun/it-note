import type { TegakiPlugin } from 'tegaki/core';

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
    glyphGap: 0.02 * factor,
    wordGap: 0.04 * factor,
    lineGap: 0.06 * factor,
    unknownDuration: 0.05 * factor,
    stagger: {
      advance: `${advancePct}%` as `${number}%`,
      duration: 0.08 * factor,
    },
  };
}

/**
 * 필기 획을 실시간으로 추적하는 정밀 스타일러스 펜촉 오버레이 플러그인
 * frame.active[].head 좌표를 기반으로 픽셀 단위로 정확하게 펜촉을 렌더링합니다.
 */
export function createStylusPenPlugin(enabled = true): TegakiPlugin {
  return {
    name: 'stylus-pen-cursor',
    overlay(paintCtx: { ctx: CanvasRenderingContext2D; frame: { active?: Array<{ head?: { x: number; y: number } }> } }) {
      if (!enabled) return;
      const { ctx, frame } = paintCtx;
      if (!frame || !frame.active || frame.active.length === 0) return;

      for (const active of frame.active) {
        if (!active.head) continue;
        const { x, y } = active.head;

        ctx.save();
        ctx.translate(x, y);
        // 오른손 필기 각도 (-50도 회전)
        ctx.rotate(-Math.PI * 0.28);

        // 1. 미세 잉크 접점 그림자
        ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
        ctx.beginPath();
        ctx.ellipse(1, 1, 3, 1.5, 0, 0, Math.PI * 2);
        ctx.fill();

        // 2. 만년필/스타일러스 금속 펜촉
        const nibGrad = ctx.createLinearGradient(-4, -12, 4, 0);
        nibGrad.addColorStop(0, '#5a5a5a');
        nibGrad.addColorStop(0.5, '#2b2b2b');
        nibGrad.addColorStop(1, '#111111');
        ctx.fillStyle = nibGrad;

        ctx.beginPath();
        ctx.moveTo(0, 0); // 펜촉 끝점 (획의 현재 좌표)
        ctx.lineTo(4, -12);
        ctx.lineTo(-4, -12);
        ctx.closePath();
        ctx.fill();

        // 3. 골드 메탈 링
        ctx.fillStyle = '#c5a059';
        ctx.fillRect(-3.5, -14, 7, 2);

        // 4. 슬림 펜 바디
        const bodyGrad = ctx.createLinearGradient(-3, -32, 3, -14);
        bodyGrad.addColorStop(0, '#36393e');
        bodyGrad.addColorStop(1, '#1a1c1e');
        ctx.fillStyle = bodyGrad;
        ctx.fillRect(-3, -34, 6, 20);

        ctx.restore();
      }
    },
  };
}
