<script lang="ts">
  import type { UserProfile, RoutineSlot } from '@itnote/shared';
  import RoutineMatrix from './RoutineMatrix.svelte';

  interface Props {
    initialProfile: UserProfile;
    initialRoutine: RoutineSlot[];
    onComplete: (updatedProfile: UserProfile, updatedRoutine: RoutineSlot[]) => void;
  }

  let { initialProfile, initialRoutine, onComplete }: Props = $props();

  let role = $state('');
  let interestsString = $state('');
  let routineSlots = $state<RoutineSlot[]>([]);
  let isSaving = $state(false);
  let errorMessage = $state<string | null>(null);

  $effect(() => {
    role = initialProfile.role || '';
    interestsString = initialProfile.interests.join(', ');
    routineSlots = initialRoutine;
  });

  function handleRoutineChange(newSlots: RoutineSlot[]) {
    routineSlots = newSlots;
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    isSaving = true;
    errorMessage = null;

    const parsedInterests = interestsString
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      // 1. 프로필 업데이트
      const resProf = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, interests: parsedInterests }),
      });
      if (!resProf.ok) throw new Error('프로필 저장에 실패했습니다.');
      const dataProf = await resProf.json();

      // 2. 루틴 업데이트
      const resRoutine = await fetch('/api/auth/routine', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routine: routineSlots }),
      });
      if (!resRoutine.ok) throw new Error('루틴 시간표 저장에 실패했습니다.');
      const dataRoutine = await resRoutine.json();

      onComplete(dataProf.profile, dataRoutine.routine);
    } catch (err: any) {
      errorMessage = err.message || '저장 중 오류가 발생했습니다.';
      isSaving = false;
    }
  }
</script>

<div class="setup-container">
  <div class="setup-card">
    <header class="setup-header">
      <h2>맥락 프로필 및 주간 루틴 온보딩</h2>
      <p>AI가 당신의 직무와 현재 작업 시간대를 이해하여 가장 적합한 단일 문장을 추론합니다.</p>
    </header>

    {#if errorMessage}
      <div class="error-banner">{errorMessage}</div>
    {/if}

    <form class="setup-form" onsubmit={handleSubmit}>
      <div class="form-group">
        <label for="role">현재 직무 / 목표</label>
        <input
          id="role"
          type="text"
          placeholder="예: DevSecOps 취준생, 풀스택 엔지니어, UX 기획자"
          bind:value={role}
          required
        />
      </div>

      <div class="form-group">
        <label for="interests">주요 관심사 및 연구 분야 (쉼표 구분)</label>
        <input
          id="interests"
          type="text"
          placeholder="예: Svelte 5, Hono, 분산 시스템, Zero-UI"
          bind:value={interestsString}
        />
      </div>

      <div class="form-group">
        <span class="group-label">주간 집중 작업 루틴 시간표</span>
        <RoutineMatrix {routineSlots} onChange={handleRoutineChange} />
      </div>

      <div class="button-row">
        <button type="submit" class="submit-btn" disabled={isSaving}>
          {isSaving ? '저장 중...' : '설정 완료하고 백지 캔버스 시작'}
        </button>
      </div>
    </form>
  </div>
</div>

<style>
  .setup-container {
    width: 100vw;
    height: 100vh;
    overflow-y: auto;
    background: #FAF8F5;
    display: flex;
    justify-content: center;
    padding: 40px 20px;
    box-sizing: border-box;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #2B2B2B;
  }

  .setup-card {
    background: #FFFFFF;
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 16px;
    padding: 36px 40px;
    width: 100%;
    max-width: 760px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04);
  }

  .setup-header {
    margin-bottom: 28px;
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
    padding-bottom: 16px;
  }

  .setup-header h2 {
    font-size: 22px;
    font-weight: 700;
    margin: 0 0 6px 0;
  }

  .setup-header p {
    font-size: 14px;
    color: #666;
    margin: 0;
  }

  .error-banner {
    background: #FEE;
    color: #C00;
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 13px;
    margin-bottom: 20px;
  }

  .setup-form {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .form-group label,
  .form-group .group-label {
    font-size: 14px;
    font-weight: 600;
    color: #333;
  }

  .form-group input {
    padding: 10px 14px;
    border-radius: 8px;
    border: 1px solid rgba(0, 0, 0, 0.15);
    font-size: 14px;
    background: #FAFAFA;
  }
  .form-group input:focus {
    outline: none;
    border-color: #385E72;
    background: #FFF;
  }

  .button-row {
    margin-top: 12px;
    display: flex;
    justify-content: flex-end;
  }

  .submit-btn {
    background: #2B2B2B;
    color: #FAF8F5;
    padding: 12px 24px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    border: none;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  .submit-btn:hover:not(:disabled) {
    background: #111;
  }
  .submit-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
