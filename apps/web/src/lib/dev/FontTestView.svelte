<script lang="ts">
  import { onMount } from 'svelte';
  import { TegakiEngine } from 'tegaki/core';
  import nanumFont from 'tegaki/fonts/nanum-pen-script';
  import { getTegakiTiming, createAirGlidePlugin } from '../canvas/stylusPenPlugin';
  import { formatHandwrittenSentence, generateRandomTilt } from '../canvas/canvasLifecycle';

  interface WordBBox {
    index: number;
    word: string;
    lineIndex: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }

  let testText = $state('가상 DOM 오버헤드가 큰 React 대신 Svelte 5와 Hono로 모노레포를 구성하는 계획 맞나요?');
  let fontSize = $state(32);
  let speedLevel = $state(4); // 1 ~ 10
  let showPenTip = $state(true);
  let useOrganicBreak = $state(true); // 유기적 어절 줄바꿈 여부
  let showWordBoxes = $state(true); // 단어별 렌더링 박스 시각화
  let selectedWordIdx = $state<number | null>(null);
  let wordBoxes = $state<WordBBox[]>([]);
  let tiltDeg = $state(-0.8); // 손글씨 미세 회전

  let tegakiContainer = $state<HTMLDivElement | null>(null);
  let penEl = $state<HTMLDivElement | null>(null);
  let tegakiEngine: TegakiEngine | null = null;
  let isWriting = $state(false);

  function measureWordBoxesFromDom() {
    if (!tegakiContainer) return;
    const overlayEl = tegakiContainer.querySelector<HTMLElement>('[data-tegaki="overlay"]');
    if (!overlayEl) return;

    // text-stage의 회전을 일시 해제하여 순수 로컬 직교 좌표계로 정밀 측정
    const stageEl = tegakiContainer.closest<HTMLElement>('.text-stage');
    const originalTransform = stageEl?.style.transform ?? '';
    if (stageEl) {
      stageEl.style.transform = 'none';
    }

    const containerRect = tegakiContainer.getBoundingClientRect();
    const textNode = overlayEl.firstChild;
    const boxes: WordBBox[] = [];

    if (textNode && textNode.nodeType === Node.TEXT_NODE) {
      const fullText = textNode.textContent ?? '';
      const regex = /\S+/g;
      let match: RegExpExecArray | null;
      let index = 0;

      while ((match = regex.exec(fullText)) !== null) {
        const word = match[0];
        const start = match.index;
        const end = start + word.length;

        const range = document.createRange();
        range.setStart(textNode, start);
        range.setEnd(textNode, end);
        const rect = range.getBoundingClientRect();

        const preceding = fullText.slice(0, start);
        const lineIndex = (preceding.match(/\n/g) || []).length;

        // containerRect 기준 순수 로컬 픽셀
        boxes.push({
          index: index++,
          word,
          lineIndex,
          x: Math.round(rect.left - containerRect.left),
          y: Math.round(rect.top - containerRect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }
    }

    // 원래 회전 transform 복원
    if (stageEl) {
      stageEl.style.transform = originalTransform;
    }

    if (boxes.length > 0) {
      wordBoxes = boxes;
    }
  }

  function updateWordBoxes() {
    // 1차 DOM 실측 시도 (Tegaki overlay 렌더링된 요소 직접 측정)
    measureWordBoxesFromDom();

    // DOM 노드가 아직 안 잡힌 경우의 타이밍 비동기 재실측
    requestAnimationFrame(() => {
      measureWordBoxesFromDom();
    });
    setTimeout(() => {
      measureWordBoxesFromDom();
    }, 50);
  }

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

    if (penEl) {
      penEl.style.display = 'none';
      penEl.classList.remove('airborne');
    }

    tiltDeg = generateRandomTilt();
    const processedText = useOrganicBreak ? formatHandwrittenSentence(testText) : testText;
    updateWordBoxes();
    const timing = getTegakiTiming(speedLevel);

    // 공중 곡선 보간(Air Glide) 플러그인 (Direct GPU 조작)
    const airGlidePlugin = createAirGlidePlugin({
      speedLevel,
      onPosition: (pos) => {
        if (!showPenTip || !penEl) return;
        penEl.style.display = 'block';
        penEl.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
        if (pos.isAirborne) {
          penEl.classList.add('airborne');
        } else {
          penEl.classList.remove('airborne');
        }
      },
    });

    try {
      tegakiEngine = new TegakiEngine(tegakiContainer, {
        text: processedText,
        font: nanumFont,
        timing,
        plugins: [airGlidePlugin],
        onComplete: () => {
          isWriting = false;
          if (penEl) penEl.style.display = 'none';
          updateWordBoxes();
        },
      });
      // 엔진 생성 직후 텍스트 오버레이 노드가 생성되었으므로 즉시 실측
      updateWordBoxes();
    } catch {
      if (tegakiContainer) tegakiContainer.textContent = processedText;
      isWriting = false;
      if (penEl) penEl.style.display = 'none';
      updateWordBoxes();
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
      if (penEl) penEl.style.display = 'none';
    };
  });
</script>

<div class="dev-container">
  <header class="dev-header">
    <div class="title-wrap">
      <h1>나눔손글씨 펜체 획순 및 펜촉 추적 튜닝 룸</h1>
      <p class="desc">대필 속도(1~10)와 잘림 없는 스타일러스 볼펜 오버레이를 실측하며 최적의 필기감을 튜닝합니다.</p>
    </div>
    <div class="nav-links">
      <a href="/?view=font-test" class="btn primary">획순 튜닝 룸</a>
      <a href="/?view=handwriting" class="btn secondary">필기 인식 분석</a>
      <a href="/?view=dev" class="btn secondary">추론 파이프라인</a>
      <a href="/" class="btn secondary">캔버스 기본</a>
      <a href="/?fast=0" class="btn secondary">즉시 모드 (?fast=0)</a>
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

        <!-- 실시간 펜촉 오버레이 및 손글씨 줄바꿈 체크박스 -->
        <div class="checkbox-group">
          <label class="checkbox-label">
            <input
              type="checkbox"
              bind:checked={showPenTip}
              onchange={startAnimation}
            />
            <span class="chk-text">실시간 스타일러스 볼펜 추적 표시</span>
          </label>
        </div>

        <div class="checkbox-group">
          <label class="checkbox-label">
            <input
              type="checkbox"
              bind:checked={useOrganicBreak}
              onchange={startAnimation}
            />
            <span class="chk-text">유기적 어절 줄바꿈 및 미세 기울기 ({tiltDeg}°) 적용</span>
          </label>
        </div>

        <div class="checkbox-group">
          <label class="checkbox-label">
            <input
              type="checkbox"
              bind:checked={showWordBoxes}
            />
            <span class="chk-text highlight-chk">단어별 렌더링 박스 (Bbox) 시각화</span>
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
            <span class="badge gray">다크 메탈 볼펜 오버레이</span>
          {/if}
        </div>
        <h2>실시간 대필 렌더링 미리보기</h2>
        <span class="file-info">예상 소요 시간: {durationEstimates[speedLevel]}</span>
      </div>

      <div class="paper-preview">
        <div class="text-stage" style="transform: rotate({tiltDeg}deg); transform-origin: top left;">
          <div
            bind:this={tegakiContainer}
            class="rendered-text"
            style="font-size: {fontSize}px;"
          ></div>

          {#if showWordBoxes}
            <div class="word-boxes-overlay">
              {#each wordBoxes as box}
                <div
                  class="word-bbox"
                  class:selected={selectedWordIdx === box.index}
                  style="
                    left: {box.x}px;
                    top: {box.y}px;
                    width: {box.width}px;
                    height: {box.height}px;
                  "
                  role="button"
                  tabindex="0"
                  onclick={() => (selectedWordIdx = selectedWordIdx === box.index ? null : box.index)}
                  onkeydown={(e) => e.key === 'Enter' && (selectedWordIdx = selectedWordIdx === box.index ? null : box.index)}
                  title="클릭하여 첨삭 교정 타깃 지정 (X: {box.x}, Y: {box.y}, W: {box.width}, H: {box.height})"
                >
                  <span class="word-badge">#{box.index}</span>
                  <div class="word-underline-preview"></div>
                </div>
              {/each}
            </div>
          {/if}

          <div
            bind:this={penEl}
            class="stylus-pen-cursor"
            style="display: none;"
          >
            <svg class="pen-svg" width="38" height="38" viewBox="0 0 38 38" fill="none">
              <path d="M3 35 L6 27 L11 32 Z" fill="#1e1e1e" />
              <path d="M6 27 L11 32 L31 12 L26 7 Z" fill="url(#test-ballpen-body)" />
              <path d="M26 7 L31 12 L35 8 L30 4 Z" fill="#9e9e9e" />
              <defs>
                <linearGradient id="test-ballpen-body" x1="6" y1="27" x2="31" y2="12" gradientUnits="userSpaceOnUse">
                  <stop stop-color="#2c3038" />
                  <stop offset="0.5" stop-color="#474e5c" />
                  <stop offset="1" stop-color="#1e2126" />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </div>
      </div>

      <div class="card-footer">
        <p class="status">
          상태: {isWriting ? '볼펜이 획을 따라가며 문장 필기 중...' : '대필 완료'}
        </p>
        <button class="btn small" onclick={startAnimation}>다시 쓰기</button>
      </div>
    </section>

    <!-- 단어별 렌더링 바운딩 박스 Inspector 표 -->
    <section class="inspector-card">
      <div class="inspector-header">
        <div class="title-with-badge">
          <h3>단어별 렌더링 박스 (Bbox) 메트릭 및 첨삭 교정 실측표</h3>
          <span class="count-badge">{wordBoxes.length}개 어절</span>
        </div>
        <p class="inspector-desc">
          AI 문장 위 특정 단어에 펜으로 밑줄을 긋거나 돼지꼬리를 뺐을 때, 클라이언트와 백엔드가 교정 대상 단어를 국소 치환하기 위한 기준 앵커 좌표입니다.
        </p>
      </div>

      {#if wordBoxes.length > 0}
        <div class="table-scroll">
          <table class="bbox-table">
            <thead>
              <tr>
                <th>순번</th>
                <th>어절 텍스트</th>
                <th>행 번호</th>
                <th>X 상대좌표</th>
                <th>Y 상대좌표</th>
                <th>박스 너비</th>
                <th>박스 높이</th>
                <th>밑줄/첨삭 타깃 영역 [minX, minY, maxX, maxY]</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {#each wordBoxes as box}
                <tr
                  class:highlight-row={selectedWordIdx === box.index}
                  onclick={() => (selectedWordIdx = selectedWordIdx === box.index ? null : box.index)}
                >
                  <td class="col-num">#{box.index}</td>
                  <td class="col-word"><strong>{box.word}</strong></td>
                  <td class="col-center">Line {box.lineIndex + 1}</td>
                  <td class="col-code">{box.x}px</td>
                  <td class="col-code">{box.y}px</td>
                  <td class="col-code">{box.width}px</td>
                  <td class="col-code">{box.height}px</td>
                  <td class="col-code range-text">
                    [{box.x}, {box.y}, {box.x + box.width}, {box.y + box.height}]
                  </td>
                  <td class="col-center">
                    {#if selectedWordIdx === box.index}
                      <span class="tag-active">첨삭 타깃 지정됨</span>
                    {:else}
                      <span class="tag-idle">대기</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <p class="empty-text">측정된 어절 데이터가 없습니다. 문장을 입력하고 재생하십시오.</p>
      {/if}
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

  .badge.gray {
    background: #eee;
    color: #555;
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
    overflow: visible;
  }

  .text-stage {
    position: relative;
    width: 100%;
    overflow: visible;
  }

  .rendered-text {
    font-family: 'Nanum Pen Script', cursive, sans-serif;
    line-height: 1.55;
    color: #1a1a1a;
    word-break: keep-all;
    white-space: pre-line;
    text-align: left;
    width: 100%;
    overflow: visible;
  }

  .stylus-pen-cursor {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    z-index: 50;
    margin-left: -3px;
    margin-top: -35px;
    will-change: transform;
    opacity: 0.88;
    filter: drop-shadow(1px 2px 2px rgba(0, 0, 0, 0.12)) blur(0.2px);
    transition: filter 0.1s ease, opacity 0.15s ease;
  }

  :global(.stylus-pen-cursor.airborne) {
    opacity: 0.78;
    filter: drop-shadow(2px 5px 4px rgba(0, 0, 0, 0.16)) blur(0.4px);
  }

  .pen-svg {
    display: block;
    overflow: visible;
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

  .highlight-chk {
    font-weight: 700;
    color: #4338ca;
  }

  /* 단어별 렌더링 박스 오버레이 */
  .word-boxes-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 10;
  }

  .word-bbox {
    position: absolute;
    pointer-events: auto;
    border: 1.5px dashed rgba(79, 70, 229, 0.6);
    background: rgba(79, 70, 229, 0.06);
    border-radius: 4px;
    cursor: pointer;
    box-sizing: border-box;
    transition: all 0.15s ease;
  }

  .word-bbox:hover {
    border: 1.5px solid #4338ca;
    background: rgba(79, 70, 229, 0.14);
    box-shadow: 0 2px 6px rgba(79, 70, 229, 0.2);
  }

  .word-bbox.selected {
    border: 2px solid #dc2626 !important;
    background: rgba(220, 38, 38, 0.15) !important;
    box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.25);
  }

  .word-badge {
    position: absolute;
    top: -16px;
    left: -1px;
    background: #4338ca;
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    padding: 1px 4px;
    border-radius: 3px;
    font-family: -apple-system, sans-serif;
    line-height: 1.2;
    white-space: nowrap;
  }

  .word-bbox.selected .word-badge {
    background: #dc2626;
  }

  .word-underline-preview {
    position: absolute;
    bottom: 2px;
    left: 0;
    width: 100%;
    height: 2px;
    background: rgba(79, 70, 229, 0.35);
  }

  .word-bbox.selected .word-underline-preview {
    height: 3px;
    background: #dc2626;
  }

  /* 바운딩 박스 Inspector 표 */
  .inspector-card {
    margin-top: 24px;
    background: #fff;
    border-radius: 10px;
    padding: 24px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    border: 1px solid #e0e0e0;
  }

  .inspector-header {
    margin-bottom: 16px;
  }

  .title-with-badge {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .title-with-badge h3 {
    font-size: 16px;
    font-weight: 700;
    margin: 0;
  }

  .count-badge {
    background: #eef2ff;
    color: #4338ca;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 700;
  }

  .inspector-desc {
    font-size: 12px;
    color: #666;
    margin-top: 6px;
    line-height: 1.5;
  }

  .table-scroll {
    overflow-x: auto;
  }

  .bbox-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    text-align: left;
  }

  .bbox-table th {
    background: #f8fafc;
    color: #475569;
    padding: 8px 12px;
    border-bottom: 2px solid #e2e8f0;
    font-weight: 600;
    white-space: nowrap;
  }

  .bbox-table td {
    padding: 8px 12px;
    border-bottom: 1px solid #f1f5f9;
  }

  .bbox-table tr:hover {
    background: #f8fafc;
    cursor: pointer;
  }

  .highlight-row {
    background: #fef2f2 !important;
  }

  .col-num {
    font-weight: 700;
    color: #4338ca;
    width: 45px;
  }

  .col-word {
    font-size: 13px;
    color: #0f172a;
  }

  .col-center {
    text-align: center;
    white-space: nowrap;
  }

  .col-code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #334155;
  }

  .range-text {
    font-weight: 600;
    color: #0284c7;
  }

  .tag-active {
    display: inline-block;
    background: #fee2e2;
    color: #b91c1c;
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: 700;
    font-size: 11px;
  }

  .tag-idle {
    display: inline-block;
    background: #f1f5f9;
    color: #64748b;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 11px;
  }

  .empty-text {
    color: #888;
    font-size: 13px;
    padding: 16px 0;
    text-align: center;
  }
</style>
