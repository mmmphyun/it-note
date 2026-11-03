import { describe, it, expect } from 'vitest';
import {
  extractKeywordsFromSentence,
  enrichContext,
  createInitialContext,
} from '../services/profileEnricher';
import { app } from '../app';

describe('Profile Enricher & EvolvingContext', () => {
  it('extractKeywordsFromSentence — 불용어를 필터링하고 기술 고유명사와 핵심 단어를 추출한다', () => {
    const sentence =
      '가상 DOM 오버헤드가 큰 React 대신 프론트엔드와 백엔드를 Svelte 5와 Hono로 통일한다는 아이디어 맞나요?';
    const keywords = extractKeywordsFromSentence(sentence);

    expect(keywords).toContain('Svelte');
    expect(keywords).toContain('Hono');
    expect(keywords).toContain('React');
    expect(keywords).not.toContain('맞나요');
    expect(keywords).not.toContain('아이디어');
  });

  it('enrichContext — O 확정 시 중복 없이 ongoingTopics와 domainVocabulary를 누적한다', () => {
    const initial = createInitialContext();
    const note1 = {
      id: 'note-1',
      sentence: 'SQLite와 Cloudflare Workers를 결합해 초경량 에지 DB 아키텍처를 구성한다',
      confirmedAt: 1000,
      keywords: ['SQLite', 'Workers'],
    };

    const ctx1 = enrichContext(initial, note1);
    expect(ctx1.ongoingTopics).toContain('SQLite');
    expect(ctx1.ongoingTopics).toContain('Workers');
    expect(ctx1.domainVocabulary).toContain('SQLite');
    expect(ctx1.recentConfirmedNotes.length).toBe(1);

    // 동일 키워드를 포함한 두 번째 노트 확정 시 중복 제거 확인
    const note2 = {
      id: 'note-2',
      sentence: 'Workers 환경에서 Svelte 5 SSR을 직접 서빙한다',
      confirmedAt: 2000,
      keywords: ['Workers', 'Svelte 5'],
    };

    const ctx2 = enrichContext(ctx1, note2);
    // 중복 제거 검증: Workers가 1개만 존재해야 함
    const workersCount = ctx2.ongoingTopics.filter((t) => t === 'Workers').length;
    expect(workersCount).toBe(1);
    expect(ctx2.recentConfirmedNotes.length).toBe(2);
    expect(ctx2.recentConfirmedNotes[0].id).toBe('note-2'); // 최신순 0번 인덱스
  });

  it('POST /api/notes/confirm — 캔버스 O 확정 시 서버에 저장되고 진화 맥락을 즉시 갱신한다', async () => {
    // 1. 데모 세션 생성
    const loginRes = await app.request('/api/auth/demo', { method: 'POST' });
    const { session } = await loginRes.json();
    const authHeaders = { Cookie: `itnote_session=${session.sessionId}`, 'Content-Type': 'application/json' };

    // 2. 노트 O 확정 호출
    const confirmRes = await app.request('/api/notes/confirm', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        sentence: 'Zero-UI 원칙에 따라 순수 펜 제스처로만 상호작용하는 잇적 시스템 설계',
        keywords: ['Zero-UI', 'Stylus', 'Pure'],
      }),
    });

    expect(confirmRes.status).toBe(200);
    const confirmData = await confirmRes.json();
    expect(confirmData.success).toBe(true);
    expect(confirmData.confirmedNote.sentence).toContain('Zero-UI 원칙');
    expect(confirmData.evolvingContext.ongoingTopics).toContain('Zero-UI');

    // 3. 확정 노트 목록 조회 검증
    const listRes = await app.request('/api/notes/confirmed', { headers: authHeaders });
    const listData = await listRes.json();
    expect(listData.notes.length).toBeGreaterThanOrEqual(1);
    expect(listData.notes[0].sentence).toContain('Zero-UI 원칙');
  });
});
