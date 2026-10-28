import type {
  JevDecision,
  ExtractedKeywords,
  InferRequestBody,
} from '@itnote/shared';

// ponytail: single hypothesis synthesizer with strict negative constraints

export interface System2Params {
  decision: JevDecision;
  keywords: ExtractedKeywords;
  request: InferRequestBody;
}

/**
 * System 2: 단일 최선책 문장 생성기
 * - 여러 보기 나열 금지, 단 1개의 완결된 추론 문장만 생성
 * - rejectedHypotheses (X 마킹 오답) 목록을 금지 제약(Negative Constraint)으로 강제 주입
 */
export async function runSystem2Writer(params: System2Params): Promise<string> {
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (geminiApiKey) {
    try {
      return await callGeminiWriter(params, geminiApiKey);
    } catch {
      // Gemini 호출 실패 시 규칙 기반 템플릿으로 안전 폴백
    }
  }

  return runHeuristicSystem2(params);
}

/**
 * Gemini 기반 단일 문장 생성기
 */
async function callGeminiWriter(params: System2Params, apiKey: string): Promise<string> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;

  const { decision, keywords, request } = params;
  const rejected = request.rejectedHypotheses ?? [];

  const negativeConstraintPrompt =
    rejected.length > 0
      ? `\nCRITICAL NEGATIVE CONSTRAINTS (DO NOT SUGGEST OR REPEAT THESE REJECTED IDEAS):\n${rejected.map((r) => `- "${r}"`).join('\n')}\nYou must pivot to a completely different interpretation or perspective.`
      : '';

  const systemInstruction = `You are System 2 of 'It!note'.
Generate EXACTLY ONE complete, polite Korean inference question (single sentence, ending with '~맞나요?' or '~인가요?').
Do NOT list bullet points or alternatives.

Context:
- Decision Domain: ${decision.domainRoute.selected}
- Input Classification: ${decision.inputClassification?.selected ?? 'NEW_INDEPENDENT_MEMO'}
- Strikethrough Intent: ${decision.strikethroughIntent.selected}
- Active Keywords: ${keywords.active.join(', ')}
- Struck-out Keywords: ${keywords.struckOut.join(', ')}
- Previous Evaporated Context: ${request.previousEvaporatedContext ?? 'none'}
- Active Hypothesis on Screen: ${request.activeHypothesisSentence ?? 'none'}
${negativeConstraintPrompt}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: systemInstruction }] }],
      generationConfig: {
        maxOutputTokens: 120,
        temperature: 0.4,
      },
    }),
  });

  if (!res.ok) throw new Error(`Gemini writer failed with status ${res.status}`);

  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error('Empty text from Gemini writer');

  // 첫 번째 줄 또는 단일 문장만 발췌
  return text.split('\n')[0].replace(/^["'\s]+|["'\s]+$/g, '');
}

/**
 * 규칙 기반 결정론적 단일 문장 합성기
 */
export function runHeuristicSystem2(params: System2Params): string {
  const { decision, keywords, request } = params;
  const rejected = request.rejectedHypotheses ?? [];
  const activeKeywords = keywords.active.length > 0 ? keywords.active : ['Svelte 5', 'Hono'];
  const struckOut = keywords.struckOut;
  const isContinuous = decision.isContinuousWithPrevious.value;
  const prevContext = request.previousEvaporatedContext;
  const inputClass = decision.inputClassification?.selected;
  const activeHypothesis = request.activeHypothesisSentence;

  // 1. AI 문장에 대한 답장/보충 설명 (FEEDBACK_REPLY)
  if (inputClass === 'FEEDBACK_REPLY' && activeHypothesis) {
    if (activeKeywords.some((k) => k.toLowerCase().includes('redis') || k.toLowerCase().includes('db'))) {
      return '기존 아키텍처 구성에 Redis 캐시 레이어를 우선적으로 추가하려는 보충 피드백 맞나요?';
    }
    return `이전 문장의 맥락에 ${activeKeywords.join(', ')} 피드백을 반영하여 다시 구성하려는 의도인가요?`;
  }

  // 2. 취소선 의도 (THOUGHT_PIVOT) 반영
  if (decision.strikethroughIntent.selected === 'THOUGHT_PIVOT' && struckOut.length > 0) {
    const fromKeyword = struckOut[0];
    const toKeyword = activeKeywords[0] || '대체 기술';
    return `처음엔 ${fromKeyword}을(를) 고려했으나 ${toKeyword}(으)로 방향을 선회하려는 계획 맞나요?`;
  }

  // 3. 기각(X)된 가설 배제 및 관점 전환
  if (rejected.length > 0) {
    // 이전 가설과 다른 관점 채택 (예: 기술 스택 대신 보안/배포 또는 실무 관점)
    if (rejected.some((r) => r.includes('가상 DOM') || r.includes('모노레포'))) {
      return '모노레포 구조보다는 gitleaks와 CI/CD 보안 파이프라인 자동화에 중점을 둔 구상 맞나요?';
    }
    return '이전 가설을 배제하고 실시간 데이터 동기화 관점에서 아키텍처를 점검하려는 의도인가요?';
  }

  // 4. 직전 증발 키워드와의 연속성 (Noul)
  if (isContinuous && prevContext) {
    return `직전에 메모한 "${prevContext}" 흐름에 이어 ${activeKeywords.join('와(과) ')}를 결합하려는 생각 맞나요?`;
  }

  // 5. 기본 최선책 문장
  if (activeKeywords.includes('Svelte 5') && activeKeywords.includes('Hono')) {
    return '가상 DOM 오버헤드가 큰 React 대신 프론트엔드와 백엔드를 Svelte 5와 Hono로 통일해 경량 모노레포를 구성한다는 아이디어 맞나요?';
  }

  return `${activeKeywords.join(', ')}(으)로 프로젝트 코어 파이프라인을 구축하려는 계획 맞나요?`;
}
