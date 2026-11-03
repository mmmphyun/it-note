<script lang="ts">
  import { onMount } from 'svelte';
  import type { ConfirmedNote, EvolvingContext, RoutineSlot, BillingStatus, UserProfile } from '@itnote/shared';
  import RoutineMatrix from '../auth/RoutineMatrix.svelte';
  import PaymentModal from '../billing/PaymentModal.svelte';

  interface Props {
    confirmedNotes: ConfirmedNote[];
    onBackToCanvas: () => void;
    onLogout?: () => void;
  }

  let { confirmedNotes, onBackToCanvas, onLogout }: Props = $props();

  let activeTab = $state<'notes' | 'context' | 'routine' | 'profile' | 'billing'>('notes');
  let evolvingContext = $state<EvolvingContext>({
    ongoingTopics: ['Svelte 5', 'Hono', 'Zero-UI', 'Pure Stylus'],
    domainVocabulary: ['PointerEvent', 'Shoelace', 'Idempotency'],
    confirmedPreferences: [],
    recentConfirmedNotes: [],
  });

  let userProfile = $state<UserProfile>({
    id: '',
    role: '',
    interests: [],
    createdAt: Date.now(),
  });
  let profileRoleInput = $state('');
  let profileInterestsInput = $state('');
  let subInterestsInput = $state('');
  let lifestyleInput = $state('');
  let thinkingStyle = $state<'PRAGMATIC' | 'SYSTEMATIC'>('PRAGMATIC');
  let sentenceTone = $state<'CONCISE' | 'DETAILED'>('CONCISE');

  let routineSlots = $state<RoutineSlot[]>([]);
  let billingStatus = $state<BillingStatus>({ plan: 'free', isActive: false });
  let isPaymentModalOpen = $state(false);
  let newTopicInput = $state('');
  let isSaving = $state(false);
  let isRefunding = $state(false);
  let statusMessage = $state<string | null>(null);

  onMount(async () => {
    await Promise.all([loadContext(), loadRoutine(), loadProfile(), loadBilling()]);
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

  async function loadProfile() {
    try {
      const res = await fetch('/api/auth/session');
      if (res.ok) {
        const data = await res.json();
        if (data.authenticated && data.session) {
          userProfile = data.session.user;
          profileRoleInput = userProfile.role || '';
          profileInterestsInput = (userProfile.interests || []).join(', ');
          if (userProfile.preferences) {
            subInterestsInput = (userProfile.preferences.subInterests || []).join(', ');
            lifestyleInput = (userProfile.preferences.lifestyleHabits || []).join(', ');
            thinkingStyle = userProfile.preferences.thinkingStyle || 'PRAGMATIC';
            sentenceTone = userProfile.preferences.sentenceTone || 'CONCISE';
          }
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

  async function handleSaveProfile(e: SubmitEvent) {
    e.preventDefault();
    isSaving = true;
    const parsedInterests = profileInterestsInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const parsedSub = subInterestsInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const parsedLife = lifestyleInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: profileRoleInput,
          interests: parsedInterests,
          preferences: {
            subInterests: parsedSub,
            lifestyleHabits: parsedLife,
            thinkingStyle,
            sentenceTone,
          },
        }),
      });
      if (!res.ok) throw new Error('프로필 저장에 실패했습니다.');
      const data = await res.json();
      userProfile = data.profile;
      statusMessage = '프로필 페르소나가 성공적으로 저장되었습니다.';
      setTimeout(() => (statusMessage = null), 3000);
    } catch (err: any) {
      statusMessage = err.message || '저장 실패';
    } finally {
      isSaving = false;
    }
  }

  async function handleRefund() {
    if (!confirm('정말로 Pro 멤버십을 취소하고 전액 환불을 진행하시겠습니까?')) {
      return;
    }

    isRefunding = true;
    try {
      const res = await fetch('/api/billing/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: billingStatus.orderId,
          cancelReason: '고객 요청 전액 환불',
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || '환불 처리에 실패했습니다.');
      }

      const data = await res.json();
      billingStatus = {
        ...billingStatus,
        plan: 'free',
        isActive: false,
        status: 'REFUNDED',
        refundedAt: data.refundedAt,
        cancelReason: data.cancelReason,
      };
      statusMessage = '결제가 성공적으로 취소 및 전액 환불되었습니다.';
      setTimeout(() => (statusMessage = null), 4000);
    } catch (err: any) {
      alert(err.message || '환불 처리 중 오류가 발생했습니다.');
    } finally {
      isRefunding = false;
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

  function handlePaymentSuccess(data: any) {
    billingStatus = {
      plan: 'pro',
      isActive: true,
      status: 'PAID',
      orderId: data.orderId,
      paymentKey: data.paymentKey,
      method: data.method || '토스페이먼츠 (테스트 카드)',
      paidAt: data.paidAt || Date.now(),
      amount: data.amount || 9900,
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
        <button class="tab-btn" class:active={activeTab === 'profile'} onclick={() => (activeTab = 'profile')}>
          내 프로필
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

    {:else if activeTab === 'profile'}
      <section class="section">
        <h2>사용자 정보 및 맥락 페르소나 설정</h2>
        <p class="desc">
          AI가 당신의 현재 역할과 전문 관심사를 기반으로 가장 적합한 단일 문장을 추론합니다.
        </p>
        <form class="profile-form" onsubmit={handleSaveProfile}>
          <div class="form-group">
            <label for="p-role">현재 직무 / 목표 페르소나</label>
            <input
              id="p-role"
              type="text"
              placeholder="예: DevSecOps 취준생, 풀스택 아키텍트"
              bind:value={profileRoleInput}
              required
            />
          </div>
          <div class="form-group">
            <label for="p-interests">전문 연구 및 관심 기술 (쉼표 구분)</label>
            <input
              id="p-interests"
              type="text"
              placeholder="예: Java, Spring Boot, MySQL, 쿠버네티스"
              bind:value={profileInterestsInput}
            />
          </div>

          <div class="form-group">
            <label for="p-sub">사이드 프로젝트 / 서브 관심사 (선택)</label>
            <input
              id="p-sub"
              type="text"
              placeholder="예: React, Next.js, PyTorch/AI 파인튜닝, Flutter"
              bind:value={subInterestsInput}
            />
          </div>

          <div class="form-group">
            <label for="p-life">취미 및 개인 일상 관심사 (선택)</label>
            <input
              id="p-life"
              type="text"
              placeholder="예: 에스프레소/원두, 클라이밍, 러닝, 독서"
              bind:value={lifestyleInput}
            />
          </div>

          <div class="form-row-2col">
            <div class="form-group">
              <label for="p-thinking">선호 사고 스타일</label>
              <select id="p-thinking" bind:value={thinkingStyle}>
                <option value="PRAGMATIC">실용주의 빠른 구현 (Ponytail / 프로토타입)</option>
                <option value="SYSTEMATIC">체계적 구조와 안정성 (아키텍처 / 보안)</option>
              </select>
            </div>
            <div class="form-group">
              <label for="p-tone">AI 문장 선호 문체</label>
              <select id="p-tone" bind:value={sentenceTone}>
                <option value="CONCISE">핵심만 찌르는 날카로운 단문 (20자 이내)</option>
                <option value="DETAILED">맥락과 이유를 짚어주는 완결형 복문</option>
              </select>
            </div>
          </div>

          <button type="submit" class="btn btn-save" disabled={isSaving}>
            {isSaving ? '저장 중...' : '프로필 페르소나 저장'}
          </button>
        </form>
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
            <!-- 결제 영수증 상세 내역 -->
            <div class="receipt-box">
              <h4>결제 영수증 상세</h4>
              <div class="receipt-row">
                <span class="r-label">주문 번호:</span>
                <span class="r-value font-mono">{billingStatus.orderId}</span>
              </div>
              <div class="receipt-row">
                <span class="r-label">결제 키(PG):</span>
                <span class="r-value font-mono">{billingStatus.paymentKey || 'mock_toss_approved'}</span>
              </div>
              <div class="receipt-row">
                <span class="r-label">결제 수단:</span>
                <span class="r-value">{billingStatus.method || '토스페이먼츠 (테스트 카드)'}</span>
              </div>
              <div class="receipt-row">
                <span class="r-label">승인 시각:</span>
                <span class="r-value">{new Date(billingStatus.paidAt || Date.now()).toLocaleString()}</span>
              </div>
              <div class="receipt-row">
                <span class="r-label">결제 금액:</span>
                <span class="r-value highlight">9,900원 (정상 승인 완료)</span>
              </div>

              <div class="refund-action-area">
                <button
                  type="button"
                  class="btn btn-refund"
                  onclick={handleRefund}
                  disabled={isRefunding}
                >
                  {isRefunding ? '환불 처리 중...' : '결제 취소 및 전액 환불 요청'}
                </button>
              </div>
            </div>
          {/if}

          {#if billingStatus.status === 'REFUNDED'}
            <div class="refund-history-box">
              <span class="refund-badge">환불 완료</span>
              <p>
                주문 {billingStatus.orderId} 결제가 {new Date(billingStatus.refundedAt || Date.now()).toLocaleString()}에 전액 환불되었습니다.
              </p>
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

  .profile-form {
    display: flex;
    flex-direction: column;
    gap: 18px;
    max-width: 640px;
  }
  .form-row-2col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .form-group label {
    font-size: 13px;
    font-weight: 600;
    color: #444;
  }
  .form-group input,
  .form-group select {
    padding: 10px 12px;
    border-radius: 6px;
    border: 1px solid rgba(0, 0, 0, 0.15);
    font-size: 14px;
    background: #FFF;
  }
  .btn-save {
    align-self: flex-start;
    background: #2B2B2B;
    color: #FFF;
    padding: 10px 20px;
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
    gap: 20px;
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

  .receipt-box {
    background: #FFF;
    border: 1px solid rgba(0, 0, 0, 0.1);
    border-radius: 8px;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .receipt-box h4 {
    margin: 0 0 8px 0;
    font-size: 15px;
    font-weight: 700;
    border-bottom: 1px solid rgba(0, 0, 0, 0.06);
    padding-bottom: 8px;
  }
  .receipt-row {
    display: flex;
    justify-content: space-between;
    font-size: 13px;
  }
  .r-label {
    color: #777;
  }
  .r-value {
    color: #222;
    font-weight: 500;
  }
  .r-value.highlight {
    color: #3182F6;
    font-weight: 700;
  }
  .font-mono {
    font-family: monospace;
    font-size: 12px;
  }

  .refund-action-area {
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px dashed rgba(0, 0, 0, 0.1);
    display: flex;
    justify-content: flex-end;
  }
  .btn-refund {
    background: #FFF;
    color: #D32F2F;
    border: 1px solid #D32F2F;
    padding: 8px 16px;
  }
  .btn-refund:hover:not(:disabled) {
    background: #FFEBEE;
  }

  .refund-history-box {
    background: #FFF3E0;
    border: 1px solid #FFE0B2;
    border-radius: 8px;
    padding: 14px 18px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .refund-badge {
    background: #E65100;
    color: #FFF;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
  }
  .refund-history-box p {
    margin: 0;
    font-size: 13px;
    color: #5D4037;
  }
</style>
