<script lang="ts">
  import { onMount } from 'svelte';
  import type { ConfirmedNote } from '@itnote/shared';
  import PaperCanvas from './lib/canvas/PaperCanvas.svelte';
  import DeskView from './lib/archive/DeskView.svelte';
  import FontTestView from './lib/dev/FontTestView.svelte';

  let currentView = $state<'canvas' | 'desk' | 'font-test'>('canvas');
  let confirmedNotes = $state<ConfirmedNote[]>([]);

  function checkRoute() {
    const path = window.location.pathname;
    const search = new URLSearchParams(window.location.search);
    if (path === '/font-test' || search.get('view') === 'font-test') {
      currentView = 'font-test';
    } else if (path === '/desk' || search.get('view') === 'desk') {
      currentView = 'desk';
    } else {
      currentView = 'canvas';
    }
  }

  onMount(() => {
    checkRoute();
    window.addEventListener('popstate', checkRoute);
    return () => {
      window.removeEventListener('popstate', checkRoute);
    };
  });

  function handleOpenDesk() {
    currentView = 'desk';
  }

  function handleBackToCanvas() {
    currentView = 'canvas';
    if (window.location.pathname !== '/') {
      window.history.pushState({}, '', '/');
    }
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
  {:else if currentView === 'desk'}
    <DeskView
      {confirmedNotes}
      onBackToCanvas={handleBackToCanvas}
    />
  {:else if currentView === 'font-test'}
    <FontTestView />
  {/if}
</main>

<style>
  .app-root {
    width: 100vw;
    height: 100vh;
    overflow: hidden;
  }
</style>
