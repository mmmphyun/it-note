import type {
  JevDecision,
  ExtractedKeywords,
  InferRequestBody,
  StrikethroughIntent,
  VisualStructure,
  DomainRoute,
  InputClassification,
} from '@itnote/shared';

// ponytail: stdlib fetch with structured json, no heavy ai wrapper sdk required

export interface System1Output {
  decision: JevDecision;
  keywords: ExtractedKeywords;
}

/**
 * System 1: Jev / OpenJev (/v1/systemone) 규격 인터페이스
 * 자유 텍스트 대신 정형화된 의사결정 프리미티브(Noul, Choice, Box)만 산출
 */
export async function runSystem1Jev(request: InferRequestBody): Promise<System1Output> {
  if (process.env.NODE_ENV === 'test') {
    return runHeuristicSystem1(request);
  }

  const jevApiKey = process.env.JEV_API_KEY;
  const jevEndpoint = process.env.JEV_ENDPOINT_URL || 'https://api.jev.ai/v1/systemone';
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (jevApiKey && jevEndpoint) {
    try {
      return await callJevEndpoint(request, jevEndpoint, jevApiKey);
    } catch {
      // Jev 실패 시 Gemini 또는 Heuristic Fallback
    }
  }

  if (geminiApiKey) {
    try {
      return await callGeminiStructuredJev(request, geminiApiKey);
    } catch (err) {
      console.error('[System 1 Jev Error]', err instanceof Error ? err.message : err);
      // Gemini 실패 시 Heuristic Fallback
    }
  }

  return runHeuristicSystem1(request);
}

/**
 * 1. OpenJev / Jev 원시 HTTP 엔드포인트 호출 어댑터
 */
async function callJevEndpoint(
  request: InferRequestBody,
  endpoint: string,
  apiKey: string
): Promise<System1Output> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      imageBase64: request.croppedImageBase64,
      strokeMetadata: request.strokeMetadata,
      previousEvaporatedContext: request.previousEvaporatedContext,
      activeHypothesisSentence: request.activeHypothesisSentence,
      rejectedHypotheses: request.rejectedHypotheses,
      userContext: request.userContext,
    }),
  });

  if (!res.ok) {
    throw new Error(`Jev API returned status ${res.status}`);
  }

  const data = (await res.json()) as { decision: JevDecision; keywords: ExtractedKeywords };
  return {
    decision: data.decision,
    keywords: data.keywords,
  };
}

/**
 * 2. Gemini Structured Output 어댑터 (Jev 스키마 100% 동기화)
 */
async function callGeminiStructuredJev(
  request: InferRequestBody,
  apiKey: string
): Promise<System1Output> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`;

  const prompt = `You are System 1 (Jev Decision Engine). Analyze the user's note input and metadata.
Determine the decision primitives (Noul, Choice, Box) and extract active/struck-out keywords.

Input:
- Raw Text Input: ${request.rawTextInput ?? 'None (Handwriting image provided)'}
- Previous Evaporated Context: ${request.previousEvaporatedContext ?? 'null'}
- Active Hypothesis on Screen: ${request.activeHypothesisSentence ?? 'null'}
- Rejected Hypotheses (marked X): ${JSON.stringify(request.rejectedHypotheses ?? [])}
- User Persona: ${JSON.stringify(request.userContext?.persona ?? {})}
- Evolving Topics: ${JSON.stringify(request.userContext?.evolvingTopics ?? [])}

Crucial Persona Policy:
- The user's explicit input content is the primary ground truth.
- A user's profession/role (e.g., developer, student) is only a secondary background hint.
- Developers write everyday notes too (e.g. coffee choice, lunch menu, daily errands, groceries, casual ideas).
- NEVER force everyday personal notes into tech/work domains. Casual life notes MUST be classified as ROUTINE_TASK or GENERAL_IDEA.`;

  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
    { text: prompt },
  ];

  if (request.croppedImageBase64 && request.croppedImageBase64.startsWith('data:image/')) {
    parts.push({
      inlineData: {
        mimeType: 'image/png',
        data: request.croppedImageBase64.replace(/^data:image\/[a-z]+;base64,/, ''),
      },
    });
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 1000,
        thinkingConfig: { thinkingBudget: 0 },
        responseSchema: {
          type: 'OBJECT',
          properties: {
            isContinuousWithPrevious: {
              type: 'OBJECT',
              properties: {
                type: { type: 'STRING', enum: ['noul'] },
                probability: { type: 'NUMBER' },
                value: { type: 'BOOLEAN' },
              },
              required: ['type', 'probability', 'value'],
            },
            inputClassification: {
              type: 'OBJECT',
              properties: {
                type: { type: 'STRING', enum: ['choice'] },
                selected: { type: 'STRING', enum: ['FEEDBACK_REPLY', 'NEW_INDEPENDENT_MEMO', 'STRIKE_THROUGH'] },
                confidence: { type: 'NUMBER' },
              },
              required: ['type', 'selected', 'confidence'],
            },
            strikethroughIntent: {
              type: 'OBJECT',
              properties: {
                type: { type: 'STRING', enum: ['choice'] },
                selected: { type: 'STRING', enum: ['THOUGHT_PIVOT', 'TYPO_CORRECTION', 'NONE'] },
                confidence: { type: 'NUMBER' },
              },
              required: ['type', 'selected', 'confidence'],
            },
            visualStructure: {
              type: 'OBJECT',
              properties: {
                type: { type: 'STRING', enum: ['choice'] },
                selected: { type: 'STRING', enum: ['CONTRAST_ARROW', 'MIND_MAP', 'LIST', 'ISOLATED'] },
                confidence: { type: 'NUMBER' },
              },
              required: ['type', 'selected', 'confidence'],
            },
            domainRoute: {
              type: 'OBJECT',
              properties: {
                type: { type: 'STRING', enum: ['choice'] },
                selected: { type: 'STRING', enum: ['SIDE_PROJECT_SPARK', 'DEVSECOPS_STUDY', 'ROUTINE_TASK', 'GENERAL_IDEA'] },
                confidence: { type: 'NUMBER' },
              },
              required: ['type', 'selected', 'confidence'],
            },
            marginBox: {
              type: 'OBJECT',
              properties: {
                type: { type: 'STRING', enum: ['box'] },
                coordinates: {
                  type: 'ARRAY',
                  items: { type: 'NUMBER' },
                },
              },
              required: ['type', 'coordinates'],
            },
            extractedKeywords: {
              type: 'OBJECT',
              properties: {
                active: { type: 'ARRAY', items: { type: 'STRING' } },
                struckOut: { type: 'ARRAY', items: { type: 'STRING' } },
              },
              required: ['active', 'struckOut'],
            },
          },
          required: [
            'isContinuousWithPrevious',
            'inputClassification',
            'strikethroughIntent',
            'visualStructure',
            'domainRoute',
            'marginBox',
            'extractedKeywords',
          ],
        },
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Gemini API failed with status ${res.status}`);
  }

  const json = await res.json();
  const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error('Empty response from Gemini');

  const parsed = JSON.parse(rawText);
  return {
    decision: {
      isContinuousWithPrevious: parsed.isContinuousWithPrevious,
      inputClassification: parsed.inputClassification,
      strikethroughIntent: parsed.strikethroughIntent,
      visualStructure: parsed.visualStructure,
      domainRoute: parsed.domainRoute,
      marginBox: parsed.marginBox,
    },
    keywords: parsed.extractedKeywords ?? { active: [], struckOut: [] },
  };
}

/**
 * 3. Fallback Heuristic System 1 Engine
 * 오프라인, 테스트, 키 미설정 시 결정론적 판별 보장
 */
export function runHeuristicSystem1(request: InferRequestBody): System1Output {
  const [, minY, maxX] = request.strokeMetadata?.bbox ?? [100, 100, 300, 200];
  const activeHypothesis = request.activeHypothesisSentence;
  const previousEvaporated = request.previousEvaporatedContext;

  // 1. "새 단어" vs "AI 문장에 대한 답장" 구분 인식
  let inputClass: InputClassification = 'NEW_INDEPENDENT_MEMO';
  let inputConfidence = 0.85;

  if (activeHypothesis) {
    // 가설 문장이 현재 화면에 떠 있는 상태에서 입력된 경우
    // 가설 문장과 인접하거나 보충 성격의 입력으로 판별
    inputClass = 'FEEDBACK_REPLY';
    inputConfidence = 0.89;
  }

  // 2. 증발 후 연속성 (Noul 시간차 추론)
  let isContinuous = false;
  let continuityProb = 0.15;
  if (previousEvaporated && previousEvaporated.trim().length > 0) {
    // 직전 증발 맥락이 존재하면 연속적 사고 흐름으로 판정
    isContinuous = true;
    continuityProb = 0.84;
  }

  // 3. 취소선 및 구조 판정
  let strikethroughIntent: StrikethroughIntent = 'NONE';
  let visualStructure: VisualStructure = 'ISOLATED';
  const activeKeywords: string[] = ['Svelte 5', 'Hono'];
  const struckOutKeywords: string[] = [];

  if (request.rawTextInput) {
    const raw = request.rawTextInput.trim();
    if (raw.includes('->') || raw.includes('→')) {
      visualStructure = 'CONTRAST_ARROW';
      const parts = raw.split(/->|→/).map((s) => s.trim());
      activeKeywords.length = 0;
      activeKeywords.push(...parts.filter(Boolean));
    } else if (raw.includes('~~') || raw.includes(' 취소 ')) {
      strikethroughIntent = 'THOUGHT_PIVOT';
      visualStructure = 'CONTRAST_ARROW';
      
      // 다중 취소선 일괄 추출 (예: ~~초코라떼~~, ~~4000원~~)
      const matches = Array.from(raw.matchAll(/~~([^~]+)~~/g));
      for (const m of matches) {
        struckOutKeywords.push(m[1].trim());
      }

      // 취소선 제거 후 남은 텍스트에서 활성 키워드 추출
      const cleaned = raw.replace(/~~[^~]+~~/g, '').trim();
      const tokens = cleaned.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
      if (tokens.length > 0) {
        activeKeywords.length = 0;
        activeKeywords.push(...tokens);
      }
    } else {
      activeKeywords.length = 0;
      activeKeywords.push(...raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean));
    }
  }

  // 4. 여백 바운딩박스 계산 (필기 우측 또는 하단)
  const marginMinX = maxX + 36;
  const marginMinY = minY;
  const marginMaxX = Math.min(2350, marginMinX + 440);
  const marginMaxY = marginMinY + 105;

  let domainRoute: DomainRoute = 'GENERAL_IDEA';
  const fullTextLower = `${request.rawTextInput ?? ''} ${activeKeywords.join(' ')}`.toLowerCase();

  // 1. 일상/생활/식음료/루틴 메모
  if (/원|라떼|커피|밀크티|식사|점심|저녁|밥|마트|장보기|운동|헬스|일정|할일/.test(fullTextLower)) {
    domainRoute = 'ROUTINE_TASK';
  }
  // 2. 클라우드/인프라/보안 실무
  else if (/k8s|kubernetes|docker|iam|rbac|보안|devsecops|ci\/cd|pipeline|gitleaks|aws|gcp|terraform|linux/.test(fullTextLower)) {
    domainRoute = 'DEVSECOPS_STUDY';
  }
  // 3. 프로젝트/개발 기술 스택
  else if (/svelte|react|hono|vite|vue|node|db|postgres|mongo|redis|kafka|api|모노레포|프론트|백엔드/.test(fullTextLower)) {
    domainRoute = 'SIDE_PROJECT_SPARK';
  }
  // 4. 그 외 일반 아이디어 또는 페르소나 주제 참고
  else {
    domainRoute = 'GENERAL_IDEA';
  }

  return {
    decision: {
      isContinuousWithPrevious: {
        type: 'noul',
        probability: continuityProb,
        value: isContinuous,
      },
      inputClassification: {
        type: 'choice',
        selected: inputClass,
        confidence: inputConfidence,
      },
      strikethroughIntent: {
        type: 'choice',
        selected: strikethroughIntent,
        confidence: 0.91,
      },
      visualStructure: {
        type: 'choice',
        selected: visualStructure,
        confidence: 0.88,
      },
      domainRoute: {
        type: 'choice',
        selected: domainRoute,
        confidence: 0.79,
      },
      marginBox: {
        type: 'box',
        coordinates: [marginMinX, marginMinY, marginMaxX, marginMaxY],
      },
    },
    keywords: {
      active: activeKeywords,
      struckOut: struckOutKeywords,
    },
  };
}
