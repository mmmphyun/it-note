import { describe, it, expect } from 'vitest';
import { extractKeywords, matchLocalJevContext } from '../localJevMatcher';
import type { ConfirmedNote } from '@itnote/shared';

describe('localJevMatcher (pg-jev 브라우저 로컬 매칭 엔진)', () => {
  it('텍스트에서 조사 및 특수문자를 제거하고 2글자 이상 키워드를 추출해야 한다', () => {
    const text = 'Svelte 5와 Hono를 이용해 모노레포를 구축한다!';
    const keywords = extractKeywords(text);
    expect(keywords).toContain('svelte');
    expect(keywords).toContain('hono를');
    expect(keywords).toContain('모노레포를');
    expect(keywords).toContain('구축한다');
  });

  it('과거 확정 노트 중 현재 키워드와 가장 연관된 상위 K개 노트를 정확히 도출해야 한다', () => {
    const mockNotes: ConfirmedNote[] = [
      {
        id: 'note-1',
        sentence: 'Svelte 5 Runes 반응형 상태 관리와 120Hz 펜 좌표 스트림 최적화',
        confirmedAt: Date.now() - 1000 * 60 * 60, // 1시간 전
        keywords: ['svelte', 'runes', 'pointerevent']
      },
      {
        id: 'note-2',
        sentence: '토스페이먼츠 PG 결제 웹훅 멱등성 검증 및 트랜잭션 수거 로직',
        confirmedAt: Date.now() - 1000 * 60 * 60 * 24, // 1일 전
        keywords: ['tosspayments', 'billing', 'webhook']
      },
      {
        id: 'note-3',
        sentence: 'Hono 백엔드 Cloud Functions v2 asia-northeast3 배포 구조',
        confirmedAt: Date.now() - 1000 * 60 * 60 * 48, // 2일 전
        keywords: ['hono', 'cloudfunctions', 'deploy']
      }
    ];

    // 'svelte runes' 쿼리
    const results = matchLocalJevContext(['svelte', 'runes'], mockNotes, 2);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].noteId).toBe('note-1');
    expect(results[0].matchedKeywords).toContain('svelte');
    expect(results[0].matchedKeywords).toContain('runes');
    expect(results[0].similarity).toBeGreaterThan(0.5);
  });

  it('연관 키워드가 전혀 없는 경우 빈 배열을 반환해야 한다', () => {
    const mockNotes: ConfirmedNote[] = [
      {
        id: 'note-1',
        sentence: '파이썬 머신러닝 데이터 분석',
        confirmedAt: Date.now(),
        keywords: ['python', 'ml']
      }
    ];

    const results = matchLocalJevContext(['쿠버네티스', '도커'], mockNotes, 3);
    expect(results).toEqual([]);
  });
});
