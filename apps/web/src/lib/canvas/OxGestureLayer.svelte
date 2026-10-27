<script lang="ts">
  import type { Point, GestureType } from './gestureRecognizer';
  import { recognizeOxGesture } from './gestureRecognizer';

  interface Props {
    targetBbox: [number, number, number, number] | null; // [x, y, width, height]
    onGesture: (type: GestureType) => void;
  }

  let { targetBbox, onGesture }: Props = $props();

  let gestureFeedback = $state<GestureType>('NONE');
  let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

  export function evaluateStrokes(strokes: Point[][]): GestureType {
    if (!targetBbox) return 'NONE';

    const result = recognizeOxGesture(strokes, targetBbox);
    if (result !== 'NONE') {
      gestureFeedback = result;
      if (feedbackTimer) clearTimeout(feedbackTimer);
      feedbackTimer = setTimeout(() => {
        gestureFeedback = 'NONE';
      }, 700);

      onGesture(result);
    }
    return result;
  }
</script>

{#if targetBbox && gestureFeedback !== 'NONE'}
  <div
    class="gesture-indicator"
    class:confirmed={gestureFeedback === 'O'}
    class:rejected={gestureFeedback === 'X'}
    style="left: {targetBbox[0]}px; top: {targetBbox[1]}px; width: {targetBbox[2]}px; height: {targetBbox[3]}px;"
  >
    <span class="symbol">{gestureFeedback}</span>
  </div>
{/if}

<style>
  .gesture-indicator {
    position: absolute;
    pointer-events: none;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity 0.3s ease;
    z-index: 20;
  }

  .gesture-indicator.confirmed {
    background: rgba(56, 142, 60, 0.08);
    border: 2px solid rgba(56, 142, 60, 0.4);
  }

  .gesture-indicator.rejected {
    background: rgba(211, 47, 47, 0.08);
    border: 2px solid rgba(211, 47, 47, 0.4);
  }

  .symbol {
    font-size: 32px;
    font-weight: bold;
    opacity: 0.6;
  }

  .confirmed .symbol {
    color: #2e7d32;
  }

  .rejected .symbol {
    color: #c62828;
  }
</style>
