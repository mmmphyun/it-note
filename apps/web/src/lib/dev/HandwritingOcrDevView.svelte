<script lang="ts">
  import { onMount } from 'svelte';
  import { getStroke } from 'perfect-freehand';
  import type { Stroke, InferRequestBody, InferResponseBody } from '@itnote/shared';
  import { extractCroppedStrokes, type CroppedImageResult } from '../canvas/cropExtractor';
  import { requestInference } from '../api/inferClient';

  // 캔버스 상태
  let canvasEl = $state<HTMLCanvasElement | null>(null);
  let ctx: CanvasRenderingContext2D | null = null;
  let strokes = $state<Stroke[]>([]);
  let currentStroke = $state<Stroke | null>(null);
  let isDrawing = $state(false);

  // 맥락 연쇄 (Context Chaining) 파라미터
  let previousEvaporatedContextInput = $state('국밥');
  let activeHypothesisSentenceInput = $state('');

  // 크롭 및 메타데이터 결과
  let cropResult = $state<CroppedImageResult | null>(null);
  let totalPointsCount = $derived(strokes.reduce((acc, s) => acc + s.points.length, 0));

  // 실시간 추론 상태
  let isInferring = $state(false);
  let inferResponse = $state<InferResponseBody | null>(null);
  let inferDurationMs = $state<number | null>(null);
  let inferError = $state<string | null>(null);

  // 토스트 복사 피드백
  let copyToast = $state<string | null>(null);

  function showToast(msg: string) {
    copyToast = msg;
    setTimeout(() => {
      copyToast = null;
    }, 2500);
  }

  // 최종 전송 페이로드 구성
  let currentPayload = $derived<InferRequestBody | null>(
    cropResult
      ? {
          croppedImageBase64: cropResult.base64,
          strokeMetadata: {
            strokeCount: cropResult.strokeCount,
            bbox: cropResult.bbox,
            canvasSize: [canvasEl?.width ?? 900, canvasEl?.height ?? 500],
          },
          previousEvaporatedContext: previousEvaporatedContextInput.trim() || null,
          activeHypothesisSentence: activeHypothesisSentenceInput.trim() || null,
          userContext: {
            persona: { role: '개발자 / 필기 사용자' },
          },
        }
      : null
  );

  function handleChainContext() {
    if (!inferResponse) return;
    previousEvaporatedContextInput = inferResponse.sentence;
    showToast('추론 결과가 [직전 증발 맥락]으로 주입되었습니다.');
  }

  function handleClearContext() {
    previousEvaporatedContextInput = '';
    activeHypothesisSentenceInput = '';
    showToast('맥락 입력이 초기화되었습니다.');
  }

  function getSvgPathFromStroke(strokePoints: number[][]): string {
    if (strokePoints.length === 0) return '';
    const d = strokePoints.reduce(
      (acc, [x0, y0], i, arr) => {
        const [x1, y1] = arr[(i + 1) % arr.length];
        acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
        return acc;
      },
      ['M', ...strokePoints[0], 'Q']
    );
    d.push('Z');
    return d.join(' ');
  }

  function redrawCanvas() {
    if (!ctx || !canvasEl) return;
    ctx.fillStyle = '#FAF8F5';
    ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);

    ctx.fillStyle = '#1c1917';
    const allStrokes = currentStroke ? [...strokes, currentStroke] : strokes;

    for (const stroke of allStrokes) {
      const outlinePoints = getStroke(
        stroke.points.map((p) => [p.x, p.y, p.pressure ?? 0.5]),
        {
          size: 4.5,
          thinning: 0.45,
          smoothing: 0.55,
          streamline: 0.45,
        }
      );
      const pathData = getSvgPathFromStroke(outlinePoints);
      const path2d = new Path2D(pathData);
      ctx.fill(path2d);
    }

    // 크롭 바운딩 박스 가이드라인 시각화 (보조 점선)
    if (cropResult && strokes.length > 0) {
      const [minX, minY, maxX, maxY] = cropResult.bbox;
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(minX - 10, minY - 10, maxX - minX + 20, maxY - minY + 20);
      ctx.setLineDash([]);
    }
  }

  function handlePointerDown(e: PointerEvent) {
    if (!canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const t = performance.now();
    const pressure = e.pressure > 0 ? e.pressure : 0.5;

    isDrawing = true;
    currentStroke = {
      id: `stroke-${t}`,
      points: [{ x, y, t, pressure }],
      startTime: t,
      endTime: t,
    };
    redrawCanvas();
  }

  function handlePointerMove(e: PointerEvent) {
    if (!isDrawing || !currentStroke || !canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const t = performance.now();
    const pressure = e.pressure > 0 ? e.pressure : 0.5;

    currentStroke.points.push({ x, y, t, pressure });
    currentStroke.endTime = t;
    redrawCanvas();
  }

  function handlePointerUp() {
    if (!isDrawing || !currentStroke) return;
    isDrawing = false;
    strokes = [...strokes, currentStroke];
    currentStroke = null;

    // 획이 완료될 때마다 실시간으로 크롭 이미지 및 메타데이터 자동 추출
    updateCropResult();
    redrawCanvas();
  }

  function updateCropResult() {
    if (strokes.length === 0) {
      cropResult = null;
      return;
    }
    cropResult = extractCroppedStrokes(strokes, 16);
  }

  function handleClear() {
    strokes = [];
    currentStroke = null;
    cropResult = null;
    inferResponse = null;
    inferDurationMs = null;
    inferError = null;
    redrawCanvas();
  }

  async function copyText(content: string, label: string) {
    try {
      await navigator.clipboard.writeText(content);
      showToast(`[${label}] 클립보드에 복사되었습니다.`);
    } catch {
      showToast('복사에 실패했습니다.');
    }
  }

  async function handleSendToGemini() {
    if (!currentPayload || isInferring) return;

    isInferring = true;
    inferError = null;
    inferResponse = null;
    const startTime = performance.now();

    try {
      const res = await requestInference(currentPayload);
      inferDurationMs = Math.round(performance.now() - startTime);

      if (!res) {
        inferError = '서버 응답이 없거나 추론에 실패했습니다. (백엔드 포트 8787 확인)';
        return;
      }
      inferResponse = res;
    } catch (err) {
      inferError = err instanceof Error ? err.message : String(err);
    } finally {
      isInferring = false;
    }
  }

  onMount(() => {
    if (canvasEl) {
      ctx = canvasEl.getContext('2d');
      // DPI 보정
      const dpr = window.devicePixelRatio || 1;
      const width = canvasEl.clientWidth || 900;
      const height = canvasEl.clientHeight || 450;
      canvasEl.width = width * dpr;
      canvasEl.height = height * dpr;
      ctx?.scale(dpr, dpr);
      redrawCanvas();
    }
  });
</script>

<div class="ocr-dev-container">
  <header class="dev-header">
    <div class="title-row">
      <h2>잇적 (It!note) 필기 인식 & 입력 데이터 분석기</h2>
      <div class="nav-links">
        <a href="/" class="btn-link">메인 캔버스</a>
        <a href="/?view=dev" class="btn-link">추론 파이프라인 (?view=dev)</a>
        <a href="/?view=font-test" class="btn-link">획순 튜닝 룸</a>
      </div>
    </div>
    <p class="desc">
      스타일러스 펜이나 마우스로 캔버스에 직접 글씨를 작성하고, <strong>1) 실시간 추출되는 필기 좌표 및 바운딩 박스</strong>, <strong>2) 크롭된 PNG Base64 이미지</strong>, <strong>3) Gemini 백엔드로 전달되는 JSON 페이로드 구조</strong>를 정밀 확인 및 복사합니다.
    </p>
  </header>

  <!-- 1. 스타일러스 드로잉 패드 -->
  <section class="pad-section">
    <!-- 직전 증발 맥락 및 가설 주입 바 -->
    <div class="context-injection-bar">
      <div class="ctx-input-group">
        <label for="prev-ctx">직전 증발 맥락 (Previous Evaporated):</label>
        <input
          id="prev-ctx"
          type="text"
          bind:value={previousEvaporatedContextInput}
          placeholder="예: 국밥, 오늘 점심 메뉴 (비워두면 단독 필기)"
        />
      </div>
      <div class="ctx-input-group">
        <label for="active-hypo">화면 활성 가설 (Active Hypothesis):</label>
        <input
          id="active-hypo"
          type="text"
          bind:value={activeHypothesisSentenceInput}
          placeholder="예: 오늘 점심은 순대국밥 어떠신가요? (비워두면 신규 메모)"
        />
      </div>
      <div class="ctx-btn-group">
        <button class="btn-ctx" onclick={() => (previousEvaporatedContextInput = '국밥')}>샘플: 국밥</button>
        <button class="btn-ctx-clear" onclick={handleClearContext}>맥락 초기화</button>
      </div>
    </div>

    <div class="pad-toolbar">
      <div class="pad-info">
        <span class="badge">손글씨 캔버스</span>
        <span class="sub">마우스 드래그 또는 펜으로 글씨나 기호(<code>-&gt;</code>, <code>취소선</code>, <code>단어 동그라미</code>)를 적어보세요.</span>
      </div>
      <div class="pad-actions">
        <button class="btn-tool" onclick={handleClear} disabled={strokes.length === 0}>전체 지우기</button>
        <button
          class="btn-primary"
          onclick={handleSendToGemini}
          disabled={!cropResult || isInferring}
        >
          {isInferring ? 'Gemini VLM 분석 중...' : 'Gemini 필기 인식 실행'}
        </button>
      </div>
    </div>

    <div class="canvas-wrapper">
      <canvas
        bind:this={canvasEl}
        onpointerdown={handlePointerDown}
        onpointermove={handlePointerMove}
        onpointerup={handlePointerUp}
        onpointerleave={handlePointerUp}
      ></canvas>
    </div>
  </section>

  <!-- 토스트 피드백 -->
  {#if copyToast}
    <div class="toast-banner">{copyToast}</div>
  {/if}

  <!-- 2. 실시간 추출 데이터 분석 (Inspector) -->
  <section class="inspector-grid">
    <!-- 크롭 이미지 미리보기 -->
    <div class="inspector-card crop-card">
      <div class="card-title-row">
        <h3>1. 크롭된 필기 이미지 (In-Memory Base64)</h3>
        {#if cropResult}
          <button class="btn-copy-mini" onclick={() => copyText(cropResult?.base64 ?? '', 'Base64 이미지')}>Base64 복사</button>
        {/if}
      </div>

      <div class="crop-preview-box">
        {#if cropResult}
          <img src={cropResult.base64} alt="Cropped Handwriting" class="crop-img" />
          <div class="crop-meta">
            <span>크기: {Math.round(cropResult.bbox[2] - cropResult.bbox[0])} × {Math.round(cropResult.bbox[3] - cropResult.bbox[1])} px</span>
            <span>용량: {(cropResult.base64.length / 1024).toFixed(1)} KB</span>
          </div>
        {:else}
          <div class="placeholder-box">캔버스에 글씨를 쓰면 필기 영역만 자동 크롭되어 표시됩니다.</div>
        {/if}
      </div>
    </div>

    <!-- 스트로크 메타데이터 요약 -->
    <div class="inspector-card meta-card">
      <div class="card-title-row">
        <h3>2. 필기 스트로크 메타데이터</h3>
      </div>
      <div class="meta-table">
        <div class="meta-row">
          <span class="mk">총 획 수 (Strokes):</span>
          <span class="mv font-bold">{strokes.length} 획</span>
        </div>
        <div class="meta-row">
          <span class="mk">총 좌표 점 개수:</span>
          <span class="mv">{totalPointsCount} 포인트</span>
        </div>
        <div class="meta-row">
          <span class="mk">바운딩 박스 (BBox):</span>
          <span class="mv select-text">
            {#if cropResult}
              [{cropResult.bbox.map((v) => Math.round(v)).join(', ')}]
            {:else}
              (필기 없음)
            {/if}
          </span>
        </div>
        <div class="meta-row">
          <span class="mk">종횡비 (Aspect Ratio):</span>
          <span class="mv">
            {#if cropResult}
              {((cropResult.bbox[2] - cropResult.bbox[0]) / Math.max(1, cropResult.bbox[3] - cropResult.bbox[1])).toFixed(2)} : 1
            {:else}
              -
            {/if}
          </span>
        </div>
        <div class="meta-row">
          <span class="mk">디스크 영구 저장 여부:</span>
          <span class="mv tag-zero">0건 (Zero-Retention 메모리 파기)</span>
        </div>
      </div>
    </div>
  </section>

  <!-- 3. Gemini 백엔드 전송 JSON 페이로드 -->
  <section class="payload-section">
    <div class="card-title-row">
      <h3>3. 백엔드 전송 페이로드 (InferRequestBody JSON)</h3>
      {#if currentPayload}
        <button class="btn-copy" onclick={() => copyText(JSON.stringify(currentPayload, null, 2), 'JSON 페이로드')}>
          JSON 전문 복사
        </button>
      {/if}
    </div>
    <div class="code-viewer select-text">
      {#if currentPayload}
        <pre>{JSON.stringify(currentPayload, null, 2)}</pre>
      {:else}
        <p class="empty-code">캔버스에 필기를 시작하면 백엔드로 전송될 정형화 JSON이 실시간 생성됩니다.</p>
      {/if}
    </div>
  </section>

  <!-- 4. 실시간 Gemini 인식 및 추론 결과 (Live Response) -->
  {#if inferResponse || isInferring || inferError}
    <section class="response-section">
      <div class="card-title-row">
        <h3>4. Gemini 필기 인식 및 추론 결과 {#if inferDurationMs}({inferDurationMs}ms){/if}</h3>
        {#if inferResponse}
          <div class="btn-group-row">
            <button class="btn-ctx-chain" onclick={handleChainContext}>
              이 결과를 [직전 증발 맥락]으로 주입
            </button>
            <button class="btn-copy-mini" onclick={() => copyText(JSON.stringify(inferResponse, null, 2), '추론 결과 JSON')}>
              응답 JSON 복사
            </button>
          </div>
        {/if}
      </div>

      {#if isInferring}
        <div class="loading-box">Gemini가 손글씨 이미지를 판독하고 의사결정 프리미티브를 도출 중입니다...</div>
      {:else if inferError}
        <div class="error-box">{inferError}</div>
      {:else if inferResponse}
        <div class="result-display">
          <div class="sentence-box">
            <span class="s-label">생성된 질문:</span>
            <p class="s-text select-text">"{inferResponse.sentence}"</p>
          </div>

          <div class="res-grid">
            <div class="res-item">
              <span class="rk">인식된 활성 키워드:</span>
              <span class="rv select-text font-bold text-blue">
                [{inferResponse.extractedKeywords.active.join(', ')}]
              </span>
            </div>
            <div class="res-item">
              <span class="rk">인식된 취소 키워드:</span>
              <span class="rv select-text font-bold text-red">
                [{inferResponse.extractedKeywords.struckOut.join(', ')}]
              </span>
            </div>
            <div class="res-item">
              <span class="rk">동그라미 선택 (Chosen):</span>
              <span class="rv select-text font-bold text-purple">
                [{(inferResponse.extractedKeywords.chosen ?? []).join(', ') || '없음'}]
              </span>
            </div>
            <div class="res-item">
              <span class="rk">피드백 의도 (Feedback):</span>
              <span class="rv select-text font-bold text-green">
                {inferResponse.jevDecision.feedbackIntent?.selected ?? 'NONE'}
              </span>
            </div>
            <div class="res-item">
              <span class="rk">판별 도메인 (Domain):</span>
              <span class="rv select-text">{inferResponse.jevDecision.domainRoute.selected}</span>
            </div>
            <div class="res-item">
              <span class="rk">행동 태스크 (Action):</span>
              <span class="rv select-text">{inferResponse.jevDecision.actionTask?.selected ?? 'ITEM_ACCUMULATE'}</span>
            </div>
            <div class="res-item">
              <span class="rk">취소선 의도 (Intent):</span>
              <span class="rv select-text">{inferResponse.jevDecision.strikethroughIntent.selected}</span>
            </div>
            <div class="res-item">
              <span class="rk">시각적 구조 (Structure):</span>
              <span class="rv select-text">{inferResponse.jevDecision.visualStructure.selected}</span>
            </div>
          </div>
        </div>
      {/if}
    </section>
  {/if}
</div>

<style>
  :global(*) {
    user-select: text !important;
    -webkit-user-select: text !important;
  }

  .ocr-dev-container {
    max-width: 1020px;
    margin: 0 auto;
    padding: 32px 24px 80px 24px;
    height: 100vh;
    overflow-y: auto !important;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #2b2b2b;
    box-sizing: border-box;
  }

  .select-text {
    user-select: text !important;
    -webkit-user-select: text !important;
    cursor: text;
  }

  .dev-header {
    margin-bottom: 24px;
    border-bottom: 2px solid #eaeaea;
    padding-bottom: 16px;
  }

  .title-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .title-row h2 {
    margin: 0;
    font-size: 22px;
    color: #1a1a1a;
  }

  .nav-links {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .btn-link {
    text-decoration: none;
    background: #eae6df;
    color: #444;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 12px;
  }

  .btn-link:hover {
    background: #ded9cf;
  }

  .desc {
    margin: 8px 0 0 0;
    font-size: 14px;
    color: #666;
    line-height: 1.5;
  }

  .pad-section {
    background: #fff;
    border: 1px solid #e2ded5;
    border-radius: 8px;
    overflow: hidden;
    margin-bottom: 24px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  }

  .context-injection-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 18px;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
    flex-wrap: wrap;
  }

  .ctx-input-group {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 260px;
  }

  .ctx-input-group label {
    font-size: 12px;
    font-weight: 600;
    color: #475569;
    white-space: nowrap;
  }

  .ctx-input-group input {
    flex: 1;
    padding: 5px 10px;
    border: 1px solid #cbd5e1;
    border-radius: 4px;
    font-size: 13px;
    outline: none;
    background: #fff;
  }

  .ctx-input-group input:focus {
    border-color: #3b82f6;
  }

  .ctx-btn-group {
    display: flex;
    gap: 6px;
  }

  .btn-ctx {
    background: #e2e8f0;
    color: #334155;
    border: none;
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
  }

  .btn-ctx-clear {
    background: #fee2e2;
    color: #b91c1c;
    border: none;
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
  }

  .btn-ctx-chain {
    background: #10b981;
    color: #fff;
    border: none;
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-ctx-chain:hover {
    background: #059669;
  }

  .btn-group-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .text-purple {
    color: #7c3aed;
  }

  .text-green {
    color: #059669;
  }

  .pad-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 18px;
    background: #faf8f5;
    border-bottom: 1px solid #eee8df;
  }

  .pad-info {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .badge {
    background: #3b82f6;
    color: #fff;
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 4px;
    font-weight: 600;
  }

  .sub {
    font-size: 13px;
    color: #666;
  }

  .sub code {
    background: #efebe4;
    padding: 2px 4px;
    border-radius: 3px;
  }

  .pad-actions {
    display: flex;
    gap: 8px;
  }

  .btn-tool {
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    color: #334155;
    padding: 6px 14px;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
  }

  .btn-tool:hover {
    background: #e2e8f0;
  }

  .btn-primary {
    background: #2563eb;
    color: #fff;
    border: none;
    padding: 6px 16px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-primary:disabled {
    background: #93c5fd;
    cursor: not-allowed;
  }

  .canvas-wrapper {
    width: 100%;
    height: 380px;
    background-color: #faf8f5;
    touch-action: none;
  }

  canvas {
    width: 100%;
    height: 100%;
    display: block;
    cursor: crosshair;
  }

  .toast-banner {
    background: #dcfce7;
    color: #166534;
    padding: 8px 14px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 16px;
  }

  .inspector-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 24px;
  }

  .inspector-card {
    background: #fff;
    border: 1px solid #e2ded5;
    border-radius: 8px;
    padding: 16px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  }

  .card-title-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .card-title-row h3 {
    margin: 0;
    font-size: 15px;
    color: #1f2937;
  }

  .btn-copy, .btn-copy-mini {
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    color: #334155;
    border-radius: 4px;
    cursor: pointer;
  }

  .btn-copy {
    padding: 4px 12px;
    font-size: 12px;
    font-weight: 600;
  }

  .btn-copy-mini {
    padding: 2px 8px;
    font-size: 11px;
  }

  .btn-copy:hover, .btn-copy-mini:hover {
    background: #e2e8f0;
  }

  .crop-preview-box {
    min-height: 140px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: #fbf9f6;
    border: 1px dashed #d6d0c4;
    border-radius: 6px;
    padding: 12px;
  }

  .crop-img {
    max-width: 100%;
    max-height: 130px;
    object-fit: contain;
    border: 1px solid #e0dbd1;
    border-radius: 4px;
    background: #faf8f5;
  }

  .crop-meta {
    display: flex;
    gap: 12px;
    margin-top: 8px;
    font-size: 12px;
    color: #666;
  }

  .placeholder-box {
    color: #888;
    font-size: 13px;
    text-align: center;
  }

  .meta-table {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 13px;
  }

  .meta-row {
    display: flex;
    justify-content: space-between;
    padding: 5px 0;
    border-bottom: 1px dotted #e5e0d8;
  }

  .mk {
    color: #666;
  }

  .mv {
    color: #1f2937;
  }

  .font-bold {
    font-weight: 600;
  }

  .tag-zero {
    color: #16a34a;
    font-weight: 600;
    font-size: 12px;
  }

  .payload-section {
    background: #fff;
    border: 1px solid #e2ded5;
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 24px;
  }

  .code-viewer {
    background: #1e293b;
    border-radius: 6px;
    padding: 14px;
    max-height: 280px;
    overflow-y: auto;
  }

  .code-viewer pre {
    margin: 0;
    color: #e2e8f0;
    font-family: 'Consolas', 'Menlo', 'Monaco', monospace;
    font-size: 12px;
    line-height: 1.5;
  }

  .empty-code {
    color: #94a3b8;
    font-size: 13px;
    margin: 0;
  }

  .response-section {
    background: #fff;
    border: 1px solid #e2ded5;
    border-radius: 8px;
    padding: 16px;
  }

  .loading-box {
    padding: 24px;
    text-align: center;
    color: #2563eb;
    font-size: 14px;
  }

  .error-box {
    background: #fee2e2;
    color: #b91c1c;
    padding: 12px;
    border-radius: 6px;
    font-size: 13px;
  }

  .sentence-box {
    background: #f0f9ff;
    border-left: 4px solid #0284c7;
    padding: 12px 16px;
    border-radius: 0 6px 6px 0;
    margin-bottom: 14px;
  }

  .s-label {
    display: block;
    font-size: 11px;
    font-weight: 700;
    color: #0369a1;
    text-transform: uppercase;
    margin-bottom: 4px;
  }

  .s-text {
    margin: 0;
    font-size: 16px;
    color: #0c4a6e;
    font-weight: 600;
  }

  .res-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 8px 16px;
    background: #faf8f5;
    padding: 12px;
    border-radius: 6px;
    font-size: 12px;
  }

  .res-item {
    display: flex;
    justify-content: space-between;
    padding: 4px 0;
    border-bottom: 1px dotted #e5e0d8;
  }

  .rk {
    color: #666;
  }

  .rv {
    font-weight: 600;
    color: #333;
  }

  .text-blue {
    color: #2563eb;
  }

  .text-red {
    color: #dc2626;
  }
</style>
