<script lang="ts">
  import { onMount } from 'svelte';
  import type { AuthSession } from '@itnote/shared';

  interface Props {
    onLoginSuccess: (session: AuthSession) => void;
  }

  let { onLoginSuccess }: Props = $props();

  let isLoading = $state(true);
  let errorMessage = $state<string | null>(null);

  // 마운트 시 장기 세션 확인 (0초 자동 로그인)
  onMount(async () => {
    try {
      const res = await fetch('/api/auth/session');
      if (res.ok) {
        const data = await res.json();
        if (data.authenticated && data.session) {
          onLoginSuccess(data.session);
          return;
        }
      }
    } catch {
      // 오프라인이거나 세션 만료 시 로그인 화면 유지
    } finally {
      isLoading = false;
    }
  });

  async function handleDemoLogin(fresh = false) {
    isLoading = true;
    errorMessage = null;
    try {
      if (fresh) {
        try {
          localStorage.removeItem('itnote_onboarding_draft');
        } catch {}
      }
      const url = fresh ? '/api/auth/demo?fresh=1' : '/api/auth/demo';
      const res = await fetch(url, { method: 'POST' });
      if (!res.ok) throw new Error('데모 로그인 처리에 실패했습니다.');
      const data = await res.json();
      onLoginSuccess(data.session);
    } catch (err: any) {
      errorMessage = err.message || '로그인 오류가 발생했습니다.';
      isLoading = false;
    }
  }

  function handleGoogleLogin() {
    window.location.href = '/api/auth/login/google';
  }

  function handleKakaoLogin() {
    window.location.href = '/api/auth/login/kakao';
  }
</script>

<div class="login-container">
  <div class="login-card">
    <div class="brand">
      <h1 class="logo">잇적</h1>
      <span class="sub-logo">It!note</span>
      <p class="tagline">생각이 증발하기 전, 단 하나의 문장으로 잇다</p>
    </div>

    {#if isLoading}
      <div class="loading-state">
        <div class="spinner"></div>
        <p>세션을 확인하고 백지 캔버스를 준비하는 중...</p>
      </div>
    {:else}
      {#if errorMessage}
        <div class="error-banner">{errorMessage}</div>
      {/if}

      <div class="auth-buttons">
        <!-- 1. 신규 사용자 온보딩 체험 (직무/관심사 + 7일 시간표 설정) -->
        <button class="btn btn-fresh" onclick={() => handleDemoLogin(true)}>
          <span class="btn-icon">🌱</span>
          <span class="btn-text">신규 온보딩부터 시작 (프로필/시간표 입력)</span>
        </button>

        <!-- 2. 기존 설정 계정으로 0초 캔버스 직행 -->
        <button class="btn btn-demo" onclick={() => handleDemoLogin(false)}>
          <span class="btn-icon">⚡</span>
          <span class="btn-text">기존 프로필로 즉시 시작 (0초 캔버스 직행)</span>
        </button>

        <div class="divider">
          <span>또는 소셜 계정으로 계속하기</span>
        </div>

        <button class="btn btn-google" onclick={handleGoogleLogin}>
          <span class="btn-icon">G</span>
          <span class="btn-text">Google 계정으로 로그인</span>
        </button>

        <button class="btn btn-kakao" onclick={handleKakaoLogin}>
          <span class="btn-icon">K</span>
          <span class="btn-text">카카오 계정으로 로그인</span>
        </button>
      </div>

      <p class="privacy-note">
        * 로그인 후 다음 접속부터는 로그인 창 없이 곧바로 백지 캔버스로 직행합니다.
      </p>
    {/if}
  </div>
</div>

<style>
  .login-container {
    width: 100vw;
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #FAF8F5;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #2B2B2B;
  }

  .login-card {
    background: #FFFFFF;
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 16px;
    padding: 40px 36px;
    width: 100%;
    max-width: 420px;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
    text-align: center;
  }

  .brand {
    margin-bottom: 32px;
  }

  .logo {
    font-size: 32px;
    font-weight: 800;
    letter-spacing: -0.03em;
    color: #1A1A1A;
    margin: 0;
  }

  .sub-logo {
    font-size: 13px;
    color: #8C827A;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    font-weight: 600;
    display: block;
    margin-top: 2px;
  }

  .tagline {
    font-size: 14px;
    color: #666;
    margin-top: 12px;
    line-height: 1.4;
  }

  .loading-state {
    padding: 32px 0;
    color: #777;
    font-size: 14px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .spinner {
    width: 28px;
    height: 28px;
    border: 3px solid rgba(0, 0, 0, 0.1);
    border-top-color: #2B2B2B;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .error-banner {
    background: #FEE;
    color: #C00;
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 13px;
    margin-bottom: 20px;
    text-align: left;
  }

  .auth-buttons {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 12px 18px;
    border-radius: 10px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
    border: 1px solid transparent;
  }

  .btn-fresh {
    background: #385E72;
    color: #FAF8F5;
  }
  .btn-fresh:hover {
    background: #2D4C5D;
  }

  .btn-demo {
    background: #2B2B2B;
    color: #FAF8F5;
  }
  .btn-demo:hover {
    background: #111;
  }

  .divider {
    display: flex;
    align-items: center;
    text-align: center;
    margin: 8px 0;
    color: #AAA;
    font-size: 12px;
  }
  .divider::before,
  .divider::after {
    content: '';
    flex: 1;
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  }
  .divider span {
    padding: 0 10px;
  }

  .btn-google {
    background: #FFF;
    color: #333;
    border-color: #DADCE0;
  }
  .btn-google:hover {
    background: #F8F9FA;
  }

  .btn-kakao {
    background: #FEE500;
    color: #191919;
  }
  .btn-kakao:hover {
    background: #FADA0A;
  }

  .btn-icon {
    font-size: 16px;
    font-weight: 700;
  }

  .privacy-note {
    margin-top: 24px;
    font-size: 12px;
    color: #8C827A;
    line-height: 1.5;
  }
</style>
