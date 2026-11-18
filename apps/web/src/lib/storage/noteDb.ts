import type { ConfirmedNote } from '@itnote/shared';

const DB_NAME = 'itnote_local_db';
const DB_VERSION = 1;
const STORE_NAME = 'confirmed_notes';
const PASSPHRASE_SESSION_KEY = 'itnote_e2ee_passphrase';

const memoryFallbackStore = new Map<string, ConfirmedNote>();
let memoryPassphraseFallback = '';

function sortNotesDesc(notes: ConfirmedNote[]): ConfirmedNote[] {
  return [...notes].sort((a, b) => b.confirmedAt - a.confirmedAt);
}

function openNoteDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
  });
}

/**
 * IndexedDB(미지원 환경은 인메모리)에서 확정 노트 목록을 최신순으로 조회한다.
 */
export async function loadConfirmedNotesFromDb(): Promise<ConfirmedNote[]> {
  if (typeof indexedDB === 'undefined') {
    return sortNotesDesc(Array.from(memoryFallbackStore.values()));
  }

  try {
    const db = await openNoteDatabase();
    return await new Promise<ConfirmedNote[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const rows = (req.result as ConfirmedNote[] | undefined) ?? [];
        resolve(sortNotesDesc(rows));
      };
      req.onerror = () => reject(req.error ?? new Error('Failed to read notes from IndexedDB'));
    });
  } catch {
    return sortNotesDesc(Array.from(memoryFallbackStore.values()));
  }
}

/**
 * 단일 확정 노트를 IndexedDB에 영속 저장한다.
 */
export async function saveConfirmedNoteToDb(note: ConfirmedNote): Promise<void> {
  memoryFallbackStore.set(note.id, note);
  if (typeof indexedDB === 'undefined') {
    return;
  }

  try {
    const db = await openNoteDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(note);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to save note to IndexedDB'));
    });
  } catch {
    // 브라우저 프라이빗 모드 등 IndexedDB 차단 시 인메모리 폴백 유지
  }
}

/**
 * 다수의 노트를 ID 기준으로 중복 없이 병합 저장하고 최신순 배열을 반환한다.
 */
export async function mergeConfirmedNotesToDb(incoming: ConfirmedNote[]): Promise<ConfirmedNote[]> {
  const existing = await loadConfirmedNotesFromDb();
  const mergedMap = new Map<string, ConfirmedNote>();

  for (const item of existing) {
    mergedMap.set(item.id, item);
  }
  for (const item of incoming) {
    const prev = mergedMap.get(item.id);
    if (!prev || item.confirmedAt >= prev.confirmedAt) {
      mergedMap.set(item.id, item);
    }
  }

  const mergedList = sortNotesDesc(Array.from(mergedMap.values()));
  for (const item of incoming) {
    await saveConfirmedNoteToDb(mergedMap.get(item.id)!);
  }
  return mergedList;
}

/**
 * 테스트용 로컬 DB 및 세션 패스프레이즈 초기화
 */
export async function clearConfirmedNotesDbForTesting(): Promise<void> {
  memoryFallbackStore.clear();
  memoryPassphraseFallback = '';
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.removeItem(PASSPHRASE_SESSION_KEY);
    } catch {}
  }
}

/**
 * E2EE 마스터 패스프레이즈 조회 (서버 전송 없이 브라우저 세션 메모리/sessionStorage에만 유지)
 */
export function getE2eePassphrase(): string {
  if (typeof sessionStorage !== 'undefined') {
    try {
      const stored = sessionStorage.getItem(PASSPHRASE_SESSION_KEY);
      if (stored) return stored;
    } catch {}
  }
  return memoryPassphraseFallback;
}

/**
 * E2EE 마스터 패스프레이즈 저장
 */
export function setE2eePassphrase(passphrase: string): void {
  const trimmed = passphrase.trim();
  memoryPassphraseFallback = trimmed;
  if (typeof sessionStorage !== 'undefined') {
    try {
      if (trimmed) {
        sessionStorage.setItem(PASSPHRASE_SESSION_KEY, trimmed);
      } else {
        sessionStorage.removeItem(PASSPHRASE_SESSION_KEY);
      }
    } catch {}
  }
}
