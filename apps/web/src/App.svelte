<script lang="ts">
  import { onMount } from 'svelte';
  import type { ConfirmedNote, AuthSession, UserProfile, RoutineSlot } from '@itnote/shared';
  import PaperCanvas from './lib/canvas/PaperCanvas.svelte';
  import DeskView from './lib/archive/DeskView.svelte';
  import LoginView from './lib/auth/LoginView.svelte';
  import ProfileSetup from './lib/auth/ProfileSetup.svelte';
  import FontTestView from './lib/dev/FontTestView.svelte';
  import PipelineDevView from './lib/dev/PipelineDevView.svelte';
  import HandwritingOcrDevView from './lib/dev/HandwritingOcrDevView.svelte';

  type ViewType = 'canvas' | 'desk' | 'login' | 'setup' | 'font-test' | 'dev' | 'handwriting';

  let currentView = $state<ViewType>('canvas');
  let confirmedNotes = $state<ConfirmedNote[]>([]);
  let currentSession = $state<AuthSession | null>(null);
  let userRoutine = $state<RoutineSlot[]>([]);
  let isAuthChecked = $state(false);

  async function checkSession() {
    try {
      const res = await fetch('/api/auth/session');
      if (res.ok) {
        const data = await res.json();
        if (data.authenticated && data.session) {
          currentSession = data.session;
          userRoutine = data.routine || [];
          return;
        }
      }
    } catch {}
    currentSession = null;
  }

  async function checkRoute() {
    const path = window.location.pathname;
    const search = new URLSearchParams(window.location.search);

    if (path === '/handwriting' || search.get('view') === 'handwriting') {
      currentView = 'handwriting';
      return;
    }
    if (path === '/dev' || search.get('view') === 'dev') {
      currentView = 'dev';
      return;
    }
    if (path === '/font-test' || search.get('view') === 'font-test') {
      currentView = 'font-test';
      return;
    }

    // 기본 진입점: 세션 확인
    if (!currentSession) {
      await checkSession();
    }

    // 1. 미인증 상태: 로그인 뷰로 강제 및 URL 동기화
    if (!currentSession) {
      currentView = 'login';
      if (path !== '/login' && path !== '/') {
        window.history.replaceState({}, '', '/login');
      }
      return;
    }

    // 2. 프로필 미완료 상태: 온보딩(setup) 뷰로 강제 및 URL 동기화
    if (!currentSession.user.role) {
      currentView = 'setup';
      if (path !== '/setup' && path !== '/') {
        window.history.replaceState({}, '', '/setup');
      }
      return;
    }

    // 3. 인증 및 프로필 완료 상태
    if (path === '/desk' || search.get('view') === 'desk') {
      currentView = 'desk';
    } else {
      currentView = 'canvas';
      if (path === '/login' || path === '/setup') {
        window.history.replaceState({}, '', '/');
      }
    }
  }

  onMount(() => {
    checkRoute().finally(() => {
      isAuthChecked = true;
    });
    window.addEventListener('popstate', checkRoute);
    return () => {
      window.removeEventListener('popstate', checkRoute);
    };
  });

  function handleLoginSuccess(session: AuthSession) {
    currentSession = session;
    if (!session.user.role) {
      currentView = 'setup';
      if (window.location.pathname !== '/setup') {
        window.history.replaceState({}, '', '/setup');
      }
    } else {
      currentView = 'canvas';
      if (window.location.pathname !== '/') {
        window.history.replaceState({}, '', '/');
      }
    }
  }

  function handleSetupComplete(updatedProfile: UserProfile, updatedRoutine: RoutineSlot[]) {
    if (currentSession) {
      currentSession = {
        ...currentSession,
        user: updatedProfile,
      };
    }
    userRoutine = updatedRoutine;
    currentView = 'canvas';
    if (window.location.pathname !== '/') {
      window.history.replaceState({}, '', '/');
    }
  }

  function handleOpenDesk() {
    currentView = 'desk';
    if (window.location.pathname !== '/desk') {
      window.history.pushState({}, '', '/desk');
    }
  }

  function handleBackToCanvas() {
    currentView = 'canvas';
    if (window.location.pathname !== '/') {
      window.history.pushState({}, '', '/');
    }
  }

  function handleLogout() {
    currentSession = null;
    currentView = 'login';
    if (window.location.pathname !== '/login') {
      window.history.replaceState({}, '', '/login');
    }
  }

  async function handleConfirmedNote(note: ConfirmedNote) {
    confirmedNotes = [note, ...confirmedNotes];

    // 백엔드 O 확정 및 profileEnricher 연동
    try {
      await fetch('/api/notes/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(note),
      });
    } catch {}
  }
</script>

<main class="app-root">
  {#if !isAuthChecked}
    <div class="initial-loader">
      <div class="loader-dot"></div>
    </div>
  {:else if currentView === 'login'}
    <LoginView onLoginSuccess={handleLoginSuccess} />
  {:else if currentView === 'setup' && currentSession}
    <ProfileSetup
      initialProfile={currentSession.user}
      initialRoutine={userRoutine}
      onComplete={handleSetupComplete}
    />
  {:else if currentView === 'canvas'}
    <PaperCanvas
      onOpenDesk={handleOpenDesk}
      onConfirmedNote={handleConfirmedNote}
    />
  {:else if currentView === 'desk'}
    <DeskView
      {confirmedNotes}
      onBackToCanvas={handleBackToCanvas}
      onLogout={handleLogout}
    />
  {:else if currentView === 'font-test'}
    <FontTestView />
  {:else if currentView === 'dev'}
    <PipelineDevView />
  {:else if currentView === 'handwriting'}
    <HandwritingOcrDevView />
  {/if}
</main>

<style>
  .app-root {
    width: 100vw;
    height: 100vh;
    overflow: hidden;
  }

  .initial-loader {
    width: 100vw;
    height: 100vh;
    background: #FAF8F5;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .loader-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #8C827A;
    opacity: 0.6;
    animation: pulse 1s ease-in-out infinite alternate;
  }

  @keyframes pulse {
    from { transform: scale(0.8); opacity: 0.3; }
    to { transform: scale(1.3); opacity: 0.9; }
  }
</style>
