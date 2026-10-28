<script lang="ts">
  import { onMount } from 'svelte';
  import { getStroke } from 'perfect-freehand';
  import type { StrokePoint, ConfirmedNote } from '@itnote/shared';
  import { CanvasLifecycleEngine } from './canvasLifecycle';
  import type { CroppedImageResult } from './cropExtractor';
  import AiHandwriting from './AiHandwriting.svelte';
  import { requestInference } from '../api/inferClient';

  interface Props {
    onOpenDesk?: () => void;
    onConfirmedNote?: (note: ConfirmedNote) => void;
    onCropExtracted?: (crop: CroppedImageResult) => void;
  }

  let { onOpenDesk, onConfirmedNote, onCropExtracted }: Props = $props();

  const CANVAS_WIDTH = 2400;
  const CANVAS_HEIGHT = 1800;

  let canvasEl = $state<HTMLCanvasElement | null>(null);
  let ctx = $state<CanvasRenderingContext2D | null>(null);
  let containerEl = $state<HTMLDivElement | null>(null);

  // 스크롤 및 패닝 오프셋
  let scrollX = $state(0);
  let scrollY = $state(0);

  // 라이프사이클 엔진
  let engine: CanvasLifecycleEngine;
  let activeHypothesis = $state<CanvasLifecycleEngine['activeHypothesis']>(null);

  // 워터마크 펜촉 더블탭+홀드 감지 상태
  let lastWatermarkTapTime = 0;
  let watermarkHoldTimer: ReturnType<typeof setTimeout> | null = null;

  // 두 손가락 터치 패닝 상태
  const activePointers = new Map<number, { x: number; y: number }>();
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;

  // 마우스 휠클릭 / 우클릭 패닝 상태
  let isMousePanning = false;
  let mousePanStartX = 0;
  let mousePanStartY = 0;

  // 애니메이션 프레임 루프 및 더티 렌더링 추적
  let animationFrameId: number;
  let lastRenderedOpacity = -1;
  let lastRenderedStrokeCount = -1;
  let lastHasCurrentStroke = false;
  let lastRenderedGestureCount = 0;

  function renderStrokes(currentOpacity = 1.0) {
    if (!ctx || !canvasEl || !engine) return;

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.fillStyle = '#FAF8F5';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // 격자 미세 질감 (종이 질감)
    ctx.save();
    ctx.strokeStyle = 'rgba(210, 205, 195, 0.2)';
    ctx.lineWidth = 0.5;
    const gridSize = 40;
    for (let x = 0; x < CANVAS_WIDTH; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_HEIGHT);
      ctx.stroke();
    }
    for (let y = 0; y < CANVAS_HEIGHT; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(CANVAS_WIDTH, y);
      ctx.stroke();
    }
    ctx.restore();

    // 잉크 렌더링 (투명도 적용)
    ctx.save();
    ctx.globalAlpha = currentOpacity;
    ctx.fillStyle = '#1e1e1e';

    // 일반 필기 획 + AI 문장 O/X 마킹 중인 제스처 획 + 현재 드로잉 중인 획
    const gestureStrokes = engine.hypothesisGestureStrokes.map((pts, i) => ({
      id: `gesture-${i}`,
      points: pts.map((p) => ({ x: p.x, y: p.y, t: 0, pressure: 0.6 })),
      startTime: 0,
      endTime: 0,
    }));

    const allStrokes = [
      ...engine.strokes,
      ...gestureStrokes,
      ...(engine.currentStroke ? [engine.currentStroke] : []),
    ];

    for (const stroke of allStrokes) {
      const points = stroke.points.map((p) => [p.x, p.y, p.pressure ?? 0.5]);
      const outline = getStroke(points, {
        size: 3.5,
        thinning: 0.6,
        smoothing: 0.6,
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
    ctx.restore();
  }

  function tick() {
    if (engine) {
      const decay = engine.tick(performance.now());
      const hasCurrent = engine.currentStroke !== null;
      const strokeCount = engine.strokes.length;
      const gestureCount = engine.hypothesisGestureStrokes.length;

      // 선을 긋고 있는 도중(hasCurrent)이거나 상태 변화 시 매 프레임 실시간 리드로잉
      if (
        hasCurrent ||
        lastHasCurrentStroke ||
        decay.opacity !== lastRenderedOpacity ||
        strokeCount !== lastRenderedStrokeCount ||
        gestureCount !== lastRenderedGestureCount
      ) {
        renderStrokes(decay.opacity);
        lastRenderedOpacity = decay.opacity;
        lastRenderedStrokeCount = strokeCount;
        lastHasCurrentStroke = hasCurrent;
        lastRenderedGestureCount = gestureCount;
      }
    }
    animationFrameId = requestAnimationFrame(tick);
  }

  function handleWatermarkPointerDown(e: PointerEvent) {
    // 펜촉 전용 하드가드: touch 및 mouse는 워터마크 트리거 100% 무시
    if (e.pointerType !== 'pen') return;

    const now = performance.now();
    const isDoubleTap = now - lastWatermarkTapTime < 400;
    lastWatermarkTapTime = now;

    if (isDoubleTap) {
      watermarkHoldTimer = setTimeout(() => {
        onOpenDesk?.();
      }, 800);
    }
  }

  function handleWatermarkPointerUp() {
    if (watermarkHoldTimer) {
      clearTimeout(watermarkHoldTimer);
      watermarkHoldTimer = null;
    }
  }

  function handlePointerDown(e: PointerEvent) {
    // 휠클릭 (button === 1) 또는 우클릭 (button === 2) 시 마우스 패닝 시작
    if (e.pointerType === 'mouse' && (e.button === 1 || e.button === 2)) {
      isMousePanning = true;
      mousePanStartX = e.clientX - scrollX;
      mousePanStartY = e.clientY - scrollY;
      return;
    }

    if (e.pointerType === 'touch') {
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.size >= 2) {
        isPanning = true;
        const [p1, p2] = Array.from(activePointers.values());
        panStartX = (p1.x + p2.x) / 2 - scrollX;
        panStartY = (p1.y + p2.y) / 2 - scrollY;
        return;
      }
    }

    if (e.button !== 0 && e.pointerType === 'mouse') return;

    const rect = canvasEl?.getBoundingClientRect();
    if (!rect) return;
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    const point: StrokePoint = {
      x: canvasX,
      y: canvasY,
      t: performance.now(),
      pressure: e.pressure > 0 ? e.pressure : 0.5,
      tiltX: e.tiltX,
      tiltY: e.tiltY,
    };

    try {
      (e.target as HTMLElement)?.setPointerCapture?.(e.pointerId);
    } catch {}

    engine.pointerDown(point);
  }

  function handlePointerMove(e: PointerEvent) {
    if (isMousePanning) {
      scrollX = e.clientX - mousePanStartX;
      scrollY = e.clientY - mousePanStartY;
      clampScroll();
      return;
    }

    if (e.pointerType === 'touch' && isPanning) {
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.size >= 2) {
        const [p1, p2] = Array.from(activePointers.values());
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        scrollX = midX - panStartX;
        scrollY = midY - panStartY;
        clampScroll();
      }
      return;
    }

    const rect = canvasEl?.getBoundingClientRect();
    if (!rect) return;
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    engine.pointerMove({
      x: canvasX,
      y: canvasY,
      t: performance.now(),
      pressure: e.pressure > 0 ? e.pressure : 0.5,
      tiltX: e.tiltX,
      tiltY: e.tiltY,
    });
  }

  function handlePointerUp(e: PointerEvent) {
    if (isMousePanning) {
      isMousePanning = false;
      return;
    }

    if (e.pointerType === 'touch') {
      activePointers.delete(e.pointerId);
      if (activePointers.size < 2) {
        isPanning = false;
      }
    }

    try {
      (e.target as HTMLElement)?.releasePointerCapture?.(e.pointerId);
    } catch {}

    engine.pointerUp(performance.now());
  }

  function updateViewport() {
    if (!containerEl || !engine) return;
    engine.setViewport({
      scrollX,
      scrollY,
      width: containerEl.clientWidth || window.innerWidth,
      height: containerEl.clientHeight || window.innerHeight,
    });
  }

  function clampScroll() {
    if (!containerEl) return;
    const minX = -(CANVAS_WIDTH - containerEl.clientWidth);
    const minY = -(CANVAS_HEIGHT - containerEl.clientHeight);
    scrollX = Math.min(0, Math.max(minX, scrollX));
    scrollY = Math.min(0, Math.max(minY, scrollY));
    updateViewport();
  }

  function handleWheel(e: WheelEvent) {
    // 마우스 휠 및 트랙패드로 캔버스 자유 패닝 (2400x1800 무한 종이 탐색)
    if (e.ctrlKey) return;
    scrollX -= e.deltaX;
    scrollY -= e.deltaY;
    clampScroll();
  }

  onMount(() => {
    const fastParam = new URLSearchParams(window.location.search).get('fast');
    let speedMode: 'normal' | 'fast' | 'instant' = 'normal';
    if (fastParam === '0') speedMode = 'instant';
    else if (fastParam === '1') speedMode = 'fast';

    engine = new CanvasLifecycleEngine(
      {
        onCropExtracted: (crop) => {
          onCropExtracted?.(crop);
        },
        onHypothesisSpawned: (hypo) => {
          activeHypothesis = hypo;
        },
        onHypothesisConfirmed: (note) => {
          onConfirmedNote?.(note);
          setTimeout(() => {
            activeHypothesis = null;
          }, 800);
        },
        onHypothesisRejected: (hypo) => {
          activeHypothesis = hypo;
        },
        onInferRequested: requestInference,
        onFeedbackRefined: (newSentence) => {
          if (activeHypothesis) {
            activeHypothesis.sentence = newSentence;
          }
        },
      },
      speedMode
    );

    if (canvasEl) {
      ctx = canvasEl.getContext('2d');
      renderStrokes(1.0);
    }

    updateViewport();
    window.addEventListener('resize', clampScroll);

    // 0초 모드(?fast=0): 사용자가 필기하지 않고 대기할 경우 1.2초 후 AI가 초기 메모 시연
    if (speedMode === 'instant') {
      setTimeout(() => {
        if (engine && engine.strokes.length === 0 && !activeHypothesis) {
          engine.spawnHypothesis([180, 140, 420, 200], performance.now());
          activeHypothesis = engine.activeHypothesis;
        }
      }, 1200);
    }

    animationFrameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', clampScroll);
      if (watermarkHoldTimer) clearTimeout(watermarkHoldTimer);
    };
  });
</script>

<!-- Zero-UI 준수: 캔버스 내부에는 헤더, 푸터, 버튼, 인풋 태그를 일절 사용하지 않음 -->
<div
  bind:this={containerEl}
  class="paper-viewport"
  role="region"
  aria-label="메모 캔버스 작업 영역"
  onpointerdown={handlePointerDown}
  onpointermove={handlePointerMove}
  onpointerup={handlePointerUp}
  onpointercancel={handlePointerUp}
  onwheel={handleWheel}
  oncontextmenu={(e) => e.preventDefault()}
>
  <div
    class="canvas-scroll-container"
    style="transform: translate3d({scrollX}px, {scrollY}px, 0);"
  >
    <canvas
      bind:this={canvasEl}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      class="paper-canvas"
    ></canvas>

    {#if activeHypothesis}
      <AiHandwriting
        sentence={activeHypothesis.sentence}
        bbox={activeHypothesis.bbox}
        tiltDeg={activeHypothesis.tiltDeg ?? 0}
        isConfirmed={activeHypothesis.isConfirmed}
        isRejected={activeHypothesis.isRejected}
      />
    {/if}
  </div>

  <!-- 우측 하단 잇적 워터마크 (opacity: 0.15, 펜촉 더블탭+홀드로 데스크 보관함 진입) -->
  <div
    class="watermark-trigger"
    role="region"
    aria-label="잇적 데스크 전환 워터마크"
    onpointerdown={handleWatermarkPointerDown}
    onpointerup={handleWatermarkPointerUp}
    onpointerleave={handleWatermarkPointerUp}
  >
    <span class="watermark-text">잇적</span>
  </div>
</div>

<style>
  .paper-viewport {
    position: relative;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background-color: #FAF8F5;
    cursor: crosshair;
    touch-action: none;
  }

  .canvas-scroll-container {
    position: absolute;
    top: 0;
    left: 0;
    width: 2400px;
    height: 1800px;
    will-change: transform;
  }

  .paper-canvas {
    display: block;
    width: 2400px;
    height: 1800px;
  }

  .watermark-trigger {
    position: fixed;
    right: 20px;
    bottom: 20px;
    width: 120px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding-right: 12px;
    opacity: 0.15;
    transition: opacity 0.3s ease;
    cursor: default;
    user-select: none;
    z-index: 100;
  }

  .watermark-trigger:hover {
    opacity: 0.35;
  }

  .watermark-text {
    font-family: 'Nanum Pen Script', cursive, serif;
    font-size: 28px;
    letter-spacing: 2px;
    color: #4a453e;
  }
</style>
