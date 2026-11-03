import { Hono } from 'hono';
import type { ConfirmedNote } from '@itnote/shared';
import { extractSessionId, getSession } from './auth';
import {
  getUserContext,
  updateUserContext,
  recordConfirmedNote,
} from '../services/profileEnricher';

export const notesRoute = new Hono();

// 사용자별 확정 노트 저장소 (Zero-Retention 인메모리)
const notesStore = new Map<string, ConfirmedNote[]>();

function getUserId(c: any): string {
  const sessionId = extractSessionId(c);
  const session = getSession(sessionId);
  return session ? session.user.id : 'anonymous-session';
}

/**
 * 1. O 확정 노트 저장 및 진화 맥락 누적 (POST /api/notes/confirm)
 */
notesRoute.post('/confirm', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json().catch(() => null);

  if (!body || !body.sentence) {
    return c.json({ error: 'Sentence is required' }, 400);
  }

  const confirmedNote: ConfirmedNote = {
    id: body.id || `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sentence: String(body.sentence).trim(),
    confirmedAt: body.confirmedAt || Date.now(),
    keywords: Array.isArray(body.keywords) ? body.keywords.map(String) : [],
    sourceBBox: body.bbox || body.sourceBBox,
  };

  // 인메모리 노트 목록에 추가
  const userNotes = notesStore.get(userId) || [];
  const updatedNotes = [confirmedNote, ...userNotes];
  notesStore.set(userId, updatedNotes);

  // profileEnricher를 통해 진화 맥락 업데이트
  const evolvingContext = recordConfirmedNote(userId, confirmedNote);

  return c.json({
    success: true,
    confirmedNote,
    evolvingContext,
    totalCount: updatedNotes.length,
  });
});

/**
 * 2. 확정 노트 목록 조회 (GET /api/notes/confirmed)
 */
notesRoute.get('/confirmed', (c) => {
  const userId = getUserId(c);
  const userNotes = notesStore.get(userId) || [];
  return c.json({
    notes: userNotes,
    totalCount: userNotes.length,
  });
});

/**
 * 3. 진화 맥락 조회 (GET /api/notes/context)
 */
notesRoute.get('/context', (c) => {
  const userId = getUserId(c);
  const context = getUserContext(userId);
  return c.json({ context });
});

/**
 * 4. 진화 맥락 수동 수정/삭제 (PUT /api/notes/context)
 */
notesRoute.put('/context', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json().catch(() => null);

  if (!body) {
    return c.json({ error: 'Invalid context data' }, 400);
  }

  const nextContext = updateUserContext(userId, {
    ongoingTopics: Array.isArray(body.ongoingTopics) ? body.ongoingTopics.map(String) : undefined,
    domainVocabulary: Array.isArray(body.domainVocabulary) ? body.domainVocabulary.map(String) : undefined,
    confirmedPreferences: Array.isArray(body.confirmedPreferences) ? body.confirmedPreferences.map(String) : undefined,
  });

  return c.json({
    success: true,
    context: nextContext,
  });
});
