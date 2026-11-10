import type { ConfirmedNote, LinkedContextItem } from '@itnote/shared';

/**
 * 텍스트에서 불용어를 제외하고 의미 있는 키워드 토큰을 추출합니다.
 */
export function extractKeywords(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  // 한글, 영문, 숫자 단어 단위 분리 (특수문자 및 공백 제거)
  const tokens = text
    .toLowerCase()
    .replace(/[^\w\s가-힣]/g, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2); // 1글자 조사/어미 제외

  // 중복 제거
  return Array.from(new Set(tokens));
}

/**
 * 자카드 유사도(Jaccard Similarity) 계산
 */
function calculateJaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersectionSize = 0;
  for (const item of setA) {
    if (setB.has(item)) {
      intersectionSize++;
    }
  }
  const unionSize = setA.size + setB.size - intersectionSize;
  return unionSize > 0 ? intersectionSize / unionSize : 0;
}

/**
 * pg-jev 의사결정 함수(jev_match)를 브라우저 로컬 인메모리 연산으로 포팅한 매칭 엔진
 * 1. 키워드 자카드 유사도
 * 2. 확정 노트 키워드와의 직접 교집합
 * 3. 시간 최신성 가중치(Recency Decay: 30일 기준 반감기)
 */
export function matchLocalJevContext(
  currentTextOrKeywords: string | string[],
  confirmedNotes: ConfirmedNote[],
  limit = 3
): LinkedContextItem[] {
  if (!confirmedNotes || confirmedNotes.length === 0) {
    return [];
  }

  const queryTokens = Array.isArray(currentTextOrKeywords)
    ? currentTextOrKeywords.map(t => t.toLowerCase().trim()).filter(Boolean)
    : extractKeywords(currentTextOrKeywords);

  if (queryTokens.length === 0) {
    return [];
  }

  const querySet = new Set(queryTokens);
  const now = Date.now();
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

  const scoredNotes = confirmedNotes.map(note => {
    const noteTokens = new Set([
      ...(note.keywords || []).map(k => k.toLowerCase().trim()),
      ...extractKeywords(note.sentence)
    ]);

    // 1. 공통 일치 키워드 추출
    const matchedKeywords: string[] = [];
    for (const q of querySet) {
      if (noteTokens.has(q)) {
        matchedKeywords.push(q);
      }
    }

    // 2. 자카드 유사도
    const jaccard = calculateJaccardSimilarity(querySet, noteTokens);

    // 3. 최신성 감쇄 가중치 (0.5 ~ 1.0)
    const ageMs = Math.max(0, now - note.confirmedAt);
    const recencyWeight = Math.max(0.5, 1 - ageMs / (THIRTY_DAYS_MS * 2));

    // 4. 최종 점수 (키워드 일치 건수 + 자카드 가중치 * 최신성)
    const matchBonus = matchedKeywords.length > 0 ? 0.3 + Math.min(0.4, matchedKeywords.length * 0.15) : 0;
    const finalScore = (jaccard * 0.4 + matchBonus) * recencyWeight;

    return {
      noteId: note.id,
      sentence: note.sentence,
      similarity: Math.round(finalScore * 100) / 100,
      matchedKeywords,
      createdAt: new Date(note.confirmedAt).toISOString()
    };
  });

  // 유사도 높은 순으로 정렬 후 상위 K개 반환 (최소 유사도 0.1 이상)
  return scoredNotes
    .filter(n => n.similarity >= 0.1 || n.matchedKeywords.length > 0)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}
