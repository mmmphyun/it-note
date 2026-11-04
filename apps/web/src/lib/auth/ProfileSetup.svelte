<script lang="ts">
  import { onMount } from 'svelte';
  import type {
    UserProfile,
    RoutineSlot,
    PersonalPreferences,
    ConsentVerificationResponse,
  } from '@itnote/shared';
  import RoutineMatrix from './RoutineMatrix.svelte';

  interface Props {
    initialProfile: UserProfile;
    initialRoutine: RoutineSlot[];
    onComplete: (updatedProfile: UserProfile, updatedRoutine: RoutineSlot[]) => void;
  }

  let { initialProfile, initialRoutine, onComplete }: Props = $props();

  // 현재 스텝 (1 ~ 7)
  let currentStep = $state(1);
  const TOTAL_STEPS = 7;

  // 1-3: 필수 데이터
  let role = $state('');
  let interestsString = $state('');
  let routineSlots = $state<RoutineSlot[]>([]);

  // 4-6: 선택 데이터
  let subInterestsString = $state('');
  let lifestyleHabitsString = $state('');
  let thinkingStyle = $state<'PRAGMATIC' | 'SYSTEMATIC'>('PRAGMATIC');
  let sentenceTone = $state<'CONCISE' | 'DETAILED'>('CONCISE');

  // 7: 필기 서약 캘리브레이션 및 실시간 AI 동의 여부 판별 상태
  let signatureCanvas: HTMLCanvasElement | null = $state(null);
  let isDrawing = false;
  let strokeCount = $state(0);
  let strokePoints: Array<{ x: number; y: number; t: number }> = [];
  let calibrationSpeed = $state(0);
  let hasDrawnSignature = $state(false);

  let isVerifyingConsent = $state(false);
  let consentStatus = $state<'IDLE' | 'ANALYZING' | 'AGREED' | 'DISAGREED' | 'IRRELEVANT' | 'UNCLEAR'>('IDLE');
  let recognizedConsentText = $state('');
  let consentFeedbackReason = $state('');
  let isConsentAgreed = $state(false);
  let verifyTimer: ReturnType<typeof setTimeout> | null = null;

  // 건너뛰기 확인 모달
  let isSkipModalOpen = $state(false);
  let isSaving = $state(false);
  let errorMessage = $state<string | null>(null);

  const ONBOARDING_DRAFT_KEY = 'itnote_onboarding_draft';

  onMount(() => {
    // 1. 온보딩 도중 튕겼을 때 사용자가 입력했던 실제 값으로 자동 복구
    try {
      const rawDraft = localStorage.getItem(ONBOARDING_DRAFT_KEY);
      if (rawDraft) {
        const draft = JSON.parse(rawDraft);
        if (draft && typeof draft === 'object') {
          if (typeof draft.currentStep === 'number' && draft.currentStep >= 1 && draft.currentStep <= 7) {
            currentStep = draft.currentStep;
          }
          if (typeof draft.role === 'string') role = draft.role;
          if (typeof draft.interestsString === 'string') interestsString = draft.interestsString;
          if (Array.isArray(draft.routineSlots)) routineSlots = draft.routineSlots;
          if (typeof draft.subInterestsString === 'string') subInterestsString = draft.subInterestsString;
          if (typeof draft.lifestyleHabitsString === 'string') lifestyleHabitsString = draft.lifestyleHabitsString;
          if (draft.thinkingStyle === 'PRAGMATIC' || draft.thinkingStyle === 'SYSTEMATIC') {
            thinkingStyle = draft.thinkingStyle;
          }
          if (draft.sentenceTone === 'CONCISE' || draft.sentenceTone === 'DETAILED') {
            sentenceTone = draft.sentenceTone;
          }
          return;
        }
      }
    } catch {}

    // 2. 임시 저장본이 없는 초기 진입 시 기본값 바인딩
    role = initialProfile.role || '';
    interestsString = (initialProfile.interests || []).join(', ');
    routineSlots = initialRoutine || [];

    if (initialProfile.preferences) {
      subInterestsString = (initialProfile.preferences.subInterests || []).join(', ');
      lifestyleHabitsString = (initialProfile.preferences.lifestyleHabits || []).join(', ');
      thinkingStyle = initialProfile.preferences.thinkingStyle || 'PRAGMATIC';
      sentenceTone = initialProfile.preferences.sentenceTone || 'CONCISE';
    }
  });

  // 사용자가 입력한 실제 데이터 변경 시 실시간 로컬 드래프트 백업
  $effect(() => {
    const draft = {
      currentStep,
      role,
      interestsString,
      routineSlots,
      subInterestsString,
      lifestyleHabitsString,
      thinkingStyle,
      sentenceTone,
    };
    try {
      localStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify(draft));
    } catch {}
  });

  // 캔버스 필기 이벤트 핸들러
  function setupSignatureCanvas(node: HTMLCanvasElement) {
    signatureCanvas = node;
    const rect = node.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(rect.width) || 740;
    const height = Math.round(rect.height) || 180;
    node.width = width * dpr;
    node.height = height * dpr;

    const ctx = node.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    // 불투명 흰색 배경 채우기 (JPEG 변환 및 멀티모달 Vision 디코딩 시 왜곡 방지)
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#2B2B2B';
  }

  function getCanvasPoint(e: PointerEvent) {
    if (!signatureCanvas) return { x: 0, y: 0 };
    const rect = signatureCanvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    const dpr = window.devicePixelRatio || 1;
    const logicalWidth = signatureCanvas.width / dpr;
    const logicalHeight = signatureCanvas.height / dpr;

    // CSS 렌더링 크기와 캔버스 내부 논리 버퍼 크기의 비율을 보정하여 우측 포인터 어긋남 완벽 방지
    return {
      x: ((e.clientX - rect.left) / rect.width) * logicalWidth,
      y: ((e.clientY - rect.top) / rect.height) * logicalHeight,
    };
  }

  function handleSigPointerDown(e: PointerEvent) {
    if (e.button !== 0) return; // 좌클릭/터치/펜만 허용 (우클릭 등 무시)
    if (!signatureCanvas) return;
    const { x, y } = getCanvasPoint(e);
    isDrawing = true;
    strokeCount++;
    hasDrawnSignature = true;

    strokePoints.push({ x, y, t: performance.now() });

    const ctx = signatureCanvas.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(x, y);
    }
  }

  function handleSigPointerMove(e: PointerEvent) {
    if (!isDrawing || !signatureCanvas) return;
    const { x, y } = getCanvasPoint(e);

    strokePoints.push({ x, y, t: performance.now() });

    const ctx = signatureCanvas.getContext('2d');
    if (ctx) {
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  }

  function handleSigPointerUp() {
    isDrawing = false;
    // 필기 속도(px/ms) 캘리브레이션 산출
    if (strokePoints.length > 2) {
      let totalDist = 0;
      for (let i = 1; i < strokePoints.length; i++) {
        const dx = strokePoints[i].x - strokePoints[i - 1].x;
        const dy = strokePoints[i].y - strokePoints[i - 1].y;
        totalDist += Math.sqrt(dx * dx + dy * dy);
      }
      const totalTime = strokePoints[strokePoints.length - 1].t - strokePoints[0].t;
      if (totalTime > 0) {
        calibrationSpeed = Math.round((totalDist / totalTime) * 100) / 100;
      }
    }

    // 펜을 뗀 뒤 600ms 동안 추가 입력이 없으면 LLM 필기 인식 & 동의 판정 요청
    if (verifyTimer) clearTimeout(verifyTimer);
    verifyTimer = setTimeout(() => {
      triggerConsentVerification();
    }, 600);
  }

  async function triggerConsentVerification() {
    if (!signatureCanvas || strokeCount === 0) return;

    isVerifyingConsent = true;
    consentStatus = 'ANALYZING';

    try {
      const imageBase64 = signatureCanvas.toDataURL('image/jpeg', 0.95);
      const res = await fetch('/api/auth/verify-consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64,
          strokeMetadata: {
            strokeCount,
            avgSpeed: calibrationSpeed,
          },
        }),
      });

      if (!res.ok) {
        throw new Error('서약 분석 서버 응답 오류');
      }

      const data = (await res.json()) as ConsentVerificationResponse;
      consentStatus = data.sentiment;
      recognizedConsentText = data.recognizedText || '';
      consentFeedbackReason = data.reason || '';
      isConsentAgreed = data.isAgreed;
    } catch {
      consentStatus = 'UNCLEAR';
      recognizedConsentText = '';
      consentFeedbackReason = '서약 검증 통신 오류가 발생했습니다. 다시 작성해 주세요.';
      isConsentAgreed = false;
    } finally {
      isVerifyingConsent = false;
    }
  }

  // 다음 스텝으로 넘어갈 때 입력 필드 자동 포커스
  function autoFocus(node: HTMLInputElement) {
    setTimeout(() => {
      node.focus();
    }, 50);
  }

  // 스텝 전환 시 활성 input 요소 자동 포커스 이동
  $effect(() => {
    void currentStep;
    setTimeout(() => {
      const activeInput = document.querySelector<HTMLInputElement>(
        '.onboarding-container input[type="text"]:not([disabled])'
      );
      if (activeInput) {
        activeInput.focus();
      }
    }, 50);
  });

  // 전역 Enter 키 핸들러 (포커스가 벗어나 있어도 Enter 입력 시 즉시 다음 단계 진행)
  function handleGlobalKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      if (isSkipModalOpen) return;
      if (e.defaultPrevented) return;

      if (currentStep === 1) {
        if (role.trim()) {
          e.preventDefault();
          nextStep();
        }
      } else if (currentStep === 2) {
        if (interestsString.trim()) {
          e.preventDefault();
          nextStep();
        }
      } else if (currentStep >= 3 && currentStep <= 6) {
        e.preventDefault();
        nextStep();
      } else if (currentStep === 7) {
        if (isConsentAgreed && !isSaving && !isVerifyingConsent) {
          e.preventDefault();
          handleFinalSubmit();
        }
      }
    }
  }

  function clearSignature() {
    if (verifyTimer) clearTimeout(verifyTimer);
    if (!signatureCanvas) return;
    const ctx = signatureCanvas.getContext('2d');
    if (ctx) {
      const dpr = window.devicePixelRatio || 1;
      const logicalWidth = signatureCanvas.width / dpr;
      const logicalHeight = signatureCanvas.height / dpr;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, logicalWidth, logicalHeight);
    }
    strokeCount = 0;
    strokePoints = [];
    hasDrawnSignature = false;
    calibrationSpeed = 0;
    isVerifyingConsent = false;
    consentStatus = 'IDLE';
    recognizedConsentText = '';
    consentFeedbackReason = '';
    isConsentAgreed = false;
  }

  function handleRoutineChange(newSlots: RoutineSlot[]) {
    routineSlots = newSlots;
  }

  function nextStep() {
    if (currentStep < TOTAL_STEPS) {
      currentStep++;
    }
  }

  function prevStep() {
    if (currentStep > 1) {
      currentStep--;
    }
  }

  function confirmSkipAll() {
    isSkipModalOpen = false;
    // 선택 단계를 건너뛰고 바로 7단계(필기 서약 캘리브레이션)로 이동
    currentStep = 7;
  }

  async function handleFinalSubmit() {
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
      calibrationSignature: {
        strokeCount,
        avgSpeed: calibrationSpeed,
        agreedLength: strokeCount > 5 ? 'LONG' : 'SHORT',
        recognizedText: recognizedConsentText,
      },
    };

    try {
      // 1. 프로필 업데이트 (세션 만료/서버 재시작으로 401 발생 시 자동 복구 후 1회 재시도)
      let resProf = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role,
          interests: parsedInterests,
          preferences,
        }),
      });

      if (resProf.status === 401) {
        // 인메모리 세션 유실 복구: 신규 데모 세션 자동 발급 후 재시도
        const reAuth = await fetch('/api/auth/demo?fresh=1', { method: 'POST' });
        if (reAuth.ok) {
          resProf = await fetch('/api/auth/profile', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              role,
              interests: parsedInterests,
              preferences,
            }),
          });
        }
      }

      if (!resProf.ok) {
        const errJson = await resProf.json().catch(() => ({}));
        throw new Error(errJson.error ? `프로필 저장 실패: ${errJson.error}` : '프로필 저장에 실패했습니다.');
      }
      const dataProf = await resProf.json();

      // 2. 루틴 업데이트
      const resRoutine = await fetch('/api/auth/routine', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routine: routineSlots }),
      });
      if (!resRoutine.ok) throw new Error('루틴 시간표 저장에 실패했습니다.');
      const dataRoutine = await resRoutine.json();

      try {
        localStorage.removeItem(ONBOARDING_DRAFT_KEY);
      } catch {}

      onComplete(dataProf.profile, dataRoutine.routine);
    } catch (err: any) {
      errorMessage = err.message || '저장 중 오류가 발생했습니다.';
      isSaving = false;
    }
  }
</script>

<svelte:window onkeydown={handleGlobalKeyDown} />

<div class="onboarding-root">
  <div class="onboarding-container">
    <!-- 상단 헤더 & 프로그레스 바 -->
    <header class="progress-header">
      <div class="progress-info">
        <span class="step-badge">
          Step {currentStep} of {TOTAL_STEPS}
          {#if currentStep <= 3}
            <span class="badge-req">필수</span>
          {:else if currentStep <= 6}
            <span class="badge-opt">선택</span>
          {:else}
            <span class="badge-final">최종 동의</span>
          {/if}
        </span>

        {#if currentStep >= 4 && currentStep <= 6}
          <button
            type="button"
            class="skip-all-btn"
            onclick={() => (isSkipModalOpen = true)}
          >
            선택 항목 모두 건너뛰기 ≫
          </button>
        {/if}
      </div>

      <div class="progress-bar-track">
        <div
          class="progress-bar-fill"
          style="width: {(currentStep / TOTAL_STEPS) * 100}%;"
        ></div>
      </div>
    </header>

    {#if errorMessage}
      <div class="error-banner">{errorMessage}</div>
    {/if}

    <!-- 본문 질문 카드 (단일 질문 집중형) -->
    <main class="question-card">
      {#if currentStep === 1}
        <!-- Step 1 (필수): 주 직무 / 본업 / 전공 -->
        <div class="step-content">
          <span class="question-number">Q1.</span>
          <h2 class="question-title">현재 어떤 일이나 공부를 하고 계신가요?</h2>
          <p class="question-desc">
            가장 많은 시간과 열정을 쏟고 있는 본업, 전공 연구, 혹은 준비 중인 목표를 알려주세요.
          </p>
          <div class="input-area">
            <input
              use:autoFocus
              type="text"
              class="large-input"
              placeholder="예: 대학생/취준생, 서비스 기획자, 디자이너, 마케터, 개발자, 작가, 프리랜서"
              bind:value={role}
              onkeydown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (role.trim()) nextStep();
                }
              }}
            />
          </div>
          <div class="nav-row">
            <div></div>
            <button
              type="button"
              class="btn-primary"
              disabled={!role.trim()}
              onclick={nextStep}
            >
              다음으로 (Enter) →
            </button>
          </div>
        </div>

      {:else if currentStep === 2}
        <!-- Step 2 (필수): 주요 관심 주제 / 업무 분야 -->
        <div class="step-content">
          <span class="question-number">Q2.</span>
          <h2 class="question-title">요즘 가장 깊게 몰입하고 있는 핵심 주제는 무엇인가요?</h2>
          <p class="question-desc">
            업무, 전공 연구, 자격증, 사업 기획 등 평소 메모할 일이 많은 주요 관심사를 쉼표로 적어주세요.
          </p>
          <div class="input-area">
            <input
              use:autoFocus
              type="text"
              class="large-input"
              placeholder="예: UX 리서치, 브랜딩 전략, 자격증 시험공부, 데이터 분석, 시장 조사, 영상 편집"
              bind:value={interestsString}
              onkeydown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (interestsString.trim()) nextStep();
                }
              }}
            />
          </div>
          <div class="nav-row">
            <button type="button" class="btn-ghost" onclick={prevStep}>← 이전</button>
            <button
              type="button"
              class="btn-primary"
              disabled={!interestsString.trim()}
              onclick={nextStep}
            >
              다음으로 →
            </button>
          </div>
        </div>

      {:else if currentStep === 3}
        <!-- Step 3 (필수): 주간 집중 작업 루틴 시간표 -->
        <div class="step-content wide">
          <span class="question-number">Q3.</span>
          <h2 class="question-title">평소 주간 집중 작업 루틴을 지정해 주세요.</h2>
          <p class="question-desc">
            현재 요일과 시각을 대조하여 AI가 작업 모드(집중 작업, 기획/회의, 자기계발)에 맞춰 가설 우선순위를 최적화합니다.
          </p>
          <div class="matrix-box">
            <RoutineMatrix {routineSlots} onChange={handleRoutineChange} />
          </div>
          <div class="nav-row">
            <button type="button" class="btn-ghost" onclick={prevStep}>← 이전</button>
            <button type="button" class="btn-primary" onclick={nextStep}>
              필수 설정 완료하고 선택 질문으로 →
            </button>
          </div>
        </div>

      {:else if currentStep === 4}
        <!-- Step 4 (선택): 서브 관심사 / 사이드 프로젝트 -->
        <div class="step-content">
          <div class="opt-indicator">
            <span class="badge-opt">선택 질문</span>
            <span>건너뛰어도 무방합니다.</span>
          </div>
          <span class="question-number">Q4.</span>
          <h2 class="question-title">본업 외에 부업이나 사이드 프로젝트로 도전 중인 영역이 있나요?</h2>
          <p class="question-desc">
            본업과 전혀 다른 분야라도 괜찮습니다. AI가 본업의 틀에 가두지 않고 독립적인 아이디어로 이해합니다.
          </p>
          <div class="input-area">
            <input
              use:autoFocus
              type="text"
              class="large-input"
              placeholder="예: 스마트스토어/이커머스, 소설/브런치 글쓰기, 앱 런칭, 유튜브 채널 운영, 주식/부동산 (쉼표 구분)"
              bind:value={subInterestsString}
              onkeydown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  nextStep();
                }
              }}
            />
          </div>
          <div class="nav-row">
            <button type="button" class="btn-ghost" onclick={prevStep}>← 이전</button>
            <div class="right-buttons">
              <button type="button" class="btn-skip" onclick={nextStep}>이 질문 건너뛰기</button>
              <button type="button" class="btn-primary" onclick={nextStep}>저장하고 다음 →</button>
            </div>
          </div>
        </div>

      {:else if currentStep === 5}
        <!-- Step 5 (선택): 개인 취미 & 일상 관심사 -->
        <div class="step-content">
          <div class="opt-indicator">
            <span class="badge-opt">선택 질문</span>
            <span>건너뛰어도 무방합니다.</span>
          </div>
          <span class="question-number">Q5.</span>
          <h2 class="question-title">평소 즐기는 취미나 일상적인 관심사가 있나요?</h2>
          <p class="question-desc">
            캔버스에 적힌 '원두'나 '클라이밍'을 직무와 억지로 결합하지 않고, 순수한 개인 라이프스타일 맥락으로 분기하기 위함입니다.
          </p>
          <div class="input-area">
            <input
              use:autoFocus
              type="text"
              class="large-input"
              placeholder="예: 스페셜티 커피/원두, 클라이밍/필라테스, 미술관 관람, 여행 계획, 요리/맛집, 반려동물 (쉼표 구분)"
              bind:value={lifestyleHabitsString}
              onkeydown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  nextStep();
                }
              }}
            />
          </div>
          <div class="nav-row">
            <button type="button" class="btn-ghost" onclick={prevStep}>← 이전</button>
            <div class="right-buttons">
              <button type="button" class="btn-skip" onclick={nextStep}>이 질문 건너뛰기</button>
              <button type="button" class="btn-primary" onclick={nextStep}>저장하고 다음 →</button>
            </div>
          </div>
        </div>

      {:else if currentStep === 6}
        <!-- Step 6 (선택): 사고 스타일 및 선호 문체 -->
        <div class="step-content">
          <div class="opt-indicator">
            <span class="badge-opt">선택 질문</span>
            <span>건너뛰어도 무방합니다.</span>
          </div>
          <span class="question-number">Q6.</span>
          <h2 class="question-title">선호하는 사고 스타일과 AI 제안 문체는 무엇인가요?</h2>
          <p class="question-desc">
            생각을 빠르게 시도할지 신중하게 정리할지, 그리고 답변의 어조를 당신의 성향에 맞춥니다.
          </p>

          <div class="choices-grid">
            <div class="choice-group">
              <span class="group-title">작업 성향</span>
              <button
                type="button"
                class="choice-card"
                class:selected={thinkingStyle === 'PRAGMATIC'}
                onclick={() => (thinkingStyle = 'PRAGMATIC')}
              >
                <strong>직관적 실행과 빠른 시도</strong>
                <p>일단 떠오른 생각을 메모하고 가볍게 시도해 보는 것을 선호합니다.</p>
              </button>
              <button
                type="button"
                class="choice-card"
                class:selected={thinkingStyle === 'SYSTEMATIC'}
                onclick={() => (thinkingStyle = 'SYSTEMATIC')}
              >
                <strong>신중한 구조화와 체계성</strong>
                <p>꼼꼼하게 계획을 세우고 논리적 구조와 전체 맥락을 먼저 잡는 것을 선호합니다.</p>
              </button>
            </div>

            <div class="choice-group">
              <span class="group-title">AI 제안 문체</span>
              <button
                type="button"
                class="choice-card"
                class:selected={sentenceTone === 'CONCISE'}
                onclick={() => (sentenceTone = 'CONCISE')}
              >
                <strong>날카로운 단문형 (20자 이내)</strong>
                <p>군더더기 없이 요점만 직관적으로 묻는 간결한 문장을 선호합니다.</p>
              </button>
              <button
                type="button"
                class="choice-card"
                class:selected={sentenceTone === 'DETAILED'}
                onclick={() => (sentenceTone = 'DETAILED')}
              >
                <strong>친절하고 맥락을 짚어주는 완결형 복문</strong>
                <p>생각의 배경과 이유를 함께 되짚어주는 포괄적인 문장을 선호합니다.</p>
              </button>
            </div>
          </div>

          <div class="nav-row">
            <button type="button" class="btn-ghost" onclick={prevStep}>← 이전</button>
            <div class="right-buttons">
              <button type="button" class="btn-skip" onclick={nextStep}>이 질문 건너뛰기</button>
              <button type="button" class="btn-primary" onclick={nextStep}>최종 단계로 →</button>
            </div>
          </div>
        </div>

      {:else if currentStep === 7}
        <!-- Step 7 (최종 피날레): 무의식적 필기 서약 & 캘리브레이션 -->
        <div class="step-content">
          <span class="question-number">Final.</span>
          <h2 class="question-title">마지막으로, 당신의 생각을 적을 준비가 되셨나요?</h2>
          <p class="question-desc">
            잇적은 당신의 고유한 <strong>필기 속도와 압력</strong>을 이해하여, 가장 알맞은 순간에 생각을 잇기 위해 필기 데이터를 활용합니다.<br />
            개인정보 및 필기 데이터 활용에 동의하시나요?
          </p>

          <div class="signature-canvas-wrapper">
            <canvas
              use:setupSignatureCanvas
              class="signature-canvas"
              onpointerdown={handleSigPointerDown}
              onpointermove={handleSigPointerMove}
              onpointerup={handleSigPointerUp}
              onpointerleave={handleSigPointerUp}
              oncontextmenu={(e) => e.preventDefault()}
            ></canvas>

            <div class="canvas-watermark-guide">
              {#if !hasDrawnSignature}
                <span class="guide-text">종이 위에 당신의 답을 자유롭게 적어주세요</span>
              {/if}
            </div>

            <div class="canvas-footer-bar">
              <div class="calib-stats-box">
                {#if isVerifyingConsent}
                  <span class="calib-stats analyzing">
                    AI가 필기 답변을 실시간 분석하고 있습니다...
                  </span>
                {:else if consentStatus === 'AGREED'}
                  <span class="calib-stats agreed">
                    <strong>✓ '{recognizedConsentText}'</strong> — 동의가 확인되었습니다. 시작할 수 있습니다.
                  </span>
                {:else if consentStatus === 'DISAGREED'}
                  <span class="calib-stats disagreed">
                    <strong>✕ '{recognizedConsentText}'</strong> — {consentFeedbackReason || '동의하지 않는 답변입니다.'} 서비스 시작을 위해 동의가 필요합니다.
                  </span>
                {:else if consentStatus === 'IRRELEVANT'}
                  <span class="calib-stats irrelevant">
                    <strong>? '{recognizedConsentText}'</strong> — {consentFeedbackReason || '글씨는 인식되었으나 동의 여부를 알 수 없는 답변입니다.'}
                  </span>
                {:else if consentStatus === 'UNCLEAR'}
                  <span class="calib-stats unclear">
                    ? {consentFeedbackReason || '글씨를 판독할 수 없습니다. 조금 더 또렷하게 적어주세요.'}
                  </span>
                {:else}
                  <span class="calib-stats idle">
                    * 화면 속 종이에 당신의 답을 자유롭게 적어주세요.
                  </span>
                {/if}
              </div>
              <button type="button" class="btn-clear" onclick={clearSignature}>다시 쓰기</button>
            </div>
          </div>

          <div class="nav-row">
            <button type="button" class="btn-ghost" onclick={prevStep}>← 이전</button>
            <button
              type="button"
              class="btn-complete"
              disabled={!isConsentAgreed || isSaving || isVerifyingConsent}
              onclick={handleFinalSubmit}
            >
              {#if isSaving}
                설정 저장 중...
              {:else if isVerifyingConsent}
                답변 분석 중...
              {:else if !isConsentAgreed}
                동의 필기 필요
              {:else}
                시작하기
              {/if}
            </button>
          </div>
        </div>
      {/if}
    </main>
  </div>

  <!-- 선택 항목 한 번에 건너뛰기 설득 모달 -->
  {#if isSkipModalOpen}
    <div
      class="modal-backdrop"
      onclick={() => (isSkipModalOpen = false)}
      onkeydown={(e) => e.key === 'Escape' && (isSkipModalOpen = false)}
      role="presentation"
    >
      <div
        class="modal-box"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        tabindex="-1"
      >
        <h3>선택 설문을 건너뛰시겠습니까?</h3>
        <p class="modal-explanation">
          본업 외의 다양한 관심사나 취미, 일상 메모를 미리 등록해 두시면, AI가 새로운 분야의 글을 접했을 때
          <strong>기존 맥락에 억지로 끼워 맞추지 않고 독립된 생각과 아이디어로 정확히 분류</strong>할 수 있습니다.
        </p>
        <p class="modal-sub">
          * 지금 건너뛰셔도 실제 캔버스 필기와 O/X 피드백을 통해 AI가 당신의 맥락을 스스로 학습합니다.
        </p>
        <div class="modal-actions">
          <button
            type="button"
            class="btn-ghost-modal"
            onclick={() => (isSkipModalOpen = false)}
          >
            계속 입력하기
          </button>
          <button
            type="button"
            class="btn-confirm-skip"
            onclick={confirmSkipAll}
          >
            건너뛰고 최종 동의로 이동
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .onboarding-root {
    width: 100vw;
    height: 100vh;
    background: #FAF8F5;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow-y: auto;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #2B2B2B;
    padding: 24px;
    box-sizing: border-box;
  }

  .onboarding-container {
    width: 100%;
    max-width: 820px;
    background: #FFFFFF;
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 20px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.04);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .progress-header {
    padding: 24px 36px 16px 36px;
    background: #FAFAFA;
    border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  }

  .progress-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .step-badge {
    font-size: 13px;
    font-weight: 700;
    color: #555;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .badge-req {
    background: #E53935;
    color: #FFF;
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 10px;
  }
  .badge-opt {
    background: #385E72;
    color: #FFF;
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 10px;
  }
  .badge-final {
    background: #2B2B2B;
    color: #FFF;
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 10px;
  }

  .skip-all-btn {
    background: none;
    border: none;
    color: #777;
    font-size: 13px;
    cursor: pointer;
    font-weight: 600;
  }
  .skip-all-btn:hover {
    color: #385E72;
    text-decoration: underline;
  }

  .progress-bar-track {
    width: 100%;
    height: 6px;
    background: rgba(0, 0, 0, 0.06);
    border-radius: 3px;
    overflow: hidden;
  }

  .progress-bar-fill {
    height: 100%;
    background: #385E72;
    transition: width 0.3s ease;
  }

  .error-banner {
    background: #FEE;
    color: #C00;
    padding: 10px 20px;
    font-size: 13px;
  }

  .question-card {
    padding: 40px 48px;
    min-height: 440px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }

  .step-content {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .opt-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #777;
    margin-bottom: 8px;
  }

  .question-number {
    font-size: 15px;
    font-weight: 800;
    color: #385E72;
    margin-bottom: 4px;
    letter-spacing: 0.05em;
  }

  .question-title {
    font-size: 24px;
    font-weight: 800;
    margin: 0 0 10px 0;
    line-height: 1.35;
    color: #1A1A1A;
  }

  .question-desc {
    font-size: 14px;
    color: #666;
    margin: 0 0 28px 0;
    line-height: 1.5;
  }

  .input-area {
    margin-bottom: auto;
  }

  .large-input {
    width: 100%;
    padding: 16px 20px;
    font-size: 18px;
    border: 2px solid rgba(0, 0, 0, 0.12);
    border-radius: 12px;
    background: #FAFAFA;
    box-sizing: border-box;
    transition: all 0.2s ease;
  }
  .large-input:focus {
    outline: none;
    border-color: #385E72;
    background: #FFF;
    box-shadow: 0 0 0 4px rgba(56, 94, 114, 0.1);
  }

  .matrix-box {
    margin-bottom: 24px;
  }

  .choices-grid {
    display: flex;
    flex-direction: column;
    gap: 24px;
    margin-bottom: 28px;
  }

  .choice-group {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .group-title {
    font-size: 13px;
    font-weight: 700;
    color: #444;
  }

  .choice-card {
    text-align: left;
    padding: 14px 18px;
    border-radius: 10px;
    border: 1px solid rgba(0, 0, 0, 0.12);
    background: #FAFAFA;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .choice-card:hover {
    background: #F0F4F7;
  }
  .choice-card.selected {
    border-color: #385E72;
    background: #EEF4F7;
    box-shadow: 0 0 0 2px rgba(56, 94, 114, 0.2);
  }
  .choice-card strong {
    font-size: 14px;
    color: #1A1A1A;
    display: block;
    margin-bottom: 4px;
  }
  .choice-card p {
    font-size: 12px;
    color: #666;
    margin: 0;
  }

  /* 캔버스 서약 캘리브레이션 */
  .signature-canvas-wrapper {
    position: relative;
    border: 2px dashed rgba(56, 94, 114, 0.3);
    border-radius: 12px;
    background: #FAF8F5;
    margin-bottom: 28px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .signature-canvas {
    width: 100%;
    height: 180px;
    touch-action: none;
    cursor: crosshair;
  }

  .canvas-watermark-guide {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
    color: #AAA;
    font-size: 14px;
    text-align: center;
  }

  .canvas-footer-bar {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 16px;
    border-top: 1px solid rgba(0, 0, 0, 0.06);
    background: #FFF;
    border-bottom-left-radius: 10px;
    border-bottom-right-radius: 10px;
    box-sizing: border-box;
  }

  .calib-stats-box {
    display: flex;
    align-items: center;
  }

  .calib-stats {
    font-size: 13px;
    color: #666;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    line-height: 1.4;
  }

  .calib-stats.analyzing {
    color: #1976D2;
    font-weight: 500;
  }

  .calib-stats.agreed {
    color: #2E7D32;
    font-weight: 500;
  }

  .calib-stats.disagreed {
    color: #D32F2F;
    font-weight: 500;
  }

  .calib-stats.irrelevant {
    color: #6A1B9A;
    font-weight: 500;
  }

  .calib-stats.unclear {
    color: #E65100;
    font-weight: 500;
  }

  .calib-stats.idle {
    color: #757575;
  }

  .btn-clear {
    background: none;
    border: none;
    font-size: 12px;
    color: #999;
    cursor: pointer;
    text-decoration: underline;
  }
  .btn-clear:hover {
    color: #E53935;
  }

  /* 네비게이션 버튼 바 */
  .nav-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 24px;
    padding-top: 20px;
    border-top: 1px solid rgba(0, 0, 0, 0.06);
  }

  .right-buttons {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .btn-primary {
    background: #2B2B2B;
    color: #FAF8F5;
    border: none;
    padding: 12px 24px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  .btn-primary:hover:not(:disabled) {
    background: #111;
  }
  .btn-primary:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .btn-complete {
    background: #385E72;
    color: #FFF;
    border: none;
    padding: 14px 28px;
    border-radius: 8px;
    font-size: 15px;
    font-weight: 800;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  .btn-complete:hover:not(:disabled) {
    background: #2D4C5D;
  }
  .btn-complete:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .btn-ghost {
    background: none;
    border: 1px solid rgba(0, 0, 0, 0.15);
    color: #666;
    padding: 10px 18px;
    border-radius: 8px;
    font-size: 14px;
    cursor: pointer;
  }

  .btn-skip {
    background: none;
    border: none;
    color: #888;
    font-size: 13px;
    cursor: pointer;
    text-decoration: underline;
  }

  /* 설득 모달 */
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(3px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal-box {
    background: #FFF;
    border-radius: 16px;
    padding: 32px;
    max-width: 460px;
    width: 90%;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
  }
  .modal-box h3 {
    margin: 0 0 12px 0;
    font-size: 18px;
    font-weight: 700;
  }
  .modal-explanation {
    font-size: 14px;
    line-height: 1.5;
    color: #444;
    margin: 0 0 10px 0;
  }
  .modal-sub {
    font-size: 12px;
    color: #777;
    margin: 0 0 24px 0;
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
  }
  .btn-ghost-modal {
    background: #F0EDE8;
    border: none;
    color: #555;
    padding: 10px 16px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .btn-confirm-skip {
    background: #385E72;
    border: none;
    color: #FFF;
    padding: 10px 18px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
</style>
