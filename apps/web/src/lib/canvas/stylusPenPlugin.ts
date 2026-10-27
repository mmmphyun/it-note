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
 * 필기 획을 실시간으로 추적하는 정밀 연필(Pencil) 오버레이 플러그인
 * 1. 획과 획 사이(글자 간격, 띄어쓰기)에서 깜빡이며 사라지지 않고 부드럽게 위치를 유지합니다.
 * 2. 한글 좌->우 필기 방향에 맞춰 연필 바디가 우측 상단으로 자연스럽게 뻗도록 렌더링합니다.
 */
export function createStylusPenPlugin(enabled = true): TegakiPlugin {
  let currentX = 0;
  let currentY = 0;
  let isInitialized = false;
  let opacity = 1.0;
  let isDrawing = false;

  return {
    name: 'stylus-pen-cursor',
    overlay(paintCtx: { ctx: CanvasRenderingContext2D; frame: { active?: Array<{ head?: { x: number; y: number } }> } }) {
      if (!enabled) return;
      const { ctx, frame } = paintCtx;
      if (!frame) return;

      const hasActiveHead = frame.active && frame.active.length > 0 && frame.active[0].head;

      if (hasActiveHead) {
        currentX = frame.active![0].head!.x;
        currentY = frame.active![0].head!.y;
        isInitialized = true;
        isDrawing = true;
        opacity = 1.0;
      } else if (isDrawing) {
        // 획간 공백 시 즉시 깜빡여 사라지지 않고, 전체 대필 종료 시 부드럽게 페이드아웃
        opacity = Math.max(0, opacity - 0.035);
      }

      if (!isInitialized || opacity <= 0.01) return;

      ctx.save();
      ctx.translate(currentX, currentY);

      // 한글 좌->우 필기 특성에 맞춰 연필 바디가 우측 상단으로 뻗도록 +39.6도(+0.22π) 회전
      ctx.rotate(Math.PI * 0.22);
      ctx.globalAlpha = opacity;

      // 1. 미세 흑연 접점 그림자
      ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
      ctx.beginPath();
      ctx.ellipse(-1, 1, 3, 1.5, 0, 0, Math.PI * 2);
      ctx.fill();

      // 2. 흑연 연필심 (Graphite Tip)
      ctx.fillStyle = '#222222';
      ctx.beginPath();
      ctx.moveTo(0, 0); // 종이에 닿는 연필심 끝점 (정확한 획 좌표)
      ctx.lineTo(2, -5);
      ctx.lineTo(-2, -5);
      ctx.closePath();
      ctx.fill();

      // 3. 깎인 나무 칼라 (Sharpened Wood)
      ctx.fillStyle = '#e8c99b';
      ctx.beginPath();
      ctx.moveTo(2, -5);
      ctx.lineTo(4, -13);
      ctx.lineTo(-4, -13);
      ctx.lineTo(-2, -5);
      ctx.closePath();
      ctx.fill();

      // 4. 연필 바디 (클래식 따뜻한 옐로우/오렌지 입체 그라데이션)
      const bodyGrad = ctx.createLinearGradient(-4, 0, 4, 0);
      bodyGrad.addColorStop(0, '#d18b2c');
      bodyGrad.addColorStop(0.5, '#f5b041');
      bodyGrad.addColorStop(1, '#b97722');
      ctx.fillStyle = bodyGrad;
      ctx.fillRect(-4, -42, 8, 29);

      // 5. 금속 페룰 링 (Metal Ferrule)
      ctx.fillStyle = '#a0a0a0';
      ctx.fillRect(-4.5, -46, 9, 4);

      // 6. 핑크 지우개 팁 (Eraser Dome)
      ctx.fillStyle = '#e57373';
      ctx.beginPath();
      ctx.arc(0, -47, 4, Math.PI, 0, false);
      ctx.fill();

      ctx.restore();
    },
  };
}
