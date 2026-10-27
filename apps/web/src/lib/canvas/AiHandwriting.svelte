<script lang="ts">
  import { TegakiEngine } from 'tegaki/core';
  import nanumFont from 'tegaki/fonts/nanum-pen-script';
  import { createStylusPenPlugin, getTegakiTiming } from './stylusPenPlugin';

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

  $effect(() => {
    if (!containerEl) return;

    // 이전 엔진 정리 및 컨테이너 비우기
    engine?.destroy();
    containerEl.innerHTML = '';

    // 로컬스토리지 속도 레벨 (1 ~ 10, 기본 4) 및 펜촉 표시 여부 조회
    const savedLevel = typeof localStorage !== 'undefined' ? Number(localStorage.getItem('itnote_writing_speed') || 4) : 4;
    const showPenTip = typeof localStorage !== 'undefined' ? localStorage.getItem('itnote_pen_tip') !== 'false' : true;

    const timing = getTegakiTiming(savedLevel);
    const plugins = showPenTip ? [createStylusPenPlugin(true)] : [];

    try {
      engine = new TegakiEngine(containerEl, {
        text: sentence,
        font: nanumFont,
        timing,
        plugins,
        onComplete: () => {
          onComplete?.();
        },
      });
    } catch {
      if (containerEl) containerEl.textContent = sentence;
      onComplete?.();
    }

    return () => {
      engine?.destroy();
      engine = null;
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
  }

  .tegaki-container {
    font-family: 'Nanum Pen Script', cursive, sans-serif;
    font-size: 32px;
    line-height: 1.5;
    color: #1e1e1e;
    word-break: keep-all;
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
