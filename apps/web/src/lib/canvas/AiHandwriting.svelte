<script lang="ts">
  import { TegakiEngine } from 'tegaki/core';
  import nanumFont from 'tegaki/fonts/nanum-pen-script';

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

    // 이전 엔진 정리 및 컨테이너 비우기 (중복 텍스트 방지)
    engine?.destroy();
    containerEl.innerHTML = '';

    try {
      engine = new TegakiEngine(containerEl, {
        text: sentence,
        font: nanumFont,
        onComplete: () => {
          onComplete?.();
        }
      });
    } catch {
      // 폰트 번들 누락 글자 발생 시 CSS Nanum Pen Script 렌더링 폴백
      if (containerEl) {
        containerEl.textContent = sentence;
      }
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
    padding: 12px 18px;
    border-radius: 6px;
    background: rgba(250, 248, 245, 0.85);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    border: 1px dashed rgba(160, 150, 140, 0.3);
    pointer-events: none;
    transition: transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1),
                opacity 0.6s cubic-bezier(0.2, 0.8, 0.2, 1),
                filter 0.6s ease;
    z-index: 10;
  }

  .tegaki-container {
    font-family: 'Nanum Pen Script', cursive, sans-serif;
    font-size: 24px;
    line-height: 1.4;
    color: #2b2b2b;
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
