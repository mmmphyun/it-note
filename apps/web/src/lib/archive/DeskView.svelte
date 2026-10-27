<script lang="ts">
  import type { ConfirmedNote } from '@itnote/shared';

  interface Props {
    confirmedNotes: ConfirmedNote[];
    onBackToCanvas: () => void;
  }

  let { confirmedNotes, onBackToCanvas }: Props = $props();
</script>

<div class="desk-container">
  <header class="desk-header">
    <div class="title-area">
      <h1>잇적 데스크 (보관함 및 맥락 관리)</h1>
      <p class="subtitle">종이 속으로 흡수(Sink-in)된 확정 생각과 진화 맥락</p>
    </div>
    <button class="back-button" onclick={onBackToCanvas}>
      캔버스로 돌아가기
    </button>
  </header>

  <main class="desk-content">
    <section class="section">
      <h2>흡수된 확정 노트 ({confirmedNotes.length})</h2>
      {#if confirmedNotes.length === 0}
        <div class="empty-state">
          아직 흡수된 노트가 없습니다. 캔버스에서 AI 문장 위에 동그라미(O)를 그어보세요.
        </div>
      {:else}
        <ul class="notes-list">
          {#each confirmedNotes as note (note.id)}
            <li class="note-card">
              <p class="sentence">{note.sentence}</p>
              <div class="meta">
                <span class="time">{new Date(note.confirmedAt).toLocaleTimeString()}</span>
                <div class="tags">
                  {#each note.keywords as keyword}
                    <span class="tag">#{keyword}</span>
                  {/each}
                </div>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="section">
      <h2>진화 맥락 그래프 (누적 키워드)</h2>
      <div class="context-box">
        <span class="badge">Svelte 5</span>
        <span class="badge">Hono</span>
        <span class="badge">Zero-UI</span>
        <span class="badge">Pure Stylus</span>
      </div>
    </section>
  </main>
</div>

<style>
  .desk-container {
    width: 100vw;
    height: 100vh;
    background: #FAF8F5;
    color: #2b2b2b;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }

  .desk-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 24px 32px;
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
    background: #fff;
  }

  .title-area h1 {
    font-size: 20px;
    font-weight: 700;
  }

  .subtitle {
    font-size: 13px;
    color: #777;
    margin-top: 4px;
  }

  .back-button {
    padding: 10px 18px;
    background: #2b2b2b;
    color: #fff;
    border: none;
    border-radius: 6px;
    font-size: 14px;
    cursor: pointer;
    transition: opacity 0.2s;
  }

  .back-button:hover {
    opacity: 0.85;
  }

  .desk-content {
    max-width: 900px;
    width: 100%;
    margin: 0 auto;
    padding: 32px 24px;
    display: flex;
    flex-direction: column;
    gap: 28px;
  }

  .section h2 {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 16px;
    color: #444;
  }

  .empty-state {
    padding: 32px;
    text-align: center;
    background: #fff;
    border-radius: 8px;
    border: 1px dashed rgba(0, 0, 0, 0.15);
    color: #888;
    font-size: 14px;
  }

  .notes-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .note-card {
    background: #fff;
    padding: 18px 22px;
    border-radius: 8px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
    border: 1px solid rgba(0, 0, 0, 0.06);
  }

  .sentence {
    font-size: 16px;
    line-height: 1.5;
    color: #1a1a1a;
  }

  .meta {
    margin-top: 10px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
    color: #888;
  }

  .tags {
    display: flex;
    gap: 8px;
  }

  .tag {
    color: #4a6fa5;
    background: #eef3f9;
    padding: 2px 8px;
    border-radius: 4px;
  }

  .context-box {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .badge {
    padding: 6px 12px;
    background: #eee;
    border-radius: 16px;
    font-size: 13px;
    color: #333;
  }
</style>
