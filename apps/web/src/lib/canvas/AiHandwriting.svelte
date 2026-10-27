<script lang="ts">
  import { TegakiEngine } from 'tegaki/core';
  import nanumFont from 'tegaki/fonts/nanum-pen-script';
  import { getTegakiTiming, createAirGlidePlugin } from './stylusPenPlugin';

  interface Props {
    sentence: string;
    bbox: [number, number, number, number]; // [x, y, width, height]
    tiltDeg?: number;
    isConfirmed?: boolean;
    isRejected?: boolean;
    onComplete?: () => void;
  }

  let {
    sentence,
    bbox,
    tiltDeg = 0,
    isConfirmed = false,
    isRejected = false,
    onComplete
  }: Props = $props();

  let containerEl = $state<HTMLDivElement | null>(null);
  let penEl = $state<HTMLDivElement | null>(null);
  let engine: TegakiEngine | null = null;
  let lastSentenceRendered = '';

  $effect(() => {
    if (!containerEl) return;
    if (lastSentenceRendered === sentence && engine) return;

    lastSentenceRendered = sentence;
    engine?.destroy();
    containerEl.innerHTML = '';

    if (penEl) {
      penEl.style.display = 'none';
      penEl.classList.remove('airborne');
    }

    // 로컬스토리지 설정 (기본 속도 레벨 4, 펜촉 표시 활성)
    const savedLevel = typeof localStorage !== 'undefined' ? Number(localStorage.getItem('itnote_writing_speed') || 4) : 4;
    const showPenTip = typeof localStorage !== 'undefined' ? localStorage.getItem('itnote_pen_tip') !== 'false' : true;

    const timing = getTegakiTiming(savedLevel);

    // 공중 곡선 보간(Air-Glide) 플러그인 (Svelte 5 반응형 오버헤드 차단: Direct DOM Mutation)
    const airGlidePlugin = createAirGlidePlugin({
      speedLevel: savedLevel,
      onPosition: (pos) => {
        if (!showPenTip || !penEl) return;
        penEl.style.display = 'block';
        penEl.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
        if (pos.isAirborne) {
          penEl.classList.add('airborne');
        } else {
          penEl.classList.remove('airborne');
        }
      },
    });

    try {
      engine = new TegakiEngine(containerEl, {
        text: sentence,
        font: nanumFont,
        timing,
        plugins: [airGlidePlugin],
        onComplete: () => {
          // 대필 완료 즉시 펜 흔적 없이 완전 소멸
          if (penEl) penEl.style.display = 'none';
          onComplete?.();
        },
      });
    } catch {
      if (containerEl) containerEl.textContent = sentence;
      if (penEl) penEl.style.display = 'none';
      onComplete?.();
    }

    return () => {
      engine?.destroy();
      engine = null;
      if (penEl) penEl.style.display = 'none';
    };
  });
</script>

<!-- UI 박스·점선 완전 제거: 종이 위에 순수 잉크만 렌더링 + 자연스러운 손글씨 미세 회전 기울기 -->
<div
  class="ai-sentence-box"
  class:sink-in={isConfirmed}
  class:smoke-out={isRejected}
  style="
    left: {bbox[0]}px;
    top: {bbox[1]}px;
    width: {bbox[2]}px;
    min-height: {bbox[3]}px;
    --tilt: {tiltDeg}deg;
  "
>
  <div bind:this={containerEl} class="tegaki-container"></div>

  <!-- 캔버스 경계에 잘리지 않는 상단 독립 스타일러스 볼펜 오버레이 (다이렉트 GPU 조작) -->
  <div
    bind:this={penEl}
    class="stylus-pen-cursor"
    style="display: none;"
  >
    <svg class="pen-svg" width="38" height="38" viewBox="0 0 38 38" fill="none">
      <!-- 펜촉 접점: (3, 35) -> 바디 연장: (34, 4) 우측 상단 지향 -->
      <path d="M3 35 L6 27 L11 32 Z" fill="#1e1e1e" />
      <path d="M6 27 L11 32 L31 12 L26 7 Z" fill="url(#ballpen-metal-body)" />
      <path d="M26 7 L31 12 L35 8 L30 4 Z" fill="#9e9e9e" />
      <defs>
        <linearGradient id="ballpen-metal-body" x1="6" y1="27" x2="31" y2="12" gradientUnits="userSpaceOnUse">
          <stop stop-color="#2c3038" />
          <stop offset="0.5" stop-color="#474e5c" />
          <stop offset="1" stop-color="#1e2126" />
        </linearGradient>
      </defs>
    </svg>
  </div>
</div>

<style>
  /* 점선·테두리·배경을 일절 배제한 순수 필기 영역 (마우스 이벤트 관통 보장) */
  .ai-sentence-box,
  .ai-sentence-box * {
    pointer-events: none !important;
    user-select: none !important;
  }

  .ai-sentence-box {
    position: absolute;
    padding: 0;
    margin: 0;
    background: transparent;
    border: none;
    box-shadow: none;
    transform: rotate(var(--tilt, 0deg));
    transform-origin: top left;
    transition: transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1),
                opacity 0.6s cubic-bezier(0.2, 0.8, 0.2, 1),
                filter 0.6s ease;
    z-index: 10;
    overflow: visible;
  }

  .tegaki-container {
    font-family: 'Nanum Pen Script', cursive, sans-serif;
    font-size: 32px;
    line-height: 1.55;
    color: #1e1e1e;
    word-break: keep-all;
    white-space: pre-line; /* 어절 단위 줄바꿈(\n) 완벽 반영 */
    overflow: visible;
  }

  .stylus-pen-cursor {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    z-index: 50;
    margin-left: -3px; /* 펜촉 접점 (3, 35) 정밀 보정 */
    margin-top: -35px;
    will-change: transform;
    opacity: 0.88; /* 고속 이동 시 시각적 산만함을 차단하는 은은한 반투명화 */
    filter: drop-shadow(1px 2px 2px rgba(0, 0, 0, 0.12)) blur(0.2px);
    transition: filter 0.1s ease, opacity 0.15s ease;
  }

  /* 공중 이동(Air Glide) 중 펜이 종이에서 살짝 들렸을 때의 소프트 입체 블러 */
  :global(.stylus-pen-cursor.airborne) {
    opacity: 0.78;
    filter: drop-shadow(2px 5px 4px rgba(0, 0, 0, 0.16)) blur(0.4px);
  }

  .pen-svg {
    display: block;
    overflow: visible;
  }

  /* O 마킹 시 종이 아래로 스며드는 Sink-in 애니메이션 */
  .ai-sentence-box.sink-in {
    opacity: 0;
    transform: rotate(var(--tilt, 0deg)) scale(0.92) translateY(8px);
    filter: blur(2px);
  }

  /* X 마킹 시 연기처럼 사라지는 Smoke-out 애니메이션 */
  .ai-sentence-box.smoke-out {
    opacity: 0;
    transform: rotate(var(--tilt, 0deg)) translateY(-16px) scale(1.05);
    filter: blur(5px);
  }
</style>
