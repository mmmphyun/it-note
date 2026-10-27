<script lang="ts">
  import type { ConfirmedNote } from '@itnote/shared';
  import PaperCanvas from './lib/canvas/PaperCanvas.svelte';
  import DeskView from './lib/archive/DeskView.svelte';

  let currentView = $state<'canvas' | 'desk'>('canvas');
  let confirmedNotes = $state<ConfirmedNote[]>([]);

  function handleOpenDesk() {
    currentView = 'desk';
  }

  function handleBackToCanvas() {
    currentView = 'canvas';
  }

  function handleConfirmedNote(note: ConfirmedNote) {
    confirmedNotes = [note, ...confirmedNotes];
  }
</script>

<main class="app-root">
  {#if currentView === 'canvas'}
    <PaperCanvas
      onOpenDesk={handleOpenDesk}
      onConfirmedNote={handleConfirmedNote}
    />
  {:else}
    <DeskView
      {confirmedNotes}
      onBackToCanvas={handleBackToCanvas}
    />
  {/if}
</main>

<style>
  .app-root {
    width: 100vw;
    height: 100vh;
    overflow: hidden;
  }
</style>
