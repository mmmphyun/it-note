<script lang="ts">
  import { onMount } from 'svelte';
  import { TegakiEngine } from 'tegaki/core';
  import nanumFont from 'tegaki/fonts/nanum-pen-script';
  import { createStylusPenPlugin, getTegakiTiming } from '../canvas/stylusPenPlugin';

  let testText = $state('가상 DOM 오버헤드가 큰 React 대신 Svelte 5와 Hono로 모노레포를 구성하는 계획 맞나요?');
  let fontSize = $state(32);
  let speedLevel = $state(4); // 1 ~ 10
  let showPenTip = $state(true);

  let tegakiContainer = $state<HTMLDivElement | null>(null);
  let tegakiEngine: TegakiEngine | null = null;
  let isWriting = $state(false);

  const durationEstimates: Record<number, string> = {
    1: '22.4초 (극저속·획 하나하나 관찰)',
    2: '11.4초 (느림)',
    3: '7.3초 (여유 있는 손글씨)',
    4: '5.1초 (표준 필기 속도 - 기본값)',
    5: '3.3초 (자연스러운 빠른 필기)',
    6: '2.2초 (쾌속)',
    7: '1.4초 (빠름)',
    8: '0.9초 (고속)',
    9: '0.5초 (초고속)',
    10: '0.3초 (순간 대필)',
  };

  function startAnimation() {
    if (!tegakiContainer) return;
    tegakiEngine?.destroy();
    tegakiContainer.innerHTML = '';
    isWriting = true;

    const timing = getTegakiTiming(speedLevel);
    const plugins = showPenTip ? [createStylusPenPlugin(true)] : [];

    try {
      tegakiEngine = new TegakiEngine(tegakiContainer, {
        text: testText,
        font: nanumFont,
        timing,
        plugins,
        onComplete: () => {
          isWriting = false;
        },
      });
    } catch {
      if (tegakiContainer) tegakiContainer.textContent = testText;
      isWriting = false;
    }
  }

  function saveSettings() {
    localStorage.setItem('itnote_writing_speed', String(speedLevel));
    localStorage.setItem('itnote_pen_tip', showPenTip ? 'true' : 'false');
    alert(`메인 캔버스에 [속도 레벨 ${speedLevel}] 및 [펜촉 ${showPenTip ? '표시' : '숨김'}] 설정이 적용되었습니다.`);
  }

  onMount(() => {
    const savedLevel = localStorage.getItem('itnote_writing_speed');
    if (savedLevel) speedLevel = Number(savedLevel);
    const savedPen = localStorage.getItem('itnote_pen_tip');
    if (savedPen !== null) showPenTip = savedPen === 'true';

    startAnimation();

    return () => {
      tegakiEngine?.destroy();
    };
  });
</script>

<div class="dev-container">
  <header class="dev-header">
    <div class="title-wrap">
      <h1>나눔손글씨 펜체 획순 및 펜촉 추적 튜닝 룸</h1>
      <p class="desc">대필 속도(1~10)와 실시간 펜촉(Nib) 오버레이를 실측하며 최적의 필기감을 튜닝합니다.</p>
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
        <!-- 속도 레벨 슬라이더 (1 ~ 10 숫자 명시) -->
        <div class="slider-group speed-slider">
          <label for="speed-slider">
            <span class="label-title">대필 속도 레벨: <strong class="level-num">{speedLevel}</strong> / 10</span>
            <span class="label-sub">{durationEstimates[speedLevel]}</span>
          </label>
          <input
            id="speed-slider"
            type="range"
            min="1"
            max="10"
            step="1"
            bind:value={speedLevel}
            onchange={startAnimation}
          />
        </div>

        <!-- 폰트 크기 슬라이더 -->
        <div class="slider-group">
          <label for="font-size-slider">
            <span class="label-title">글씨 크기: <strong>{fontSize}px</strong></span>
            <span class="label-sub">권장: 30 ~ 34px</span>
          </label>
          <input
            id="font-size-slider"
            type="range"
            min="22"
            max="44"
            bind:value={fontSize}
          />
        </div>

        <!-- 실시간 펜촉 오버레이 체크박스 -->
        <div class="checkbox-group">
          <label class="checkbox-label">
            <input
              type="checkbox"
              bind:checked={showPenTip}
              onchange={startAnimation}
            />
            <span class="chk-text">실시간 스타일러스 펜촉(Nib) 추적 표시</span>
          </label>
        </div>

        <div class="btn-group">
          <button class="btn action-btn" onclick={startAnimation}>
            다시 재생
          </button>
          <button class="btn save-btn" onclick={saveSettings}>
            캔버스에 저장 적용
          </button>
        </div>
      </div>
    </section>

    <!-- 프리뷰 캔버스 카드 -->
    <section class="preview-card">
      <div class="card-head">
        <div class="badge-row">
          <span class="badge green">나눔손글씨 펜체</span>
          <span class="badge blue">속도 레벨 {speedLevel}</span>
          {#if showPenTip}
            <span class="badge gold">펜촉 오버레이 활성</span>
          {/if}
        </div>
        <h2>실시간 대필 렌더링 미리보기</h2>
        <span class="file-info">예상 소요 시간: {durationEstimates[speedLevel]}</span>
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
          상태: {isWriting ? '펜촉이 획을 따라가며 문장 필기 중...' : '대필 완료'}
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

  .speed-slider {
    min-width: 280px;
  }

  .label-title {
    font-size: 13px;
    font-weight: 600;
    color: #2b2b2b;
    display: block;
  }

  .level-num {
    color: #1976d2;
    font-size: 15px;
  }

  .label-sub {
    font-size: 11px;
    color: #777;
    display: block;
  }

  .checkbox-group {
    display: flex;
    align-items: center;
    padding-top: 14px;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    color: #333;
  }

  .checkbox-label input {
    width: 16px;
    height: 16px;
    cursor: pointer;
  }

  .btn-group {
    display: flex;
    gap: 8px;
    margin-left: auto;
  }

  .action-btn {
    background: #1976d2;
    color: #fff;
    padding: 10px 18px;
  }

  .action-btn:hover {
    background: #1565c0;
  }

  .save-btn {
    background: #2e7d32;
    color: #fff;
    padding: 10px 18px;
  }

  .save-btn:hover {
    background: #1b5e20;
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

  .badge-row {
    display: flex;
    gap: 8px;
    margin-bottom: 6px;
  }

  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
  }

  .badge.green {
    background: #e8f5e9;
    color: #2e7d32;
  }

  .badge.blue {
    background: #e3f2fd;
    color: #1565c0;
  }

  .badge.gold {
    background: #fff8e1;
    color: #b78103;
    border: 1px solid #ffe082;
  }

  .card-head h2 {
    font-size: 18px;
    font-weight: 700;
    margin: 4px 0;
  }

  .file-info {
    font-size: 12px;
    color: #888;
  }

  .paper-preview {
    background: #FAF8F5;
    border: 1px dashed #d5cfc4;
    border-radius: 8px;
    padding: 36px 30px;
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
