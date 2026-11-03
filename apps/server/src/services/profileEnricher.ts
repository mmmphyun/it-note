import type { ConfirmedNote, EvolvingContext } from '@itnote/shared';

// 사용자 ID별 진화 맥락 인메모리 스토어 (Zero-Retention 원칙 준수)
const userContextStore = new Map<string, EvolvingContext>();

/**
 * 기본 빈 진화 맥락 생성
 */
export function createInitialContext(): EvolvingContext {
  return {
    ongoingTopics: [],
    domainVocabulary: [],
    confirmedPreferences: [],
    recentConfirmedNotes: [],
  };
}

/**
 * 특정 사용자의 진화 맥락 조회 (없으면 초기화)
 */
export function getUserContext(userId: string): EvolvingContext {
  let ctx = userContextStore.get(userId);
  if (!ctx) {
    ctx = createInitialContext();
    userContextStore.set(userId, ctx);
  }
  return ctx;
}

/**
 * 특정 사용자의 진화 맥락 직접 갱신 (태그 수동 추가/삭제용)
 */
export function updateUserContext(userId: string, updated: Partial<EvolvingContext>): EvolvingContext {
  const current = getUserContext(userId);
  const next: EvolvingContext = {
    ...current,
    ...updated,
  };
  userContextStore.set(userId, next);
  return next;
}

/**
 * 한글/영문 텍스트에서 기술 키워드 및 고유 명사 후보 추출
 */
export function extractKeywordsFromSentence(sentence: string): string[] {
  if (!sentence) return [];

  // 영문 단어 및 복합 식별자 추출 (예: Svelte 5, Hono, Zero-UI, SQLite, DB)
  const englishTerms = sentence.match(/[A-Za-z0-9+#.-]+/g) || [];

  // 한글 명사/단어 패턴 추출 (2글자 이상, 일반 서술어 어미 제외)
  const koreanTerms = sentence
    .replace(/[^\uAC00-\uD7AF\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .filter((w) => {
      // 흔한 조사 및 서술 어미 필터링
      const STOP_WORDS = new Set([
        '맞나요', '있는지', '위해서', '아니라', '한다는', '그리고',
        '하지만', '통해서', '대해서', '관련된', '가지고', '아이디어',
        '생각이', '문장이', '어떤가요', '무엇인가요', '있습니다', '됩니다',
      ]);
      return !STOP_WORDS.has(w);
    });

  // 결합 및 중복 제거
  const merged = Array.from(new Set([...englishTerms, ...koreanTerms]));

  // 길이 1 이하 및 순수 숫자 필터링
  return merged.filter((term) => term.length >= 2 && !/^\d+$/.test(term));
}

/**
 * profileEnricher: O 확정 시 사용자 맥락을 누적/살찌우는 순수 함수
 * @param current 현재 사용자의 진화 맥락
 * @param confirmedNote 방금 사용자가 O를 쳐서 흡수한 확정 노트
 * @returns 진화된 EvolvingContext
 */
export function enrichContext(
  current: EvolvingContext,
  confirmedNote: ConfirmedNote
): EvolvingContext {
  // 1. 노트 본문 및 제공된 키워드로부터 신규 토픽 추출
  const sentenceKeywords = extractKeywordsFromSentence(confirmedNote.sentence);
  const candidateKeywords = [...(confirmedNote.keywords || []), ...sentenceKeywords];

  // 2. ongoingTopics 갱신 (최신순 우선 + 중복 제거 + 최대 15개 유지)
  const topicSet = new Set<string>();
  for (const k of candidateKeywords) {
    if (k && k.length >= 2) topicSet.add(k);
  }
  for (const t of current.ongoingTopics) {
    topicSet.add(t);
  }
  const updatedTopics = Array.from(topicSet).slice(0, 15);

  // 3. domainVocabulary 갱신 (영문/대문자/기술 고유명사 분리)
  const vocabSet = new Set<string>(current.domainVocabulary);
  for (const k of candidateKeywords) {
    // 영문이 포함되어 있거나 3글자 이상의 특수 식별자
    if (/[a-zA-Z]/.test(k) || k.includes('-') || k.includes('_')) {
      vocabSet.add(k);
    }
  }
  const updatedVocabulary = Array.from(vocabSet).slice(0, 20);

  // 4. confirmedPreferences (가설 문장 자체를 선호 맥락으로 요약)
  const prefSet = new Set<string>(current.confirmedPreferences);
  prefSet.add(confirmedNote.sentence.trim());
  const updatedPreferences = Array.from(prefSet).slice(0, 10);

  // 5. recentConfirmedNotes (최대 5개 최신순 보존)
  const updatedNotes = [
    confirmedNote,
    ...current.recentConfirmedNotes.filter((n) => n.id !== confirmedNote.id),
  ].slice(0, 5);

  return {
    ongoingTopics: updatedTopics,
    domainVocabulary: updatedVocabulary,
    confirmedPreferences: updatedPreferences,
    recentConfirmedNotes: updatedNotes,
  };
}

/**
 * O 확정 API 엔드포인트에서 호출하는 Facade
 */
export function recordConfirmedNote(
  userId: string,
  confirmedNote: ConfirmedNote
): EvolvingContext {
  const current = getUserContext(userId);
  const next = enrichContext(current, confirmedNote);
  userContextStore.set(userId, next);
  return next;
}
