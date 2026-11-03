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
  if (process.env.NODE_ENV === 'test') {
    return runHeuristicSystem2(params);
  }

  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (geminiApiKey) {
    try {
      return await callGeminiWriter(params, geminiApiKey);
    } catch (err) {
      console.error('[System 2 Writer Error]', err instanceof Error ? err.message : err);
      // Gemini 호출 실패 시 규칙 기반 템플릿으로 안전 폴백
    }
  }

  return runHeuristicSystem2(params);
}

/**
 * Gemini 기반 단일 문장 생성기
 */
async function callGeminiWriter(params: System2Params, apiKey: string): Promise<string> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`;

  const { decision, keywords, request } = params;
  const rejected = request.rejectedHypotheses ?? [];
  const domain = decision.domainRoute.selected;
  const actionTask = decision.actionTask?.selected ?? 'ITEM_ACCUMULATE';

  const negativeConstraintPrompt =
    rejected.length > 0
      ? `\nCRITICAL NEGATIVE CONSTRAINTS (DO NOT SUGGEST OR REPEAT THESE REJECTED IDEAS):\n${rejected.map((r) => `- "${r}"`).join('\n')}\nYou must pivot to a completely different interpretation or perspective.`
      : '';

  const systemInstruction = `You are System 2 of 'It!note', an empathetic AI thinking companion for handwritten stylus notes.
Generate EXACTLY ONE complete, polite Korean inference question (single sentence, ending with '~맞나요?' or '~인가요?').
Do NOT list bullet points or alternatives.
Do NOT output line breaks or markdown blocks.

CRITICAL TONE & INTENT RULES (ZERO TOLERANCE FOR DATABASE EDITING TONE):
1. NEVER ask bureaucratic database/record editing questions like "수정하는 것이 맞나요?", "변경하시겠습니까?", "입력하신 내용이 맞나요?".
2. Infer the REAL-WORLD HUMAN ACTION (what the user actually decided, ordered, chose, or is planning in reality).
3. The core action is determined by the intersection of [Domain: ${domain}] x [ActionTask: ${actionTask}]:
   - SELECTION_PIVOT in ROUTINE_TASK: "A 대신 B로 주문하시려는 건가요?" or "A 대신 B로 결정하신 건가요?"
   - SELECTION_PIVOT in SIDE_PROJECT_SPARK: "A 대신 B를 도입해 개발하시려는 계획인가요?"
   - ALTERNATIVE_COMPARE in ROUTINE_TASK: "점심/메뉴로 A와 B 중 고민하고 계신가요?"
   - ALTERNATIVE_COMPARE in SIDE_PROJECT_SPARK: "아키텍처/도구로 A와 B를 저울질 중이신가요?"
   - PARAM_ADJUST: "가격을 B로 확인하셨나요?" or "일정/포트를 B로 변경하신 건가요?"
   - PIPELINE_FLOW: "A를 거쳐 B로 마이그레이션/전환하려는 단계인가요?"
   - CAUSE_DIAGNOSE: "문제 원인을 A로 보고 점검하시려는 건가요?"
   - RECORD_CONFIRM: "A 일정을 완료하고 기록해 두신 건가요?"

CRITICAL MULTI-PERSONA & TOKEN PRECEDENCE RULES:
1. TOKEN PRECEDENCE OVER REGISTERED PROFILE:
   - The explicit note tokens on screen ALWAYS override the user's primary registered profile.
   - Even if the user is registered as a "Java / Spring Backend Developer":
     - If they write 'React', 'Vue', or 'Tailwind' -> treat as an independent FRONTEND side project. NEVER force it as "Java-connected frontend".
     - If they write 'PyTorch', 'LoRA', 'HuggingFace' -> treat as an independent AI / ML fine-tuning experiment. NEVER force it as "Java-wrapped model".
     - If they write '커피', '원두', '클라이밍', '고양이' -> treat as a pure PERSONAL LIFESTYLE memo. NEVER force work/tech context.
2. ZERO FORCED SUBORDINATION:
   - NEVER subordinate newly explored tools to the user's main job.
   - A backend dev exploring React or AI is conducting a genuine side experiment or learning hobby. Infer that autonomous intent!
3. PERSONAL PREFERENCES INTEGRATION:
   - If user has subInterests (e.g. React, AI) in preferences, reflect their side-project context naturally.
   - If user has lifestyleHabits (e.g. 커피, 운동) in preferences, recognize everyday routines instantly.
   - If thinkingStyle is PRAGMATIC: frame questions around quick prototyping and minimal implementation.
   - If sentenceTone is CONCISE: keep sentence strictly under 25 Korean syllables without fluff.

Context:
- User Raw Input: ${request.rawTextInput ?? 'none'}
- Inferred Domain: ${domain}
- Inferred Action Task: ${actionTask}
- Input Classification: ${decision.inputClassification?.selected ?? 'NEW_INDEPENDENT_MEMO'}
- Feedback Intent: ${decision.feedbackIntent?.selected ?? 'NONE'}
- Strikethrough Intent: ${decision.strikethroughIntent.selected}
- Active Keywords: ${keywords.active.join(', ')}
- Struck-out Keywords: ${keywords.struckOut.join(', ')}
- Chosen (Circled) Keywords: ${keywords.chosen?.join(', ') ?? 'none'}
- Emphasized (Underlined) Keywords: ${keywords.emphasized?.join(', ') ?? 'none'}
- Previous Evaporated Context: ${request.previousEvaporatedContext ?? 'none'}
- Active Hypothesis on Screen: ${request.activeHypothesisSentence ?? 'none'}

Specific Chosen & Feedback Handling:
- CRITICAL MULTI-TURN CONTINUITY RULE:
  If 'isContinuousWithPrevious' is true and 'Previous Evaporated Context' is present (e.g. "국밥"):
  The user is developing a continuous thought from that previous topic.
  You MUST combine the Previous Evaporated Context with the current choice/action into a single coherent sentence.
  Example: Previous context "국밥" + Current choice "순대, (수육)" -> "순대국밥 대신 수육국밥으로 정하신 건가요?" or "국밥에 순대 대신 수육으로 결정하신 건가요?"
  Synthesize compound everyday Korean expressions naturally (e.g. 국밥 + 순대/수육 -> 순대국밥/수육국밥).
  NEVER omit or drop the Previous Evaporated Context when continuity is established!
- If Chosen Keywords exist (e.g. user circled an option among alternatives, such as choosing '수육' from '순대, 수육'):
  Formulate a direct question confirming that specific choice. Mention the alternatives being dropped if any.
- If Feedback Intent is 'CONFIRM_ACCEPT' (user wrote 'yes', '응', 'ㅇㅇ', '맞아'):
  Generate a clear confirmation sentence indicating acceptance of the hypothesis.
- If Feedback Intent is 'REJECT_CANCEL' (user wrote 'no', '아니', 'ㄴㄴ'):
  Pivot completely away from the rejected hypothesis.
${negativeConstraintPrompt}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: systemInstruction }] }],
      generationConfig: {
        maxOutputTokens: 500,
        temperature: 0.3,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });

  if (!res.ok) throw new Error(`Gemini writer failed with status ${res.status}`);

  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error('Empty text from Gemini writer');

  // 개행을 공백으로 합치고 양쪽 따옴표 정리
  return text.replace(/\s+/g, ' ').replace(/^["'`\s]+|["'`\s]+$/g, '');
}

/**
 * 규칙 기반 결정론적 단일 문장 합성기 (Domain x ActionTask 곱연산)
 */
export function runHeuristicSystem2(params: System2Params): string {
  const { decision, keywords, request } = params;
  const rejected = request.rejectedHypotheses ?? [];
  const activeKeywords = keywords.active.length > 0 ? keywords.active : ['Svelte 5', 'Hono'];
  const struckOut = keywords.struckOut;
  const isContinuous = decision.isContinuousWithPrevious.value;
  const prevContext = request.previousEvaporatedContext;
  const inputClass = decision.inputClassification?.selected;
  const feedbackIntent = decision.feedbackIntent?.selected;
  const activeHypothesis = request.activeHypothesisSentence;
  const domain = decision.domainRoute.selected;
  const actionTask = decision.actionTask?.selected ?? 'ITEM_ACCUMULATE';
  const chosen = keywords.chosen ?? [];

  // 0. 동그라미 선택 (Visual Selection) 최우선 반영
  if (chosen.length > 0) {
    const chosenText = chosen.join(', ');
    const otherAlternatives = activeKeywords.filter((k) => !chosen.includes(k));
    const altText = otherAlternatives.length > 0 ? `${otherAlternatives.join(', ')} 대신 ` : '';

    if (isContinuous && prevContext) {
      if (domain === 'ROUTINE_TASK') {
        return `${prevContext}에 ${altText}${chosenText}(으)로 결정하여 주문하시려는 건가요?`;
      }
      return `${prevContext} 흐름에서 ${altText}${chosenText} 방안을 핵심으로 채택하려는 계획 맞나요?`;
    }

    if (domain === 'ROUTINE_TASK') {
      return `${altText}${chosenText}(으)로 최종 결정하여 주문하시려는 건가요?`;
    }
    return `${chosenText} 방안을 핵심으로 채택하여 진행하려는 계획 맞나요?`;
  }

  // 1. AI 문장에 대한 피드백 반응 (FEEDBACK_REPLY & FeedbackIntent)
  if (inputClass === 'FEEDBACK_REPLY' && activeHypothesis) {
    if (feedbackIntent === 'CONFIRM_ACCEPT') {
      return '제시된 가설에 동의하신 내용을 확인하여 확정 노트로 흡수합니다.';
    }
    if (feedbackIntent === 'REJECT_CANCEL') {
      return '이전 가설을 기각하고 다른 방향의 새로운 계획을 구상하시는 건가요?';
    }
    if (activeKeywords.some((k) => k.toLowerCase().includes('redis') || k.toLowerCase().includes('db'))) {
      return '기존 아키텍처 구성에 Redis 캐시 레이어를 우선적으로 추가하려는 보충 피드백 맞나요?';
    }
    return `이전 문장의 맥락에 ${activeKeywords.join(', ')} 피드백을 반영하여 다시 구성하려는 의도인가요?`;
  }

  // 2. 기각(X)된 가설 배제 및 관점 전환
  if (rejected.length > 0) {
    if (rejected.some((r) => r.includes('가상 DOM') || r.includes('모노레포'))) {
      return '모노레포 구조보다는 gitleaks와 CI/CD 보안 파이프라인 자동화에 중점을 둔 구상 맞나요?';
    }
    return '이전 가설을 배제하고 실시간 데이터 동기화 관점에서 아키텍처를 점검하려는 의도인가요?';
  }

  // 3. 취소선 및 선택 변경 (SELECTION_PIVOT / THOUGHT_PIVOT)
  if ((actionTask === 'SELECTION_PIVOT' || decision.strikethroughIntent.selected === 'THOUGHT_PIVOT') && struckOut.length > 0) {
    const fromKw = struckOut.join(', ');
    const toKw = activeKeywords.join(', ');
    if (domain === 'ROUTINE_TASK') {
      return `${fromKw} 대신 ${toKw}(으)로 주문하시려는 건가요?`;
    }
    return `처음엔 ${fromKw}을(를) 고려했으나 ${toKw}(으)로 방향을 선회하려는 계획 맞나요?`;
  }

  // 4. 직전 증발 키워드와의 연속성 (Noul)
  if (isContinuous && prevContext) {
    return `직전에 메모한 "${prevContext}" 흐름에 이어 ${activeKeywords.join('와(과) ')}를 결합하려는 생각 맞나요?`;
  }

  // 5. Domain x ActionTask 곱연산 휴리스틱 매핑
  if (actionTask === 'PARAM_ADJUST') {
    const toKw = activeKeywords.join(', ');
    if (domain === 'ROUTINE_TASK') {
      return `${toKw}(으)로 가격이나 일정을 변경하여 확인하신 건가요?`;
    }
    return `환경 설정을 ${toKw}(으)로 조정하여 적용하려는 의도인가요?`;
  }

  if (actionTask === 'ALTERNATIVE_COMPARE') {
    const items = activeKeywords.join('와(과) ');
    if (domain === 'ROUTINE_TASK') {
      return `오늘 점심이나 메뉴로 ${items} 중에서 고민하고 계신가요?`;
    }
    return `프로젝트 아키텍처로 ${items} 중에서 저울질하고 계신가요?`;
  }

  if (actionTask === 'CAUSE_DIAGNOSE') {
    return `${activeKeywords.join(', ')} 문제의 원인을 파악하고 점검하시려는 가설인가요?`;
  }

  if (actionTask === 'RECORD_CONFIRM') {
    return `${activeKeywords.join(', ')} 일정을 완료하고 기록해 두신 건가요?`;
  }

  // 5. 기본 최선책 문장
  if (activeKeywords.includes('Svelte 5') && activeKeywords.includes('Hono')) {
    return '가상 DOM 오버헤드가 큰 React 대신 프론트엔드와 백엔드를 Svelte 5와 Hono로 통일해 경량 모노레포를 구성한다는 아이디어 맞나요?';
  }

  return `${activeKeywords.join(', ')}(으)로 프로젝트 코어 파이프라인을 구축하려는 계획 맞나요?`;
}
