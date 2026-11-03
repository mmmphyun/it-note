<script lang="ts">
  import { onMount } from 'svelte';
  import type { ConfirmedNote, EvolvingContext, RoutineSlot, BillingStatus } from '@itnote/shared';
  import RoutineMatrix from '../auth/RoutineMatrix.svelte';
  import PaymentModal from '../billing/PaymentModal.svelte';

  interface Props {
    confirmedNotes: ConfirmedNote[];
    onBackToCanvas: () => void;
    onLogout?: () => void;
  }

  let { confirmedNotes, onBackToCanvas, onLogout }: Props = $props();

  let activeTab = $state<'notes' | 'context' | 'routine' | 'billing'>('notes');
  let evolvingContext = $state<EvolvingContext>({
    ongoingTopics: ['Svelte 5', 'Hono', 'Zero-UI', 'Pure Stylus'],
    domainVocabulary: ['PointerEvent', 'Shoelace', 'Idempotency'],
    confirmedPreferences: [],
    recentConfirmedNotes: [],
  });

  let routineSlots = $state<RoutineSlot[]>([]);
  let billingStatus = $state<BillingStatus>({ plan: 'free', isActive: false });
  let isPaymentModalOpen = $state(false);
  let newTopicInput = $state('');
  let isSaving = $state(false);
  let statusMessage = $state<string | null>(null);

  onMount(async () => {
    await Promise.all([loadContext(), loadRoutine(), loadBilling()]);
  });

  async function loadContext() {
    try {
      const res = await fetch('/api/notes/context');
      if (res.ok) {
        const data = await res.json();
        if (data.context) {
          evolvingContext = data.context;
        }
      }
    } catch {}
  }

  async function loadRoutine() {
    try {
      const res = await fetch('/api/auth/routine');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.routine)) {
          routineSlots = data.routine;
        }
      }
    } catch {}
  }

  async function loadBilling() {
    try {
      const res = await fetch('/api/billing/status');
      if (res.ok) {
        const data = await res.json();
        if (data.status) {
          billingStatus = data.status;
        }
      }
    } catch {}
  }

  async function saveContext(updated: EvolvingContext) {
    evolvingContext = updated;
    try {
      await fetch('/api/notes/context', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
    } catch {}
  }

  function removeTopic(topic: string) {
    const updated = {
      ...evolvingContext,
      ongoingTopics: evolvingContext.ongoingTopics.filter((t) => t !== topic),
    };
    saveContext(updated);
  }

  function removeVocab(vocab: string) {
    const updated = {
      ...evolvingContext,
      domainVocabulary: evolvingContext.domainVocabulary.filter((v) => v !== vocab),
    };
    saveContext(updated);
  }

  function handleAddTopic(e: SubmitEvent) {
    e.preventDefault();
    const trimmed = newTopicInput.trim();
    if (!trimmed) return;
    if (!evolvingContext.ongoingTopics.includes(trimmed)) {
      const updated = {
        ...evolvingContext,
        ongoingTopics: [trimmed, ...evolvingContext.ongoingTopics],
      };
      saveContext(updated);
    }
    newTopicInput = '';
  }

  async function handleRoutineChange(newSlots: RoutineSlot[]) {
    routineSlots = newSlots;
    isSaving = true;
    try {
      await fetch('/api/auth/routine', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routine: newSlots }),
      });
      statusMessage = '시간표 루틴이 저장되었습니다.';
      setTimeout(() => (statusMessage = null), 2000);
    } catch {
      statusMessage = '시간표 저장 실패';
    } finally {
      isSaving = false;
    }
  }

  async function handleLogoutClick() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      if (onLogout) {
        onLogout();
      } else {
        window.location.reload();
      }
    }
  }

  function handlePaymentSuccess() {
    billingStatus = {
      plan: 'pro',
      isActive: true,
      paidAt: Date.now(),
      amount: 9900,
    };
    statusMessage = 'Pro 플랜으로 성공적으로 업그레이드되었습니다!';
    setTimeout(() => (statusMessage = null), 4000);
  }
</script>

<div class="desk-container">
  <header class="desk-header">
    <div class="title-area">
      <h1>잇적 데스크 (Desk & Context)</h1>
      <p class="subtitle">종이 속으로 흡수(Sink-in)된 생각과 진화하는 개인 맥락</p>
    </div>
    <div class="actions">
      <nav class="tab-nav">
        <button class="tab-btn" class:active={activeTab === 'notes'} onclick={() => (activeTab = 'notes')}>
          확정 노트 ({confirmedNotes.length})
        </button>
        <button class="tab-btn" class:active={activeTab === 'context'} onclick={() => (activeTab = 'context')}>
          진화 맥락
        </button>
        <button class="tab-btn" class:active={activeTab === 'routine'} onclick={() => (activeTab = 'routine')}>
          주간 시간표
        </button>
        <button class="tab-btn" class:active={activeTab === 'billing'} onclick={() => (activeTab = 'billing')}>
          구독 {billingStatus.plan === 'pro' ? '★ Pro' : 'Free'}
        </button>
      </nav>

      <button class="btn btn-canvas" onclick={onBackToCanvas}>
        캔버스로 돌아가기
      </button>
      <button class="btn btn-logout" onclick={handleLogoutClick}>
        로그아웃
      </button>
    </div>
  </header>

  {#if statusMessage}
    <div class="toast">{statusMessage}</div>
  {/if}

  <main class="desk-content">
    {#if activeTab === 'notes'}
      <section class="section">
        <h2>흡수된 확정 노트 ({confirmedNotes.length})</h2>
        {#if confirmedNotes.length === 0}
          <div class="empty-state">
            아직 흡수된 노트가 없습니다. 캔버스에서 AI 문장 위에 동그라미(O)를 그어 생각을 흡수해보세요.
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

    {:else if activeTab === 'context'}
      <section class="section">
        <h2>휘발되지 않는 내 진화 맥락 (EvolvingContext)</h2>
        <p class="desc">
          AI 문장에 O를 칠 때마다 키워드와 관심사가 자동으로 살찌워져 보존됩니다. 원치 않는 태그는 클릭해 삭제할 수 있습니다.
        </p>

        <form class="add-tag-form" onsubmit={handleAddTopic}>
          <input
            type="text"
            placeholder="새 맥락 키워드 직접 추가 (예: Rust, WebGPU)"
            bind:value={newTopicInput}
          />
          <button type="submit" class="btn btn-add">추가</button>
        </form>

        <div class="context-group">
          <h3>누적 토픽 (Ongoing Topics)</h3>
          <div class="chips-container">
            {#each evolvingContext.ongoingTopics as topic}
              <button class="chip" onclick={() => removeTopic(topic)} title="클릭하여 삭제">
                #{topic} <span class="chip-x">×</span>
              </button>
            {/each}
            {#if evolvingContext.ongoingTopics.length === 0}
              <span class="empty-text">누적된 토픽이 없습니다.</span>
            {/if}
          </div>
        </div>

        <div class="context-group">
          <h3>도메인 고유 어휘 (Domain Vocabulary)</h3>
          <div class="chips-container">
            {#each evolvingContext.domainVocabulary as vocab}
              <button class="chip vocab" onclick={() => removeVocab(vocab)} title="클릭하여 삭제">
                {vocab} <span class="chip-x">×</span>
              </button>
            {/each}
            {#if evolvingContext.domainVocabulary.length === 0}
              <span class="empty-text">누적된 고유 어휘가 없습니다.</span>
            {/if}
          </div>
        </div>
      </section>

    {:else if activeTab === 'routine'}
      <section class="section">
        <h2>7일 집중 루틴 시간표 수정</h2>
        <p class="desc">
          현재 요일과 시간에 맞춰 AI가 단일 문장 가설의 우선순위를 지능적으로 결정합니다.
        </p>
        <RoutineMatrix {routineSlots} onChange={handleRoutineChange} />
        {#if isSaving}
          <p class="saving-indicator">시간표 변경 사항을 저장하는 중...</p>
        {/if}
      </section>

    {:else if activeTab === 'billing'}
      <section class="section">
        <h2>멤버십 및 결제 관리</h2>
        <div class="billing-card">
          <div class="plan-info">
            <span class="plan-badge" class:pro={billingStatus.plan === 'pro'}>
              {billingStatus.plan === 'pro' ? 'PRO MEMBER' : 'FREE TIER'}
            </span>
            <h3>{billingStatus.plan === 'pro' ? '잇적 Pro 이용 중' : '무료 체험 플랜'}</h3>
            <p>
              {billingStatus.plan === 'pro'
                ? '무제한 AI 단일 문장 실시간 추론과 영구 진화 맥락 보존이 활성화되어 있습니다.'
                : '기본 일일 100회 호출 제한 및 인메모리 세션이 적용됩니다.'}
            </p>
          </div>

          {#if billingStatus.plan !== 'pro'}
            <button class="btn btn-upgrade" onclick={() => (isPaymentModalOpen = true)}>
              Pro 플랜 업그레이드 (월 9,900원)
            </button>
          {:else}
            <div class="paid-meta">
              승인 주문: {billingStatus.orderId || 'PRO_SUBSCRIPTION'} · 결제 금액: 9,900원
            </div>
          {/if}
        </div>
      </section>
    {/if}
  </main>

  <PaymentModal
    isOpen={isPaymentModalOpen}
    onClose={() => (isPaymentModalOpen = false)}
    onSuccess={handlePaymentSuccess}
  />
</div>

<style>
  .desk-container {
    width: 100vw;
    height: 100vh;
    background: #FAF8F5;
    color: #2B2B2B;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }

  .desk-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 32px;
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
    background: #FFF;
    flex-shrink: 0;
  }

  .title-area h1 {
    font-size: 20px;
    font-weight: 700;
    margin: 0;
  }

  .subtitle {
    font-size: 13px;
    color: #777;
    margin-top: 4px;
    margin-bottom: 0;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .tab-nav {
    display: flex;
    gap: 4px;
    background: #F4F2EE;
    padding: 4px;
    border-radius: 8px;
  }

  .tab-btn {
    padding: 8px 14px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    border: none;
    background: transparent;
    color: #666;
    cursor: pointer;
  }
  .tab-btn.active {
    background: #FFF;
    color: #1A1A1A;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  }

  .btn {
    padding: 8px 14px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    border: none;
  }

  .btn-canvas {
    background: #2B2B2B;
    color: #FAF8F5;
  }
  .btn-logout {
    background: #F0EDE8;
    color: #777;
  }

  .toast {
    position: fixed;
    top: 76px;
    right: 32px;
    background: #385E72;
    color: #FFF;
    padding: 10px 18px;
    border-radius: 8px;
    font-size: 13px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 100;
  }

  .desk-content {
    max-width: 900px;
    width: 100%;
    margin: 32px auto;
    padding: 0 24px;
    box-sizing: border-box;
  }

  .section {
    background: #FFF;
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 12px;
    padding: 28px 32px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.02);
  }

  .section h2 {
    font-size: 18px;
    font-weight: 700;
    margin: 0 0 8px 0;
  }

  .desc {
    font-size: 13px;
    color: #777;
    margin-bottom: 20px;
  }

  .empty-state {
    padding: 40px 0;
    text-align: center;
    color: #999;
    font-size: 14px;
  }

  .notes-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .note-card {
    border: 1px solid rgba(0, 0, 0, 0.06);
    border-radius: 8px;
    padding: 14px 18px;
    background: #FAFAFA;
  }

  .note-card .sentence {
    font-size: 15px;
    line-height: 1.5;
    margin: 0 0 8px 0;
    color: #1A1A1A;
  }

  .meta {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: #888;
  }

  .tags {
    display: flex;
    gap: 6px;
  }

  .tag {
    color: #385E72;
    font-weight: 500;
  }

  .add-tag-form {
    display: flex;
    gap: 8px;
    margin-bottom: 24px;
  }
  .add-tag-form input {
    flex: 1;
    padding: 8px 12px;
    border-radius: 6px;
    border: 1px solid rgba(0, 0, 0, 0.15);
    font-size: 13px;
  }
  .btn-add {
    background: #385E72;
    color: #FFF;
    padding: 8px 16px;
  }

  .context-group {
    margin-bottom: 20px;
  }
  .context-group h3 {
    font-size: 14px;
    font-weight: 600;
    margin: 0 0 10px 0;
    color: #555;
  }

  .chips-container {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .chip {
    background: #EEF2F5;
    color: #2D4C5D;
    border: 1px solid rgba(56, 94, 114, 0.2);
    border-radius: 20px;
    padding: 5px 12px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .chip:hover {
    background: #E2EAEF;
  }
  .chip.vocab {
    background: #F3EFE9;
    color: #6E5338;
    border-color: rgba(110, 83, 56, 0.2);
  }

  .chip-x {
    color: #999;
    font-weight: 700;
  }

  .empty-text {
    font-size: 13px;
    color: #AAA;
  }

  .saving-indicator {
    font-size: 12px;
    color: #385E72;
    margin-top: 10px;
  }

  .billing-card {
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 10px;
    padding: 24px;
    background: #FAFAFA;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .plan-badge {
    display: inline-block;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
    background: #DDD;
    color: #555;
  }
  .plan-badge.pro {
    background: #385E72;
    color: #FFF;
  }

  .plan-info h3 {
    margin: 8px 0 4px 0;
    font-size: 18px;
  }
  .plan-info p {
    font-size: 13px;
    color: #666;
    margin: 0;
  }

  .btn-upgrade {
    align-self: flex-start;
    background: #3182F6;
    color: #FFF;
    padding: 10px 18px;
  }

  .paid-meta {
    font-size: 12px;
    color: #777;
  }
</style>
