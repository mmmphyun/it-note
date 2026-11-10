import { Hono } from 'hono';
import type {
  EncryptedNotePayload,
  SyncPushRequest,
  SyncPushResponse,
  SyncPullResponse,
} from '@itnote/shared';
import { extractSessionId, getSession } from './auth';

export const syncRoute = new Hono();

// Zero-Knowledge 원칙: 서버는 유저 ID별 암호문 블롭만 보관하며 평문 해석이 불가능함
// Map<userId, Map<noteId, EncryptedNotePayload>>
export const encryptedBlobStore = new Map<string, Map<string, EncryptedNotePayload>>();

/**
 * 테스트용 스토어 초기화
 */
export function clearSyncStoreForTesting(): void {
  encryptedBlobStore.clear();
}

/**
 * E2EE 암호화 노트 블롭 업로드 (Push)
 */
syncRoute.post('/push', async (c) => {
  const sessionId = extractSessionId(c);
  const session = getSession(sessionId);

  if (!session) {
    return c.json({ error: 'Unauthorized: Valid session required for sync' }, 401);
  }

  let body: SyncPushRequest;
  try {
    body = await c.req.json<SyncPushRequest>();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!Array.isArray(body.notes)) {
    return c.json({ error: 'Field "notes" must be an array' }, 400);
  }

  const userId = session.user.id;
  let userNotes = encryptedBlobStore.get(userId);
  if (!userNotes) {
    userNotes = new Map<string, EncryptedNotePayload>();
    encryptedBlobStore.set(userId, userNotes);
  }

  const now = Date.now();
  for (const note of body.notes) {
    if (!note.noteId || !note.ciphertext || !note.iv || !note.salt) {
      continue;
    }
    userNotes.set(note.noteId, {
      ...note,
      updatedAt: note.updatedAt || now,
    });
  }

  const response: SyncPushResponse = {
    success: true,
    savedCount: body.notes.length,
    serverSyncTimestamp: now,
  };

  return c.json(response);
});

/**
 * E2EE 암호화 노트 블롭 다운로드 (Pull)
 */
syncRoute.get('/pull', (c) => {
  const sessionId = extractSessionId(c);
  const session = getSession(sessionId);

  if (!session) {
    return c.json({ error: 'Unauthorized: Valid session required for sync' }, 401);
  }

  const since = Number(c.req.query('since')) || 0;
  const userId = session.user.id;
  const userNotes = encryptedBlobStore.get(userId);

  const notes: EncryptedNotePayload[] = [];
  if (userNotes) {
    for (const note of userNotes.values()) {
      if (note.updatedAt >= since) {
        notes.push(note);
      }
    }
  }

  const response: SyncPullResponse = {
    notes,
    serverSyncTimestamp: Date.now(),
  };

  return c.json(response);
});
