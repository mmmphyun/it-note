<script lang="ts">
  import type { InferRequestBody, InferResponseBody } from '@itnote/shared';
  import { requestInference } from '../api/inferClient';

  let rawInput = $state('MongoDB -> PostgreSQL');
  let isLoading = $state(false);
  let errorMsg = $state<string | null>(null);

  // 멀티턴 연속 맥락 상태
  let previousContext = $state<string | null>(null);
  let activeHypothesis = $state<string | null>(null);
  let rejectedHypotheses = $state<string[]>([]);
  let history = $state<Array<{ input: string; response: InferResponseBody; timestamp: string }>>([]);

  const presets = [
    { label: '화살표 비교/전환', text: 'MongoDB -> PostgreSQL' },
    { label: '취소 후 재작성', text: '~~React~~ Svelte 5' },
    { label: '단일 키워드', text: 'Kafka' },
    { label: '다중 키워드 나열', text: 'Docker, Kubernetes, Helm' },
    { label: '맥락 보충 피드백', text: '클라우드 비용 절감' },
  ];

  function applyPreset(text: string) {
    rawInput = text;
  }

  async function handleSend() {
    if (!rawInput.trim() || isLoading) return;

    isLoading = true;
    errorMsg = null;

    const payload: InferRequestBody = {
      rawTextInput: rawInput.trim(),
      previousEvaporatedContext: previousContext,
      activeHypothesisSentence: activeHypothesis,
      rejectedHypotheses: [...rejectedHypotheses],
      userContext: {
        persona: { role: 'DevSecOps 구직자 / 4학년 휴학생' },
        evolvingTopics: ['Cloud Architecture', 'Database Migration'],
      },
    };

    try {
      const res = await requestInference(payload);
      if (!res) {
        errorMsg = '추론 API 응답이 없거나 서버 에러가 발생했습니다. (백엔드 포트 8787 확인)';
        return;
      }

      history = [
        {
          input: rawInput.trim(),
          response: res,
          timestamp: new Date().toLocaleTimeString('ko-KR'),
        },
        ...history,
      ];

      // 다음 턴을 위한 맥락 갱신
      previousContext = res.sentence;
      activeHypothesis = res.sentence;
      rawInput = '';
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
    } finally {
      isLoading = false;
    }
  }

  function handleRejectCurrent() {
    if (activeHypothesis) {
      rejectedHypotheses = [...rejectedHypotheses, activeHypothesis];
      activeHypothesis = null;
    }
  }

  function handleResetContext() {
    previousContext = null;
    activeHypothesis = null;
    rejectedHypotheses = [];
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
    <div class="title-row">
      <h2>잇적(It!note) AI 추론 파이프라인 실시간 개발자 검증기</h2>
      <div class="actions">
        <a href="/" class="btn-link">메인 캔버스</a>
        <a href="/?view=font-test" class="btn-link">획순 튜닝 룸</a>
        <button class="btn-reset" onclick={handleResetContext}>전체 맥락 초기화</button>
      </div>
    </div>
    <p class="desc">
      손글씨 좌표 대신 타이핑으로 단어 관계(화살표 <code>-&gt;</code>, 취소선 <code>~~단어~~</code>)를 입력하여 Gemini의 System 1(Jev 의사결정)과 System 2(단일 문장 생성) 및 재전송 시 맥락 연속성을 실시간 검증합니다.
    </p>
  </header>

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
        placeholder="단어 관계 입력 (예: MongoDB -> PostgreSQL 또는 ~~Redis~~ Memcached)"
        disabled={isLoading}
      />
      <button class="btn-send" onclick={handleSend} disabled={isLoading || !rawInput.trim()}>
        {isLoading ? '추론 중...' : 'Gemini 추론 전송'}
      </button>
    </div>

    <!-- 현재 누적된 맥락 상태 -->
    <div class="context-bar">
      <div class="context-item">
        <span class="k">직전 증발 맥락:</span>
        <span class="v">{previousContext ?? '(없음 - 첫 입력)'}</span>
      </div>
      {#if activeHypothesis}
        <div class="context-item">
          <span class="k">현재 활성 가설:</span>
          <span class="v highlight">{activeHypothesis}</span>
          <button class="btn-reject" onclick={handleRejectCurrent}>X 마킹 (기각 제약 추가)</button>
        </div>
      {/if}
      {#if rejectedHypotheses.length > 0}
        <div class="context-item rejected">
          <span class="k">기각된 오답 목록 (X):</span>
          <span class="v">{rejectedHypotheses.join(' | ')}</span>
        </div>
      {/if}
    </div>

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
          <span class="user-input">입력: <strong>{item.input}</strong></span>
          <span class="time">{item.timestamp}</span>
        </div>

        <div class="sentence-box">
          <span class="sentence-label">System 2 생성 문장:</span>
          <p class="sentence-text">"{item.response.sentence}"</p>
        </div>

        <div class="jev-grid">
          <div class="jev-item">
            <span class="jk">맥락 연속성 (Noul):</span>
            <span class="jv" class:active-bool={item.response.jevDecision.isContinuousWithPrevious.value}>
              {item.response.jevDecision.isContinuousWithPrevious.value ? '연속됨 (True)' : '독립적 (False)'}
              ({(item.response.jevDecision.isContinuousWithPrevious.probability * 100).toFixed(0)}%)
            </span>
          </div>

          <div class="jev-item">
            <span class="jk">입력 분류 (Classification):</span>
            <span class="jv">{item.response.jevDecision.inputClassification?.selected ?? 'NEW_INDEPENDENT_MEMO'}</span>
          </div>

          <div class="jev-item">
            <span class="jk">취소선 의도 (Strikethrough):</span>
            <span class="jv">{item.response.jevDecision.strikethroughIntent.selected}</span>
          </div>

          <div class="jev-item">
            <span class="jk">시각적 구조 (Visual):</span>
            <span class="jv">{item.response.jevDecision.visualStructure.selected}</span>
          </div>

          <div class="jev-item">
            <span class="jk">도메인 분류 (Domain):</span>
            <span class="jv">{item.response.jevDecision.domainRoute.selected}</span>
          </div>

          <div class="jev-item">
            <span class="jk">추출 키워드:</span>
            <span class="jv">
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
</div>

<style>
  .dev-container {
    max-width: 960px;
    margin: 0 auto;
    padding: 32px 24px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #2b2b2b;
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

  .actions {
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

  .title-row h2 {
    margin: 0;
    font-size: 22px;
    color: #1a1a1a;
  }

  .desc {
    margin: 8px 0 0 0;
    font-size: 14px;
    color: #666;
    line-height: 1.5;
  }

  .desc code {
    background: #f1f1f1;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 13px;
  }

  .control-panel {
    background: #fcfbf9;
    border: 1px solid #e5e0d8;
    border-radius: 8px;
    padding: 20px;
    margin-bottom: 32px;
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
    color: #777;
  }

  .btn-preset {
    background: #fff;
    border: 1px solid #d0cbc3;
    padding: 4px 10px;
    border-radius: 14px;
    font-size: 12px;
    cursor: pointer;
    color: #444;
  }

  .btn-preset:hover {
    background: #f0ece6;
  }

  .input-line {
    display: flex;
    gap: 12px;
    margin-bottom: 16px;
  }

  .input-line input {
    flex: 1;
    padding: 12px 16px;
    font-size: 15px;
    border: 1px solid #ccc;
    border-radius: 6px;
    outline: none;
  }

  .input-line input:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
  }

  .btn-send {
    padding: 0 24px;
    background: #2563eb;
    color: #fff;
    border: none;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }

  .btn-send:disabled {
    background: #93c5fd;
    cursor: not-allowed;
  }

  .btn-reset {
    background: #ef4444;
    color: white;
    border: none;
    padding: 6px 14px;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
  }

  .context-bar {
    background: #f4f0eb;
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
    font-weight: 500;
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
    margin-bottom: 12px;
    font-size: 14px;
  }

  .card-header .user-input strong {
    color: #1e40af;
  }

  .card-header .time {
    color: #888;
    font-size: 12px;
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
</style>
