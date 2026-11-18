import { describe, it, expect, beforeEach } from 'vitest';
import type { ConfirmedNote } from '@itnote/shared';
import {
  loadConfirmedNotesFromDb,
  saveConfirmedNoteToDb,
  mergeConfirmedNotesToDb,
  clearConfirmedNotesDbForTesting,
  getE2eePassphrase,
  setE2eePassphrase,
} from '../noteDb';

describe('IndexedDB 로컬 노트 저장소 및 E2EE 패스프레이즈 관리 (noteDb)', () => {
  beforeEach(async () => {
    await clearConfirmedNotesDbForTesting();
  });

  it('노트를 저장하고 조회하면 confirmedAt 내림차순으로 반환해야 한다', async () => {
    const older: ConfirmedNote = {
      id: 'note-1',
      sentence: '이전 노트',
      confirmedAt: 1000,
      keywords: ['이전'],
    };
    const newer: ConfirmedNote = {
      id: 'note-2',
      sentence: '최신 노트',
      confirmedAt: 2000,
      keywords: ['최신'],
    };

    await saveConfirmedNoteToDb(older);
    await saveConfirmedNoteToDb(newer);

    const list = await loadConfirmedNotesFromDb();
    expect(list.map((n) => n.id)).toEqual(['note-2', 'note-1']);
  });

  it('mergeConfirmedNotesToDb는 ID 기준으로 중복을 제거하고 최신 항목을 보존해야 한다', async () => {
    await saveConfirmedNoteToDb({
      id: 'note-a',
      sentence: '로컬 버전',
      confirmedAt: 1000,
      keywords: ['로컬'],
    });

    const merged = await mergeConfirmedNotesToDb([
      {
        id: 'note-a',
        sentence: '동기화된 최신 버전',
        confirmedAt: 3000,
        keywords: ['동기화'],
      },
      {
        id: 'note-b',
        sentence: '다른 기기 노트',
        confirmedAt: 2500,
        keywords: ['타기기'],
      },
    ]);

    expect(merged).toHaveLength(2);
    expect(merged[0].id).toBe('note-a');
    expect(merged[0].sentence).toBe('동기화된 최신 버전');
    expect(merged[1].id).toBe('note-b');
  });

  it('E2EE 패스프레이즈를 세션 단위로 설정하고 초기화할 수 있어야 한다', () => {
    expect(getE2eePassphrase()).toBe('');
    setE2eePassphrase('  my-local-phrase  ');
    expect(getE2eePassphrase()).toBe('my-local-phrase');
    setE2eePassphrase('');
    expect(getE2eePassphrase()).toBe('');
  });
});
