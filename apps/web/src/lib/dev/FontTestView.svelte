<script lang="ts">
  import { onMount } from 'svelte';
  import { TegakiEngine } from 'tegaki/core';
  import nanumFont from 'tegaki/fonts/nanum-pen-script';

  let testText = $state('가상 DOM 오버헤드가 큰 React 대신 Svelte 5와 Hono로 모노레포를 구성하는 계획 맞나요?');
  let fontSize = $state(26);
  let typingSpeedMs = $state(70); // 글자당 노출 딜레이 (ms)

  // KCC방정환체 애니메이션 상태
  let kccVisibleLength = $state(0);
  let isKccAnimating = $state(false);
  let kccTimer: ReturnType<typeof setTimeout> | null = null;

  // 나눔손글씨 tegaki 엔진 상태
  let tegakiContainer = $state<HTMLDivElement | null>(null);
  let tegakiEngine: TegakiEngine | null = null;

  // 현재 캔버스 기본 폰트 설정 (localStorage 연동)
  let activeCanvasFont = $state<'kcc' | 'nanum'>('kcc');

  function startKccAnimation() {
    if (kccTimer) clearTimeout(kccTimer);
    kccVisibleLength = 0;
    isKccAnimating = true;

    function step() {
      if (kccVisibleLength < testText.length) {
        kccVisibleLength++;
        kccTimer = setTimeout(step, typingSpeedMs);
      } else {
        isKccAnimating = false;
      }
    }
    step();
  }

  function startTegakiAnimation() {
    if (!tegakiContainer) return;
    tegakiEngine?.destroy();
    tegakiContainer.innerHTML = '';

    try {
      tegakiEngine = new TegakiEngine(tegakiContainer, {
        text: testText,
        font: nanumFont,
      });
    } catch {
      if (tegakiContainer) tegakiContainer.textContent = testText;
    }
  }

  function runAllAnimations() {
    startKccAnimation();
    startTegakiAnimation();
  }

  function setCanvasDefaultFont(font: 'kcc' | 'nanum') {
    activeCanvasFont = font;
    localStorage.setItem('itnote_font_preference', font);
  }

  onMount(() => {
    const saved = localStorage.getItem('itnote_font_preference');
    if (saved === 'kcc' || saved === 'nanum') {
      activeCanvasFont = saved;
    }
    runAllAnimations();

    return () => {
      if (kccTimer) clearTimeout(kccTimer);
      tegakiEngine?.destroy();
    };
  });
</script>

<div class="dev-container">
  <header class="dev-header">
    <div class="title-wrap">
      <h1>개발자 폰트 및 대필 애니메이션 테스트 룸</h1>
      <p class="desc">30s+60s 대기 없이 즉시 폰트 렌더링과 애니메이션을 비교·검증하는 전용 라우트입니다.</p>
    </div>
    <div class="nav-links">
      <a href="/" class="btn secondary">캔버스 기본 (30s+60s)</a>
      <a href="/?fast=1" class="btn secondary">캔버스 3초 배속 (?fast=1)</a>
      <a href="/?fast=0" class="btn primary">캔버스 0초 즉시 모드 (?fast=0)</a>
    </div>
  </header>

  <main class="dev-main">
    <!-- 컨트롤 패널 -->
    <section class="control-panel">
      <div class="input-group">
        <label for="text-input">테스트 문장 입력</label>
        <input
          id="text-input"
          type="text"
          bind:value={testText}
          placeholder="테스트할 한글 문장을 입력하세요"
          onkeydown={(e) => e.key === 'Enter' && runAllAnimations()}
        />
      </div>

      <div class="controls-row">
        <div class="slider-group">
          <label for="font-size-slider">폰트 크기: {fontSize}px</label>
          <input
            id="font-size-slider"
            type="range"
            min="18"
            max="42"
            bind:value={fontSize}
          />
        </div>

        <div class="slider-group">
          <label for="speed-slider">KCC 대필 속도: {typingSpeedMs}ms</label>
          <input
            id="speed-slider"
            type="range"
            min="30"
            max="180"
            step="10"
            bind:value={typingSpeedMs}
          />
        </div>

        <button class="btn action-btn" onclick={runAllAnimations}>
          애니메이션 다시 재생
        </button>
      </div>

      <div class="preference-row">
        <span class="pref-label">메인 캔버스 적용 글꼴 선택:</span>
        <button
          class="btn toggle-btn"
          class:active={activeCanvasFont === 'kcc'}
          onclick={() => setCanvasDefaultFont('kcc')}
        >
          KCC방정환체 (기본 적용)
        </button>
        <button
          class="btn toggle-btn"
          class:active={activeCanvasFont === 'nanum'}
          onclick={() => setCanvasDefaultFont('nanum')}
        >
          나눔손글씨 펜체
        </button>
      </div>
    </section>

    <!-- 비교 카드 그리드 -->
    <section class="comparison-grid">
      <!-- KCC방정환체 카드 -->
      <div class="font-card" class:highlighted={activeCanvasFont === 'kcc'}>
        <div class="card-head">
          <div class="badge">추천 폰트</div>
          <h2>KCC방정환체 (WOFF2 1.2MB 로컬 번들)</h2>
          <span class="file-info">apps/web/public/fonts/KCCBangJeonghwan.woff2</span>
        </div>

        <div class="paper-preview">
          <div
            class="rendered-text kcc-font"
            style="font-size: {fontSize}px;"
          >
            {testText.slice(0, kccVisibleLength)}
            {#if isKccAnimating}
              <span class="pen-nib">|</span>
            {/if}
          </div>
        </div>

        <div class="card-footer">
          <p class="status">
            상태: {isKccAnimating ? '손글씨 순차 대필 중...' : '완료 (100% 한글 11,172자 지원)'}
          </p>
          <button class="btn small" onclick={startKccAnimation}>KCC 재생</button>
        </div>
      </div>

      <!-- 나눔손글씨 펜체 카드 -->
      <div class="font-card" class:highlighted={activeCanvasFont === 'nanum'}>
        <div class="card-head">
          <div class="badge gray">기존 번들</div>
          <h2>나눔손글씨 펜체 (tegaki 획순 엔진)</h2>
          <span class="file-info">tegaki/fonts/nanum-pen-script (779자 획순 벡터)</span>
        </div>

        <div class="paper-preview">
          <div
            bind:this={tegakiContainer}
            class="rendered-text nanum-font"
            style="font-size: {fontSize}px;"
          ></div>
        </div>

        <div class="card-footer">
          <p class="status">상태: tegaki 획순 애니메이션 렌더러</p>
          <button class="btn small" onclick={startTegakiAnimation}>tegaki 재생</button>
        </div>
      </div>
    </section>
  </main>
</div>

<style>
  .dev-container {
    width: 100vw;
    height: 100vh;
    overflow-y: auto;
    background: #f4efe9;
    color: #2b2b2b;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    padding: 24px 32px;
  }

  .dev-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #fff;
    padding: 20px 24px;
    border-radius: 10px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    margin-bottom: 24px;
  }

  .title-wrap h1 {
    font-size: 20px;
    font-weight: 700;
  }

  .desc {
    font-size: 13px;
    color: #666;
    margin-top: 4px;
  }

  .nav-links {
    display: flex;
    gap: 10px;
  }

  .btn {
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 13px;
    text-decoration: none;
    cursor: pointer;
    border: 1px solid transparent;
    font-weight: 500;
    transition: all 0.2s;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .btn.primary {
    background: #2b2b2b;
    color: #fff;
  }

  .btn.primary:hover {
    background: #444;
  }

  .btn.secondary {
    background: #fff;
    color: #333;
    border-color: #ddd;
  }

  .btn.secondary:hover {
    background: #f7f7f7;
  }

  .control-panel {
    background: #fff;
    padding: 20px 24px;
    border-radius: 10px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    margin-bottom: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .input-group label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 6px;
    color: #444;
  }

  .input-group input {
    width: 100%;
    padding: 10px 14px;
    border: 1px solid #ccc;
    border-radius: 6px;
    font-size: 15px;
    font-family: inherit;
  }

  .controls-row {
    display: flex;
    align-items: center;
    gap: 24px;
    flex-wrap: wrap;
  }

  .slider-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 180px;
  }

  .slider-group label {
    font-size: 12px;
    font-weight: 500;
    color: #666;
  }

  .action-btn {
    background: #1976d2;
    color: #fff;
    margin-left: auto;
    padding: 10px 20px;
  }

  .action-btn:hover {
    background: #1565c0;
  }

  .preference-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding-top: 12px;
    border-top: 1px solid #eee;
  }

  .pref-label {
    font-size: 13px;
    font-weight: 600;
    color: #444;
  }

  .toggle-btn {
    background: #f0f0f0;
    color: #555;
    border: 1px solid #ddd;
  }

  .toggle-btn.active {
    background: #2e7d32;
    color: #fff;
    border-color: #2e7d32;
  }

  .comparison-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
  }

  .font-card {
    background: #fff;
    border-radius: 10px;
    padding: 20px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    display: flex;
    flex-direction: column;
    border: 2px solid transparent;
  }

  .font-card.highlighted {
    border-color: #2e7d32;
  }

  .card-head {
    margin-bottom: 14px;
  }

  .card-head h2 {
    font-size: 17px;
    font-weight: 700;
    margin: 4px 0;
  }

  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    background: #e8f5e9;
    color: #2e7d32;
  }

  .badge.gray {
    background: #eee;
    color: #666;
  }

  .file-info {
    font-size: 11px;
    color: #888;
    font-family: monospace;
  }

  .paper-preview {
    background: #FAF8F5;
    border: 1px dashed #d5cfc4;
    border-radius: 8px;
    padding: 24px;
    min-height: 200px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    overflow: hidden;
  }

  .rendered-text {
    line-height: 1.5;
    color: #1a1a1a;
    word-break: keep-all;
    text-align: left;
    width: 100%;
  }

  .kcc-font {
    font-family: 'KCCBangJeonghwan', cursive, sans-serif;
  }

  .nanum-font {
    font-family: 'Nanum Pen Script', cursive, sans-serif;
  }

  .pen-nib {
    display: inline-block;
    color: #2e7d32;
    animation: blink 0.5s infinite;
    font-weight: bold;
    margin-left: 2px;
  }

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }

  .card-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid #f0f0f0;
  }

  .status {
    font-size: 12px;
    color: #777;
  }

  .btn.small {
    padding: 4px 10px;
    font-size: 12px;
    background: #f0f0f0;
    color: #333;
  }
</style>
