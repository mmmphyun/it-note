import { describe, it, expect } from 'vitest';
import {
  encryptNoteText,
  decryptNoteText,
  bytesToBase64,
  base64ToBytes,
} from '../cryptoSync';

describe('Web Crypto E2EE Engine (cryptoSync)', () => {
  const masterSecret = 'user-super-secure-master-passphrase-2026';
  const sampleNote = '가상 DOM 없는 Svelte 5와 Hono 백엔드로 E2EE 모노레포 구축 완료';

  it('Base64 인코더/디코더가 바이너리 데이터를 손실 없이 복원해야 한다', () => {
    const raw = new Uint8Array([0, 15, 255, 128, 42, 73, 200]);
    const b64 = bytesToBase64(raw);
    const restored = base64ToBytes(b64);

    expect(Array.from(restored)).toEqual(Array.from(raw));
  });

  it('올바른 마스터 비밀키로 평문 텍스트를 정확하게 암호화하고 복호화해야 한다', async () => {
    const encrypted = await encryptNoteText(sampleNote, masterSecret, 'note-101');

    expect(encrypted.noteId).toBe('note-101');
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.salt).toBeDefined();
    expect(encrypted.ciphertext).toBeDefined();
    expect(encrypted.ciphertext).not.toBe(sampleNote);

    const decrypted = await decryptNoteText(encrypted, masterSecret);
    expect(decrypted).toBe(sampleNote);
  });

  it('잘못된 마스터 비밀키로 복호화 시도 시 예외를 발생시키고 평문 노출을 차단해야 한다', async () => {
    const encrypted = await encryptNoteText(sampleNote, masterSecret);
    const wrongSecret = 'attacker-or-wrong-passphrase';

    await expect(decryptNoteText(encrypted, wrongSecret)).rejects.toThrow(
      'E2EE Decryption Failed'
    );
  });

  it('동일한 평문이라도 매번 무작위 Salt 및 IV가 생성되어 암호문이 달라져야 한다', async () => {
    const enc1 = await encryptNoteText(sampleNote, masterSecret);
    const enc2 = await encryptNoteText(sampleNote, masterSecret);

    expect(enc1.salt).not.toBe(enc2.salt);
    expect(enc1.iv).not.toBe(enc2.iv);
    expect(enc1.ciphertext).not.toBe(enc2.ciphertext);

    // 그러나 둘 다 동일한 키로 정상 복호화 가능해야 함
    expect(await decryptNoteText(enc1, masterSecret)).toBe(sampleNote);
    expect(await decryptNoteText(enc2, masterSecret)).toBe(sampleNote);
  });

  it('암호문이 1바이트라도 변조되면 GCM 무결성 검증 실패로 복호화를 거부해야 한다', async () => {
    const encrypted = await encryptNoteText(sampleNote, masterSecret);
    const bytes = base64ToBytes(encrypted.ciphertext);
    // 첫 바이트 비트 반전
    bytes[0] = bytes[0] ^ 0xff;
    const tamperedPayload = {
      ...encrypted,
      ciphertext: bytesToBase64(bytes),
    };

    await expect(decryptNoteText(tamperedPayload, masterSecret)).rejects.toThrow(
      'E2EE Decryption Failed'
    );
  });
});
