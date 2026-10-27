<script lang="ts">
  import { TegakiEngine } from 'tegaki/core';
  import nanumFont from 'tegaki/fonts/nanum-pen-script';
  import { getTegakiTiming, createAirGlidePlugin } from './stylusPenPlugin';

  interface Props {
    sentence: string;
    bbox: [number, number, number, number]; // [x, y, width, height]
    isConfirmed?: boolean;
    isRejected?: boolean;
    onComplete?: () => void;
  }

  let {
    sentence,
    bbox,
    isConfirmed = false,
    isRejected = false,
    onComplete
  }: Props = $props();

  let containerEl = $state<HTMLDivElement | null>(null);
  let engine = $state<TegakiEngine | null>(null);

  // 실시간 펜촉 DOM 오버레이 좌표 (공중 곡선 보간 지원)
  let penX = $state(0);
  let penY = $state(0);
  let isPenActive = $state(false);
  let isAirborne = $state(false);

  $effect(() => {
    if (!containerEl) return;

    engine?.destroy();
    containerEl.innerHTML = '';
    isPenActive = false;
    isAirborne = false;

    // 로컬스토리지 설정 (기본 속도 레벨 4, 펜촉 표시 활성)
    const savedLevel = typeof localStorage !== 'undefined' ? Number(localStorage.getItem('itnote_writing_speed') || 4) : 4;
    const showPenTip = typeof localStorage !== 'undefined' ? localStorage.getItem('itnote_pen_tip') !== 'false' : true;

    const timing = getTegakiTiming(savedLevel);

    // 공중 곡선 보간(Air-Glide) 플러그인
    const airGlidePlugin = createAirGlidePlugin({
      speedLevel: savedLevel,
      onPosition: (pos) => {
        if (!showPenTip) return;
        penX = pos.x;
        penY = pos.y;
        isAirborne = pos.isAirborne;
        isPenActive = true;
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
          isPenActive = false;
          isAirborne = false;
          onComplete?.();
        },
      });
    } catch {
      if (containerEl) containerEl.textContent = sentence;
      isPenActive = false;
      isAirborne = false;
      onComplete?.();
    }

    return () => {
      engine?.destroy();
      engine = null;
      isPenActive = false;
      isAirborne = false;
    };
  });
</script>

<div
  class="ai-sentence-box"
  class:sink-in={isConfirmed}
  class:smoke-out={isRejected}
  style="left: {bbox[0]}px; top: {bbox[1]}px; width: {bbox[2]}px; min-height: {bbox[3]}px;"
>
  <div bind:this={containerEl} class="tegaki-container"></div>

  <!-- 캔버스 경계에 잘리지 않는 상단 독립 스타일러스 볼펜 오버레이 (공중 보간 연동) -->
  {#if isPenActive}
    <div
      class="stylus-pen-cursor"
      class:airborne={isAirborne}
      style="transform: translate3d({penX}px, {penY}px, 0);"
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
  {/if}
</div>

<style>
  .ai-sentence-box {
    position: absolute;
    padding: 14px 20px;
    border-radius: 8px;
    background: rgba(250, 248, 245, 0.9);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
    border: 1px dashed rgba(160, 150, 140, 0.35);
    pointer-events: none;
    transition: transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1),
                opacity 0.6s cubic-bezier(0.2, 0.8, 0.2, 1),
                filter 0.6s ease;
    z-index: 10;
    overflow: visible; /* 펜촉이 박스 밖으로 뻗어도 잘리지 않음 */
  }

  .tegaki-container {
    font-family: 'Nanum Pen Script', cursive, sans-serif;
    font-size: 32px;
    line-height: 1.5;
    color: #1e1e1e;
    word-break: keep-all;
    overflow: visible;
  }

  .stylus-pen-cursor {
    position: absolute;
    top: 14px; /* padding offset */
    left: 20px;
    pointer-events: none;
    z-index: 50;
    margin-left: -3px; /* 펜촉 접점 (3, 35) 정밀 보정 */
    margin-top: -35px;
    will-change: transform;
    filter: drop-shadow(1px 2px 2px rgba(0, 0, 0, 0.12));
    transition: filter 0.1s ease;
  }

  /* 공중 이동(Air Glide) 중 펜이 종이에서 살짝 들렸을 때의 입체 그림자 */
  .stylus-pen-cursor.airborne {
    filter: drop-shadow(2px 5px 4px rgba(0, 0, 0, 0.18));
  }

  .pen-svg {
    display: block;
    overflow: visible;
  }

  /* O 마킹 시 종이 아래로 스며드는 Sink-in 애니메이션 */
  .ai-sentence-box.sink-in {
    opacity: 0;
    transform: scale(0.92) translateY(8px);
    filter: blur(2px);
  }

  /* X 마킹 시 연기처럼 사라지는 Smoke-out 애니메이션 */
  .ai-sentence-box.smoke-out {
    opacity: 0;
    transform: translateY(-16px) scale(1.05);
    filter: blur(5px);
  }
</style>
