import type { EncryptedNotePayload } from '@itnote/shared';

const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH_BITS = 256;
const IV_LENGTH_BYTES = 12;
const SALT_LENGTH_BYTES = 16;

/**
 * 환경 호환 Base64 인코더
 */
export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * 환경 호환 Base64 디코더
 */
export function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Web Crypto API 인스턴스 획득
 */
function getSubtleCrypto(): SubtleCrypto {
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    return window.crypto.subtle;
  }
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    return globalThis.crypto.subtle;
  }
  throw new Error('Web Crypto API (subtle) is not supported in this runtime environment');
}

/**
 * PBKDF2-HMAC-SHA256 기반 AES-256-GCM 키 유도
 */
export async function deriveKeyFromPassphrase(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const subtle = getSubtleCrypto();
  const enc = new TextEncoder();
  const baseKey = await subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: KEY_LENGTH_BITS },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * 확정 노트 본문을 AES-256-GCM으로 클라이언트 로컬 암호화
 */
export async function encryptNoteText(
  plaintext: string,
  passphrase: string,
  noteId = `note-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
): Promise<EncryptedNotePayload> {
  const subtle = getSubtleCrypto();
  const enc = new TextEncoder();

  const salt = new Uint8Array(SALT_LENGTH_BYTES);
  const iv = new Uint8Array(IV_LENGTH_BYTES);
  (globalThis.crypto || window.crypto).getRandomValues(salt);
  (globalThis.crypto || window.crypto).getRandomValues(iv);

  const key = await deriveKeyFromPassphrase(passphrase, salt);
  const ciphertextBuffer = await subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    enc.encode(plaintext) as unknown as BufferSource
  );

  return {
    noteId,
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
    ciphertext: bytesToBase64(new Uint8Array(ciphertextBuffer)),
    updatedAt: Date.now(),
    version: 1,
  };
}

/**
 * 암호화된 노트를 복호화 (비밀번호 불일치 시 예외 발생)
 */
export async function decryptNoteText(payload: EncryptedNotePayload, passphrase: string): Promise<string> {
  const subtle = getSubtleCrypto();
  const salt = base64ToBytes(payload.salt);
  const iv = base64ToBytes(payload.iv);
  const ciphertext = base64ToBytes(payload.ciphertext);

  const key = await deriveKeyFromPassphrase(passphrase, salt);

  try {
    const decryptedBuffer = await subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      key,
      ciphertext as unknown as BufferSource
    );
    return new TextDecoder().decode(decryptedBuffer);
  } catch (err) {
    throw new Error('E2EE Decryption Failed: Invalid passphrase or corrupted ciphertext');
  }
}
