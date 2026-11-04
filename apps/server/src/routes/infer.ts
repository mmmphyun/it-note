import { Hono } from 'hono';
import type { InferRequestBody, JevDecisionResult } from '@itnote/shared';
import { runSystem1Jev } from '../services/system1Jev';
import { runSystem2Writer } from '../services/system2Writer';
import { extractSessionId, getSession, userStore } from './auth';
import { getUserContext } from '../services/profileEnricher';

export const inferRoute = new Hono();

// Zero-retention 원칙: 원본 필기 이미지는 디스크에 기록하지 않고 메모리에서 처리 후 즉시 해제
inferRoute.post('/', async (c) => {
  let body: InferRequestBody;
  try {
    body = await c.req.json<InferRequestBody>();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.croppedImageBase64 && !body.rawTextInput) {
    return c.json({ error: 'croppedImageBase64 or rawTextInput is required' }, 400);
  }

  // 인증 세션 기반 사용자 컨텍스트 자동 주입 (직무, 관심사, 성향, 현재 시간표 루틴)
  const sessionId = extractSessionId(c);
  const session = getSession(sessionId);
  if (session) {
    const stored = userStore.get(session.user.id);
    const profile = stored?.profile ?? session.user;
    const routine = stored?.routine ?? [];
    const enrichedContext = getUserContext(session.user.id);

    // 현재 요일/시간대 기준 진행 중인 작업 라벨 파악
    const now = new Date();
    const currentDay = now.getDay();
    const currentHour = now.getHours();
    const activeSlot = routine.find(
      (r) => r.dayOfWeek === currentDay && currentHour >= r.startHour && currentHour < r.endHour
    );

    body.userContext = {
      persona: {
        role: profile.role || '자유 기록자',
        interests: profile.interests || [],
        subInterests: profile.preferences?.subInterests || [],
        lifestyleHabits: profile.preferences?.lifestyleHabits || [],
        thinkingStyle: profile.preferences?.thinkingStyle || 'PRAGMATIC',
        sentenceTone: profile.preferences?.sentenceTone || 'CONCISE',
        currentActivity: activeSlot ? activeSlot.label : undefined,
      },
      currentRoutineState: activeSlot ? activeSlot.label : '자유 메모 시간',
      evolvingTopics: enrichedContext.ongoingTopics,
      recentConfirmedNotes: (enrichedContext.recentConfirmedNotes || []).map((n) => n.sentence),
      ...body.userContext,
    };
  }

  // 1. System 1 (Jev/OpenJev 의사결정)
  const system1Output = await runSystem1Jev(body);

  // 2. System 2 (단일 문장 생성)
  const sentence = await runSystem2Writer({
    decision: system1Output.decision,
    keywords: system1Output.keywords,
    request: body,
  });

  const response: JevDecisionResult = {
    jevDecision: system1Output.decision,
    extractedKeywords: system1Output.keywords,
    sentence,
  };

  return c.json(response);
});
