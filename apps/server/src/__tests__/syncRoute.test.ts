import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../app';
import { clearSyncStoreForTesting, encryptedBlobStore } from '../routes/sync';
import type { EncryptedNotePayload, SyncPushRequest } from '@itnote/shared';

describe('Zero-Knowledge E2EE Sync Route (/api/sync)', () => {
  beforeEach(() => {
    clearSyncStoreForTesting();
  });

  const dummyPayload: EncryptedNotePayload = {
    noteId: 'note-001',
    iv: 'aXZfc2FtcGxlXzEyYg==',
    salt: 'c2FsdF9zYW1wbGVfMTZi',
    ciphertext: 'c2VjcmV0X2Flc19nY21fY2lwaGVydGV4dA==',
    updatedAt: Date.now(),
    version: 1,
  };

  it('토큰이나 쿠키가 전혀 없는 비인가 사용자의 Push 요청은 401 Unauthorized로 거부해야 한다', async () => {
    const res = await app.request('/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: [dummyPayload] }),
    });

    expect(res.status).toBe(401);
  });

  it('인증된 사용자의 암호문 블롭을 저장하고 Pull 시 그대로 복원해야 한다', async () => {
    const sessionToken = 'valid-session-e2ee-user-1';

    // 1. Push
    const pushRes = await app.request('/api/sync/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ notes: [dummyPayload] } as SyncPushRequest),
    });

    expect(pushRes.status).toBe(200);
    const pushData = (await pushRes.json()) as { success: boolean; savedCount: number };
    expect(pushData.success).toBe(true);
    expect(pushData.savedCount).toBe(1);

    // 2. Pull
    const pullRes = await app.request('/api/sync/pull', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${sessionToken}`,
      },
    });

    expect(pullRes.status).toBe(200);
    const pullData = (await pullRes.json()) as { notes: EncryptedNotePayload[] };
    expect(pullData.notes.length).toBe(1);
    expect(pullData.notes[0].noteId).toBe('note-001');
    expect(pullData.notes[0].ciphertext).toBe(dummyPayload.ciphertext);
  });

  it('서버 메모리에는 오직 암호문 블롭만 존재하며 평문이 노출되지 않아야 한다 (Zero-Knowledge)', async () => {
    const sessionToken = 'strict-session-e2ee-user';

    await app.request('/api/sync/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ notes: [dummyPayload] }),
    });

    // 서버 스토리지 검사
    const targetUserId = `user-${sessionToken.slice(0, 12)}`;
    const userStore = encryptedBlobStore.get(targetUserId);
    expect(userStore).toBeDefined();
    const stored = userStore!.get('note-001');
    expect(stored).toBeDefined();

    // 서버 스토리지 검사: 평문 관련 키가 일절 없어야 함
    const storedKeys = Object.keys(stored!);
    expect(storedKeys).not.toContain('plaintext');
    expect(storedKeys).not.toContain('text');
    expect(storedKeys).not.toContain('content');
    expect(stored!.ciphertext).toBe(dummyPayload.ciphertext);
    expect(stored!.iv).toBe(dummyPayload.iv);
    expect(stored!.salt).toBe(dummyPayload.salt);
  });

  it('사용자 간 데이터가 완벽히 격리되어 타인의 암호문 블롭을 열람할 수 없어야 한다', async () => {
    const tokenA = 'alpha-user-unique-token-01';
    const tokenB = 'beta-user-unique-token-02';

    // A가 Push
    await app.request('/api/sync/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({ notes: [dummyPayload] }),
    });

    // B가 Pull
    const pullResB = await app.request('/api/sync/pull', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tokenB}`,
      },
    });

    const pullDataB = (await pullResB.json()) as { notes: EncryptedNotePayload[] };
    expect(pullDataB.notes.length).toBe(0);
  });
});
