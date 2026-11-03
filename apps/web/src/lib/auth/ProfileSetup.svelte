<script lang="ts">
  import type { UserProfile, RoutineSlot, PersonalPreferences } from '@itnote/shared';
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

  // 선택적 취향/습관 설정 상태
  let isOptionalOpen = $state(false);
  let subInterestsString = $state('');
  let lifestyleHabitsString = $state('');
  let thinkingStyle = $state<'PRAGMATIC' | 'SYSTEMATIC'>('PRAGMATIC');
  let sentenceTone = $state<'CONCISE' | 'DETAILED'>('CONCISE');

  $effect(() => {
    role = initialProfile.role || '';
    interestsString = (initialProfile.interests || []).join(', ');
    routineSlots = initialRoutine || [];

    if (initialProfile.preferences) {
      subInterestsString = (initialProfile.preferences.subInterests || []).join(', ');
      lifestyleHabitsString = (initialProfile.preferences.lifestyleHabits || []).join(', ');
      thinkingStyle = initialProfile.preferences.thinkingStyle || 'PRAGMATIC';
      sentenceTone = initialProfile.preferences.sentenceTone || 'CONCISE';
      isOptionalOpen = true;
    }
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

    const parsedSubInterests = subInterestsString
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const parsedLifestyle = lifestyleHabitsString
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const preferences: PersonalPreferences = {
      subInterests: parsedSubInterests,
      lifestyleHabits: parsedLifestyle,
      thinkingStyle,
      sentenceTone,
    };

    try {
      // 1. 프로필 업데이트 (기본 직무 + 선택적 취향)
      const resProf = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role,
          interests: parsedInterests,
          preferences,
        }),
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
      <!-- 필수 항목 1: 주 직무 -->
      <div class="form-group">
        <label for="role">현재 주 직무 / 목표 (필수)</label>
        <input
          id="role"
          type="text"
          placeholder="예: Java Spring 백엔드 개발자, DevSecOps 취준생, 풀스택 엔지니어"
          bind:value={role}
          required
        />
      </div>

      <!-- 필수 항목 2: 주요 연구/관심 기술 -->
      <div class="form-group">
        <label for="interests">주요 기술 관심사 (쉼표 구분)</label>
        <input
          id="interests"
          type="text"
          placeholder="예: Java, Spring Boot, MySQL, 도커, 쿠버네티스"
          bind:value={interestsString}
        />
      </div>

      <!-- 선택 사항: 작업 습관 & 취향 프로필 아코디언 -->
      <div class="optional-section">
        <button
          type="button"
          class="accordion-trigger"
          onclick={() => (isOptionalOpen = !isOptionalOpen)}
        >
          <span class="trigger-title">
            <span class="badge-opt">선택 사항</span>
            개인 작업 습관 & 서브 취향 프로필
          </span>
          <span class="arrow">{isOptionalOpen ? '▲ 닫기' : '▼ 펼치기 (언제든 건너뛰기 가능)'}</span>
        </button>

        {#if isOptionalOpen}
          <div class="optional-body">
            <p class="opt-desc">
              * 비워두셔도 실제 캔버스 필기와 O/X 제스처를 통해 AI가 당신의 취향을 스스로 역산합니다.
            </p>

            <div class="form-group">
              <label for="sub-interests">사이드 프로젝트 / 서브 기술 스택 (선택)</label>
              <input
                id="sub-interests"
                type="text"
                placeholder="예: React, Next.js, PyTorch/AI 파인튜닝, Flutter, Rust"
                bind:value={subInterestsString}
              />
              <span class="field-hint">주 직무와 무관한 실험적 기술이라도 독자적인 사이드 프로젝트로 인식합니다.</span>
            </div>

            <div class="form-group">
              <label for="lifestyle">개인 취미 & 일상 관심사 (선택)</label>
              <input
                id="lifestyle"
                type="text"
                placeholder="예: 에스프레소/원두, 클라이밍, 러닝, 독서, 요리"
                bind:value={lifestyleHabitsString}
              />
              <span class="field-hint">일상 단어 메모 시 개발 맥락에 억지로 끼워 맞추지 않고 일상 맥락으로 즉시 분기합니다.</span>
            </div>

            <div class="radio-grid">
              <div class="radio-card">
                <span class="card-label">선호 사고 / 작업 스타일</span>
                <label class="radio-option">
                  <input
                    type="radio"
                    name="thinkingStyle"
                    value="PRAGMATIC"
                    checked={thinkingStyle === 'PRAGMATIC'}
                    onchange={() => (thinkingStyle = 'PRAGMATIC')}
                  />
                  <span>실용주의적 빠른 구현 (Ponytail / 프로토타입)</span>
                </label>
                <label class="radio-option">
                  <input
                    type="radio"
                    name="thinkingStyle"
                    value="SYSTEMATIC"
                    checked={thinkingStyle === 'SYSTEMATIC'}
                    onchange={() => (thinkingStyle = 'SYSTEMATIC')}
                  />
                  <span>체계적 구조와 안정성 (아키텍처 / 보안)</span>
                </label>
              </div>

              <div class="radio-card">
                <span class="card-label">AI 추론 문장 선호 문체</span>
                <label class="radio-option">
                  <input
                    type="radio"
                    name="sentenceTone"
                    value="CONCISE"
                    checked={sentenceTone === 'CONCISE'}
                    onchange={() => (sentenceTone = 'CONCISE')}
                  />
                  <span>핵심만 찌르는 날카로운 단문 (20자 이내)</span>
                </label>
                <label class="radio-option">
                  <input
                    type="radio"
                    name="sentenceTone"
                    value="DETAILED"
                    checked={sentenceTone === 'DETAILED'}
                    onchange={() => (sentenceTone = 'DETAILED')}
                  />
                  <span>맥락과 이유를 짚어주는 완결형 복문</span>
                </label>
              </div>
            </div>
          </div>
        {/if}
      </div>

      <!-- 필수 항목 3: 주간 집중 작업 루틴 시간표 -->
      <div class="form-group">
        <span class="group-label">주간 집중 작업 루틴 시간표 (4색 브러시 드래그)</span>
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
    max-width: 800px;
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

  .field-hint {
    font-size: 12px;
    color: #777;
    margin-top: -2px;
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

  .optional-section {
    border: 1px solid rgba(56, 94, 114, 0.2);
    border-radius: 10px;
    background: #F8F9FA;
    overflow: hidden;
  }

  .accordion-trigger {
    width: 100%;
    padding: 14px 18px;
    background: transparent;
    border: none;
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
    font-family: inherit;
  }

  .trigger-title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 14px;
    font-weight: 700;
    color: #2D4C5D;
  }

  .badge-opt {
    background: #385E72;
    color: #FFF;
    font-size: 11px;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: 12px;
  }

  .arrow {
    font-size: 12px;
    color: #666;
    font-weight: 500;
  }

  .optional-body {
    padding: 18px;
    border-top: 1px solid rgba(0, 0, 0, 0.06);
    display: flex;
    flex-direction: column;
    gap: 16px;
    background: #FFF;
  }

  .opt-desc {
    font-size: 12px;
    color: #777;
    margin: 0;
    line-height: 1.4;
  }

  .radio-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin-top: 6px;
  }

  .radio-card {
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 8px;
    padding: 14px;
    background: #FAFAFA;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .card-label {
    font-size: 13px;
    font-weight: 700;
    color: #333;
    margin-bottom: 4px;
  }

  .radio-option {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: #444;
    cursor: pointer;
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
