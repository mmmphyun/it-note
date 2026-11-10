/**
 * Zero-Knowledge E2EE 종단간 암호화 동기화 스키마 규격
 * 서버는 암호문 블롭만 보관하며 평문(Plaintext)을 열람할 수 없음
 */

export interface EncryptedNotePayload {
  noteId: string;
  iv: string; // Base64 인코딩된 12-byte IV
  salt: string; // Base64 인코딩된 16-byte PBKDF2 Salt
  ciphertext: string; // Base64 인코딩된 AES-256-GCM 암호문 (AuthTag 결합)
  updatedAt: number; // 타임스탬프 (ms)
  version: number;
}

export interface SyncPushRequest {
  notes: EncryptedNotePayload[];
  lastSyncTimestamp?: number;
}

export interface SyncPushResponse {
  success: boolean;
  savedCount: number;
  serverSyncTimestamp: number;
}

export interface SyncPullResponse {
  notes: EncryptedNotePayload[];
  serverSyncTimestamp: number;
}
