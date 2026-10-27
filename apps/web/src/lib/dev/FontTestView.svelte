<script lang="ts">
  import { onMount } from 'svelte';
  import { TegakiEngine } from 'tegaki/core';
  import nanumFont from 'tegaki/fonts/nanum-pen-script';

  let testText = $state('가상 DOM 오버헤드가 큰 React 대신 Svelte 5와 Hono로 모노레포를 구성하는 계획 맞나요?');
  let fontSize = $state(32);
  let speedMultiplier = $state(1.0); // 1.0 (자연스러운 쾌속 대필), 0.5 (매우 빠름), 1.5 (여유)

  let tegakiContainer = $state<HTMLDivElement | null>(null);
  let tegakiEngine: TegakiEngine | null = null;
  let isWriting = $state(false);

  function startAnimation() {
    if (!tegakiContainer) return;
    tegakiEngine?.destroy();
    tegakiContainer.innerHTML = '';
    isWriting = true;

    const advancePct = Math.round(45 * speedMultiplier);
    const durationSec = 0.09 * speedMultiplier;

    try {
      tegakiEngine = new TegakiEngine(tegakiContainer, {
        text: testText,
        font: nanumFont,
        timing: {
          glyphGap: 0.02 * speedMultiplier,
          wordGap: 0.04 * speedMultiplier,
          lineGap: 0.06 * speedMultiplier,
          unknownDuration: 0.05 * speedMultiplier,
          stagger: {
            advance: `${advancePct}%`,
            duration: durationSec,
          },
        },
        onComplete: () => {
          isWriting = false;
        },
      });
    } catch {
      if (tegakiContainer) tegakiContainer.textContent = testText;
      isWriting = false;
    }
  }

  onMount(() => {
    startAnimation();

    return () => {
      tegakiEngine?.destroy();
    };
  });
</script>

<div class="dev-container">
  <header class="dev-header">
    <div class="title-wrap">
      <h1>나눔손글씨 펜체 획순 렌더링 테스트 룸</h1>
      <p class="desc">30s+60s 대기 없이 즉시 폰트 크기 및 대필 속도를 실시간 조절·검증하는 전용 라우트입니다.</p>
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
          onkeydown={(e) => e.key === 'Enter' && startAnimation()}
        />
      </div>

      <div class="controls-row">
        <div class="slider-group">
          <label for="font-size-slider">글씨 크기: {fontSize}px (권장: 30-34px)</label>
          <input
            id="font-size-slider"
            type="range"
            min="22"
            max="44"
            bind:value={fontSize}
          />
        </div>

        <div class="slider-group">
          <label for="speed-slider">
            대필 속도: {speedMultiplier === 1.0 ? '쾌속 (약 2.5초)' : speedMultiplier < 1.0 ? '초고속' : '느림'}
          </label>
          <input
            id="speed-slider"
            type="range"
            min="0.5"
            max="2.0"
            step="0.1"
            bind:value={speedMultiplier}
          />
        </div>

        <button class="btn action-btn" onclick={startAnimation}>
          대필 애니메이션 다시 재생
        </button>
      </div>
    </section>

    <!-- 프리뷰 캔버스 카드 -->
    <section class="preview-card">
      <div class="card-head">
        <div class="badge green">실제 적용 글꼴</div>
        <h2>나눔손글씨 펜체 (tegaki 획순 엔진)</h2>
        <span class="file-info">폰트 크기: {fontSize}px · 획순 애니메이션 15배 쾌속 적용</span>
      </div>

      <div class="paper-preview">
        <div
          bind:this={tegakiContainer}
          class="rendered-text"
          style="font-size: {fontSize}px;"
        ></div>
      </div>

      <div class="card-footer">
        <p class="status">
          상태: {isWriting ? '펜 획순으로 문장 대필 중...' : '대필 완료 (동그라미 O 또는 취소선 X 입력 대기)'}
        </p>
        <button class="btn small" onclick={startAnimation}>다시 쓰기</button>
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
    min-width: 220px;
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

  .preview-card {
    background: #fff;
    border-radius: 10px;
    padding: 24px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    display: flex;
    flex-direction: column;
    border: 2px solid #2e7d32;
  }

  .card-head {
    margin-bottom: 14px;
  }

  .card-head h2 {
    font-size: 18px;
    font-weight: 700;
    margin: 4px 0;
  }

  .badge.green {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    background: #e8f5e9;
    color: #2e7d32;
  }

  .file-info {
    font-size: 12px;
    color: #888;
  }

  .paper-preview {
    background: #FAF8F5;
    border: 1px dashed #d5cfc4;
    border-radius: 8px;
    padding: 32px 28px;
    min-height: 220px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .rendered-text {
    font-family: 'Nanum Pen Script', cursive, sans-serif;
    line-height: 1.5;
    color: #1a1a1a;
    word-break: keep-all;
    text-align: left;
    width: 100%;
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
    font-size: 13px;
    color: #666;
  }

  .btn.small {
    padding: 5px 12px;
    font-size: 12px;
    background: #f0f0f0;
    color: #333;
  }
</style>
