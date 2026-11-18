<script lang="ts">
  import {
    DEFAULT_REUSE_THRESHOLD,
    type CandidateHypothesisPool,
    type CandidateKey,
    type InferRequestBody,
    type InferResponseBody,
  } from '@itnote/shared';
  import { requestInference, getLastInferError } from '../api/inferClient';

  const CANDIDATE_LABELS: Record<CandidateKey, string> = {
    candidate_project: '핵심 의도·행동 관점',
    candidate_routine: '일상·상황 맥락 관점',
    candidate_pivot: '선택·전환 가설 관점',
    candidate_longterm: '취향·연속 맥락 관점',
    candidate_definition: '세부 조건·내역 관점',
  };

  interface RankedCandidateItem {
    key: CandidateKey;
    label: string;
    sentence: string;
    score: number;
  }

  let rawInput = $state('~~초코라떼~~ 얼그레이 밀크티, ~~4000원~~ 4500원, 굿커피');
  let lastSubmittedInput = $state('');
  let isLoading = $state(false);
  let errorMsg = $state<string | null>(null);
  let copyFeedback = $state<string | null>(null);

  // 기각 시 차순위 재사용 임계치 (개발 테스트 중 실시간 튜닝 가능)
  let reuseThreshold = $state<number>(DEFAULT_REUSE_THRESHOLD);
  let reuseActionLog = $state<string | null>(null);

  // 멀티턴 연속 맥락 및 5-Way 후보 풀 상태
  let previousContext = $state<string | null>(null);
  let activeHypothesis = $state<string | null>(null);
  let activeCandidatePool = $state<CandidateHypothesisPool | null>(null);
  let activeCandidateScores = $state<Record<CandidateKey, number> | null>(null);
  let activeSelectedKey = $state<CandidateKey | null>(null);
  let rejectedHypotheses = $state<string[]>([]);
  let history = $state<Array<{ input: string; response: InferResponseBody; timestamp: string }>>([]);

  // 사용자 페르소나 (개발자가 실시간 수정 가능)
  let personaRole = $state('DevSecOps 구직자 / 4학년 휴학생');
  let evolvingTopicsInput = $state('Cloud Architecture, Database Migration');

  const presets = [
    { label: '카페 취소/변경 (일상)', text: '~~초코라떼~~ 얼그레이 밀크티, ~~4000원~~ 4500원, 굿커피' },
    { label: 'DB 전환 화살표', text: 'MongoDB -> PostgreSQL' },
    { label: '기술 스택 취소 후 재작성', text: '~~React~~ Svelte 5' },
    { label: '단일 키워드', text: 'Kafka' },
    { label: '다중 키워드 나열', text: 'Docker, Kubernetes, Helm' },
    { label: '맥락 보충 피드백', text: '클라우드 비용 절감' },
  ];

  function getSortedCandidates(
    pool?: CandidateHypothesisPool,
    scores?: Record<CandidateKey, number>
  ): RankedCandidateItem[] {
    if (!pool) return [];
    const keys = Object.keys(pool) as CandidateKey[];
    return keys
      .map((key) => ({
        key,
        label: CANDIDATE_LABELS[key] ?? key,
        sentence: pool[key],
        score: scores?.[key] ?? 0,
      }))
      .sort((a, b) => b.score - a.score);
  }

  function applyPreset(text: string) {
    rawInput = text;
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      copyFeedback = `[${label}] 클립보드에 복사되었습니다.`;
      setTimeout(() => {
        copyFeedback = null;
      }, 2500);
    } catch {
      copyFeedback = '복사에 실패했습니다.';
    }
  }

  async function runInferenceWithText(inputText: string, clearInputAfter = true) {
    if (!inputText.trim() || isLoading) return;

    isLoading = true;
    errorMsg = null;

    const topics = evolvingTopicsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const payload: InferRequestBody = {
      rawTextInput: inputText.trim(),
      previousEvaporatedContext: previousContext,
      activeHypothesisSentence: activeHypothesis,
      rejectedHypotheses: [...rejectedHypotheses],
      userContext: {
        persona: { role: personaRole.trim() },
        evolvingTopics: topics,
      },
    };

    try {
      const res = await requestInference(payload);
      if (!res) {
        errorMsg =
          getLastInferError() ||
          '추론 API 응답이 없거나 API 키가 연결되지 않았습니다. (백엔드 및 .env 확인)';
        return;
      }

      lastSubmittedInput = inputText.trim();
      history = [
        {
          input: inputText.trim(),
          response: res,
          timestamp: new Date().toLocaleTimeString('ko-KR'),
        },
        ...history,
      ];

      // 다음 턴을 위한 5-Way 후보 풀 갱신 (미확정 가설은 직전 증발 맥락으로 승격하지 않음)
      activeHypothesis = res.sentence;
      activeCandidatePool = res.candidatePool ?? null;
      activeCandidateScores = res.rerankerResult?.candidateScores ?? null;
      activeSelectedKey = res.rerankerResult?.selectedKey ?? null;
      if (clearInputAfter) {
        rawInput = '';
      }
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
    } finally {
      isLoading = false;
    }
  }

  async function handleSend() {
    reuseActionLog = null;
    rejectedHypotheses = [];
    await runInferenceWithText(rawInput, true);
  }

  function handleConfirmCurrent() {
    if (!activeHypothesis) return;
    previousContext = activeHypothesis;
    reuseActionLog = `[O 마킹 확정] "${activeHypothesis}" 문장을 직전 증발 맥락으로 승격했습니다.`;
    activeHypothesis = null;
    activeCandidatePool = null;
    activeCandidateScores = null;
    activeSelectedKey = null;
    rejectedHypotheses = [];
  }

  async function handleRejectCurrent() {
    if (!activeHypothesis) return;

    const nextRejected = [...rejectedHypotheses, activeHypothesis];
    rejectedHypotheses = nextRejected;

    const remaining = getSortedCandidates(activeCandidatePool ?? undefined, activeCandidateScores ?? undefined).filter(
      (item) => !nextRejected.includes(item.sentence)
    );
    const runnerUp = remaining[0];

    if (runnerUp && runnerUp.score >= reuseThreshold) {
      activeHypothesis = runnerUp.sentence;
      activeSelectedKey = runnerUp.key;
      reuseActionLog = `[0ms 차순위 재사용 발동] "${runnerUp.label}" 점수 ${(runnerUp.score * 100).toFixed(0)}% >= 임계치 ${(reuseThreshold * 100).toFixed(0)}% (서버 재호출 없음)`;
      return;
    }

    const bestRemainingPct = runnerUp ? `${(runnerUp.score * 100).toFixed(0)}%` : '없음';
    reuseActionLog = `[임계치 미달 -> 5-Way 신규 재생성] 최고 잔여 점수(${bestRemainingPct}) < 임계치 ${(reuseThreshold * 100).toFixed(0)}%`;
    activeHypothesis = null;
    activeCandidatePool = null;
    activeCandidateScores = null;
    activeSelectedKey = null;

    if (lastSubmittedInput) {
      await runInferenceWithText(lastSubmittedInput, false);
    }
  }

  function handleResetContext() {
    previousContext = null;
    activeHypothesis = null;
    activeCandidatePool = null;
    activeCandidateScores = null;
    activeSelectedKey = null;
    rejectedHypotheses = [];
    reuseActionLog = null;
    lastSubmittedInput = '';
    history = [];
    rawInput = 'MongoDB -> PostgreSQL';
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }
</script>

<div class="dev-container">
  <header class="dev-header">
    <div class="title-wrap">
      <h1>잇적(It!note) AI 추론 파이프라인 개발자 검증기</h1>
      <p class="desc">
        타이핑으로 단어 관계(화살표 <code>-&gt;</code>, 취소선 <code>~~단어~~</code>, 선택 <code>(선택지)</code>)를 입력하여 Gemini System 1(의사결정)과 System 2(단일 문장) 및 멀티턴 맥락 연속성을 실시간 검증합니다.
      </p>
    </div>
    <div class="nav-links">
      <a href="/?view=font-test" class="btn secondary">획순 튜닝 룸</a>
      <a href="/?view=handwriting" class="btn secondary">필기 인식 분석</a>
      <a href="/?view=dev" class="btn primary">추론 파이프라인</a>
      <a href="/" class="btn secondary">캔버스 기본</a>
      <button class="btn secondary btn-reset" onclick={handleResetContext}>전체 맥락 초기화</button>
    </div>
  </header>

  <main class="dev-main">
    <section class="persona-box">
      <div class="persona-header">
        <span class="persona-title">주입 중인 사용자 맥락 (더미 페르소나 설정)</span>
        <span class="persona-hint">이 설정값에 따라 추론 도메인 및 질문 맥락이 반응합니다.</span>
      </div>
      <div class="persona-fields">
        <label class="p-field">
          <span class="p-label">역할 (Role):</span>
          <input type="text" bind:value={personaRole} placeholder="예: DevSecOps 구직자, 카페 손님, 프론트엔드 개발자" />
        </label>
        <label class="p-field">
          <span class="p-label">관심/진행 주제 (콤마 구분):</span>
          <input type="text" bind:value={evolvingTopicsInput} placeholder="예: Cloud Architecture, Database Migration" />
        </label>
      </div>
    </section>

    <section class="control-panel">
      <div class="presets-row">
        <span class="label">빠른 프리셋:</span>
        {#each presets as p}
          <button class="btn-preset" onclick={() => applyPreset(p.text)}>{p.label}</button>
        {/each}
      </div>

      <div class="input-line">
        <input
          type="text"
          bind:value={rawInput}
          onkeydown={handleKeydown}
          placeholder="단어 관계 입력 (예: ~~초코라떼~~ 얼그레이 밀크티, ~~4000원~~ 4500원, 굿커피)"
          disabled={isLoading}
        />
        <button class="btn btn-send" onclick={handleSend} disabled={isLoading || !rawInput.trim()}>
          {isLoading ? '추론 중...' : 'Gemini 추론 전송'}
        </button>
      </div>

      <!-- X 기각 시 차순위 재사용 임계치 튜닝 슬라이더 -->
      <div class="threshold-bar">
        <label class="threshold-label" for="reuse-threshold-slider">
          기각(X) 시 차순위 재사용 임계치 (<code>reuseThreshold</code>):
        </label>
        <input
          id="reuse-threshold-slider"
          type="range"
          min="0"
          max="1"
          step="0.05"
          bind:value={reuseThreshold}
        />
        <span class="threshold-val">{reuseThreshold.toFixed(2)} ({(reuseThreshold * 100).toFixed(0)}%)</span>
      </div>

      <!-- 현재 누적된 맥락 상태 -->
      <div class="context-bar">
        <div class="context-item">
          <span class="k">직전 증발 맥락:</span>
          <span class="v select-text">{previousContext ?? '(없음 - 첫 입력)'}</span>
        </div>
        {#if activeHypothesis}
          <div class="context-item">
            <span class="k">현재 활성 가설:</span>
            <span class="v highlight select-text">{activeHypothesis}</span>
            {#if activeSelectedKey}
              <span class="active-axis-tag">{CANDIDATE_LABELS[activeSelectedKey]}</span>
            {/if}
            <button class="btn-confirm" onclick={handleConfirmCurrent}>O 마킹 (확정 -&gt; 직전 맥락)</button>
            <button class="btn-reject" onclick={handleRejectCurrent}>X 마킹 (임계치 기반 재사용/재생성)</button>
          </div>
        {/if}
        {#if rejectedHypotheses.length > 0}
          <div class="context-item rejected">
            <span class="k">기각된 오답 목록 (X):</span>
            <span class="v select-text">{rejectedHypotheses.join(' | ')}</span>
          </div>
        {/if}
      </div>

      {#if reuseActionLog}
        <div class="reuse-log-banner">{reuseActionLog}</div>
      {/if}

      {#if copyFeedback}
        <div class="toast-feedback">{copyFeedback}</div>
      {/if}

      {#if errorMsg}
        <div class="error-banner">{errorMsg}</div>
      {/if}
    </section>

  <section class="results-list">
    <h3>추론 히스토리 ({history.length}건)</h3>
    {#if history.length === 0}
      <div class="empty-hint">단어 관계를 입력하고 전송 버튼을 누르면 Gemini 추론 결과가 여기에 표시됩니다.</div>
    {/if}

    {#each history as item}
      <div class="result-card">
        <div class="card-header">
          <span class="user-input select-text">입력: <strong>{item.input}</strong></span>
          <div class="header-right">
            <span class="time">{item.timestamp}</span>
            <button class="btn-copy-sm" onclick={() => copyText(item.response.sentence, '생성 문장')}>문장 복사</button>
            <button class="btn-copy-sm" onclick={() => copyText(JSON.stringify(item.response, null, 2), 'JSON')}>JSON 복사</button>
          </div>
        </div>

        <div class="sentence-box">
          <div class="sentence-top-row">
            <span class="sentence-label">System 1 확정 1문장 ({item.response.rerankerResult?.scoringEngine ?? 'heuristic'})</span>
            <span class="ocr-badge">OCR: {item.response.ocrSource ?? 'raw-text'}</span>
          </div>
          <p class="sentence-text select-text">"{item.response.sentence}"</p>
        </div>

        {#if item.response.candidatePool}
          <div class="candidates-panel">
            <div class="candidates-header">
              <span>System 2 생성 5-Way 후보 &amp; System 1 독립 확률/점수</span>
              <span class="threshold-ref">기준 임계치: {(reuseThreshold * 100).toFixed(0)}% ({reuseThreshold.toFixed(2)})</span>
            </div>
            <div class="candidate-list">
              {#each getSortedCandidates(item.response.candidatePool, item.response.rerankerResult?.candidateScores) as cand}
                {@const isSelected = cand.key === item.response.rerankerResult?.selectedKey}
                {@const isRejected = rejectedHypotheses.includes(cand.sentence)}
                {@const isReusable = !isSelected && !isRejected && cand.score >= reuseThreshold}
                <div class="candidate-row" class:is-winner={isSelected} class:is-rejected={isRejected}>
                  <div class="candidate-meta">
                    <span class="cand-axis">{cand.label}</span>
                    <div class="cand-badges">
                      {#if isSelected}
                        <span class="cand-badge winner">1위 채택</span>
                      {:else if isRejected}
                        <span class="cand-badge rejected">기각됨 (X)</span>
                      {:else if isReusable}
                        <span class="cand-badge reusable">재사용 가능 (&gt;= 임계치)</span>
                      {:else}
                        <span class="cand-badge low">임계치 미달</span>
                      {/if}
                      <span class="cand-score-num">{(cand.score * 100).toFixed(0)}% ({cand.score.toFixed(2)})</span>
                    </div>
                  </div>
                  <div class="score-bar-track">
                    <div
                      class="score-bar-fill"
                      class:fill-winner={isSelected}
                      class:fill-reusable={isReusable}
                      style="width: {Math.round(cand.score * 100)}%"
                    ></div>
                  </div>
                  <p class="cand-sentence select-text">{cand.sentence}</p>
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <div class="jev-grid">
          <div class="jev-item">
            <span class="jk">맥락 연속성 (Noul):</span>
            <span class="jv select-text" class:active-bool={item.response.jevDecision.isContinuousWithPrevious.value}>
              {item.response.jevDecision.isContinuousWithPrevious.value ? '연속됨 (True)' : '독립적 (False)'}
              ({(item.response.jevDecision.isContinuousWithPrevious.probability * 100).toFixed(0)}%)
            </span>
          </div>

          <div class="jev-item">
            <span class="jk">입력 분류 (Classification):</span>
            <span class="jv select-text">{item.response.jevDecision.inputClassification?.selected ?? 'NEW_INDEPENDENT_MEMO'}</span>
          </div>

          <div class="jev-item">
            <span class="jk">취소선 의도 (Strikethrough):</span>
            <span class="jv select-text">{item.response.jevDecision.strikethroughIntent.selected}</span>
          </div>

          <div class="jev-item">
            <span class="jk">시각적 구조 (Visual):</span>
            <span class="jv select-text">{item.response.jevDecision.visualStructure.selected}</span>
          </div>

          <div class="jev-item">
            <span class="jk">도메인 분류 (Domain):</span>
            <span class="jv select-text">{item.response.jevDecision.domainRoute.selected}</span>
          </div>

          <div class="jev-item">
            <span class="jk">행동 태스크 (Action Task):</span>
            <span class="jv select-text highlight">{item.response.jevDecision.actionTask?.selected ?? 'ITEM_ACCUMULATE'}</span>
          </div>

          <div class="jev-item">
            <span class="jk">추출 키워드:</span>
            <span class="jv select-text">
              유효: [{item.response.extractedKeywords.active.join(', ')}]
              {#if item.response.extractedKeywords.struckOut.length > 0}
                / 취소: [{item.response.extractedKeywords.struckOut.join(', ')}]
              {/if}
            </span>
          </div>
        </div>
      </div>
    {/each}
    </section>
  </main>
</div>

<style>
  :global(*) {
    user-select: text !important;
    -webkit-user-select: text !important;
  }

  .select-text {
    user-select: text !important;
    -webkit-user-select: text !important;
    cursor: text;
  }

  .dev-container {
    width: 100vw;
    height: 100vh;
    overflow-y: auto !important;
    background: #f4efe9;
    color: #2b2b2b;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    padding: 24px 32px;
    box-sizing: border-box;
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
    margin: 0;
  }

  .desc {
    font-size: 13px;
    color: #666;
    margin-top: 4px;
    line-height: 1.5;
  }

  .desc code {
    background: #f1f1f1;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 13px;
  }

  .nav-links {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .btn {
    padding: 8px 14px;
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

  .btn-reset {
    background: #fee2e2 !important;
    color: #b91c1c !important;
    border-color: #fca5a5 !important;
  }

  .btn-reset:hover {
    background: #fecaca !important;
  }

  .dev-main {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .persona-box {
    background: #fff;
    border: 1px solid #e0e0e0;
    border-radius: 10px;
    padding: 18px 24px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  }

  .persona-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .persona-title {
    font-size: 13px;
    font-weight: 700;
    color: #334155;
  }

  .persona-hint {
    font-size: 12px;
    color: #888;
  }

  .persona-fields {
    display: flex;
    gap: 16px;
  }

  .p-field {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .p-label {
    font-size: 12px;
    font-weight: 600;
    color: #555;
  }

  .p-field input {
    padding: 8px 12px;
    font-size: 13px;
    border: 1px solid #d1cbbf;
    border-radius: 6px;
    background: #fff;
    outline: none;
  }

  .p-field input:focus {
    border-color: #3b82f6;
  }

  .control-panel {
    background: #fff;
    border: 1px solid #e0e0e0;
    border-radius: 10px;
    padding: 20px 24px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  }

  .presets-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 14px;
    flex-wrap: wrap;
  }

  .presets-row .label {
    font-size: 13px;
    font-weight: 600;
    color: #64748b;
  }

  .btn-preset {
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    padding: 4px 10px;
    border-radius: 14px;
    font-size: 12px;
    cursor: pointer;
    color: #334155;
    transition: all 0.15s;
  }

  .btn-preset:hover {
    background: #e2e8f0;
    border-color: #94a3b8;
  }

  .input-line {
    display: flex;
    gap: 12px;
    margin-bottom: 16px;
  }

  .input-line input {
    flex: 1;
    padding: 10px 14px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 14px;
    outline: none;
  }

  .input-line input:focus {
    border-color: #3b82f6;
  }

  .btn-send {
    background: #2563eb;
    color: #fff;
    border: none;
    padding: 0 20px;
    font-weight: 600;
    border-radius: 6px;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s;
  }

  .btn-send:hover:not(:disabled) {
    background: #1d4ed8;
  }

  .btn-send:disabled {
    background: #93c5fd;
    cursor: not-allowed;
  }

  .context-bar {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 12px 16px;
    font-size: 13px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .context-item {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .context-item .k {
    font-weight: 600;
    color: #666;
    min-width: 130px;
  }

  .context-item .v {
    color: #222;
  }

  .context-item .v.highlight {
    color: #2563eb;
    font-weight: 600;
  }

  .btn-confirm {
    margin-left: 8px;
    padding: 2px 8px;
    background: #16a34a;
    color: white;
    border: none;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
  }

  .btn-reject {
    margin-left: 8px;
    padding: 2px 8px;
    background: #f97316;
    color: white;
    border: none;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
  }

  .context-item.rejected .v {
    color: #dc2626;
  }

  .toast-feedback {
    margin-top: 10px;
    padding: 8px 12px;
    background: #dcfce7;
    color: #166534;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
  }

  .error-banner {
    margin-top: 12px;
    padding: 10px 14px;
    background: #fee2e2;
    color: #b91c1c;
    border-radius: 6px;
    font-size: 13px;
  }

  .results-list h3 {
    font-size: 17px;
    margin-bottom: 16px;
  }

  .empty-hint {
    padding: 32px;
    text-align: center;
    color: #999;
    border: 1px dashed #d5d0c8;
    border-radius: 8px;
    font-size: 14px;
  }

  .result-card {
    background: #fff;
    border: 1px solid #e0dbd3;
    border-radius: 8px;
    padding: 18px;
    margin-bottom: 16px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
    font-size: 14px;
  }

  .card-header .user-input strong {
    color: #1e40af;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .card-header .time {
    color: #888;
    font-size: 12px;
  }

  .btn-copy-sm {
    padding: 3px 8px;
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    border-radius: 4px;
    font-size: 11px;
    color: #334155;
    cursor: pointer;
  }

  .btn-copy-sm:hover {
    background: #e2e8f0;
  }

  .sentence-box {
    background: #f8fafc;
    border-left: 4px solid #3b82f6;
    padding: 12px 16px;
    border-radius: 0 6px 6px 0;
    margin-bottom: 14px;
  }

  .sentence-label {
    display: block;
    font-size: 11px;
    font-weight: 700;
    color: #64748b;
    text-transform: uppercase;
    margin-bottom: 4px;
  }

  .sentence-text {
    margin: 0;
    font-size: 16px;
    color: #0f172a;
    font-weight: 600;
    line-height: 1.4;
  }

  .jev-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 8px 16px;
    background: #faf8f5;
    padding: 12px;
    border-radius: 6px;
    font-size: 12px;
  }

  .jev-item {
    display: flex;
    justify-content: space-between;
    padding: 4px 0;
    border-bottom: 1px dotted #e5e0d8;
  }

  .jev-item .jk {
    color: #666;
  }

  .jev-item .jv {
    font-weight: 600;
    color: #333;
  }

  .jv.active-bool {
    color: #16a34a;
  }

  .threshold-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    background: #f0f9ff;
    border: 1px solid #bae6fd;
    border-radius: 6px;
    margin-bottom: 12px;
    font-size: 13px;
  }

  .threshold-label {
    font-weight: 600;
    color: #0369a1;
    white-space: nowrap;
  }

  .threshold-bar input[type="range"] {
    flex: 1;
    max-width: 260px;
    cursor: pointer;
  }

  .threshold-val {
    font-weight: 700;
    color: #0c4a6e;
    min-width: 96px;
  }

  .active-axis-tag {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 4px;
    background: #dbeafe;
    color: #1e40af;
  }

  .reuse-log-banner {
    margin-top: 10px;
    padding: 9px 14px;
    background: #fefce8;
    border: 1px solid #fde047;
    color: #854d0e;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
  }

  .sentence-top-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }

  .ocr-badge {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 10px;
    background: #e2e8f0;
    color: #334155;
  }

  .candidates-panel {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 12px 14px;
    margin-bottom: 14px;
  }

  .candidates-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
    font-weight: 700;
    color: #334155;
    margin-bottom: 10px;
  }

  .threshold-ref {
    font-weight: 600;
    color: #0369a1;
  }

  .candidate-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .candidate-row {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 8px 12px;
  }

  .candidate-row.is-winner {
    border-color: #3b82f6;
    background: #eff6ff;
  }

  .candidate-row.is-rejected {
    opacity: 0.65;
    background: #fef2f2;
    border-color: #fecaca;
  }

  .candidate-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 5px;
    font-size: 12px;
  }

  .cand-axis {
    font-weight: 700;
    color: #1e293b;
  }

  .cand-badges {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .cand-badge {
    font-size: 11px;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 4px;
  }

  .cand-badge.winner {
    background: #2563eb;
    color: #fff;
  }

  .cand-badge.rejected {
    background: #ef4444;
    color: #fff;
  }

  .cand-badge.reusable {
    background: #dcfce7;
    color: #166534;
  }

  .cand-badge.low {
    background: #f1f5f9;
    color: #64748b;
  }

  .cand-score-num {
    font-weight: 700;
    color: #0f172a;
    min-width: 76px;
    text-align: right;
  }

  .score-bar-track {
    width: 100%;
    height: 6px;
    background: #e2e8f0;
    border-radius: 999px;
    overflow: hidden;
    margin-bottom: 6px;
  }

  .score-bar-fill {
    height: 100%;
    background: #94a3b8;
    border-radius: 999px;
    transition: width 0.2s ease;
  }

  .score-bar-fill.fill-winner {
    background: #2563eb;
  }

  .score-bar-fill.fill-reusable {
    background: #16a34a;
  }

  .cand-sentence {
    margin: 0;
    font-size: 13px;
    color: #334155;
    line-height: 1.4;
  }
</style>
