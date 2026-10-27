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

  // KCC 순차 대필 애니메이션 상태
  let fontMode = $state<'kcc' | 'nanum'>('kcc');
  let kccVisibleLength = $state(0);
  let kccTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    // 로컬스토리지 폰트 설정 조회 (기본값: KCC방정환체)
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('itnote_font_preference') : null;
    fontMode = saved === 'nanum' ? 'nanum' : 'kcc';

    if (fontMode === 'kcc') {
      // KCC방정환체 순차 대필 애니메이션
      if (kccTimer) clearTimeout(kccTimer);
      kccVisibleLength = 0;

      function step() {
        if (kccVisibleLength < sentence.length) {
          kccVisibleLength++;
          kccTimer = setTimeout(step, 65);
        } else {
          onComplete?.();
        }
      }
      step();
    } else {
      // tegaki 나눔손글씨 획순 렌더러
      if (!containerEl) return;
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
        if (containerEl) containerEl.textContent = sentence;
        onComplete?.();
      }
    }

    return () => {
      if (kccTimer) clearTimeout(kccTimer);
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
  {#if fontMode === 'kcc'}
    <div class="kcc-container">
      {sentence.slice(0, kccVisibleLength)}
    </div>
  {:else}
    <div bind:this={containerEl} class="tegaki-container"></div>
  {/if}
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

  .kcc-container {
    font-family: 'KCCBangJeonghwan', cursive, sans-serif;
    font-size: 25px;
    line-height: 1.4;
    color: #242424;
    word-break: keep-all;
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
