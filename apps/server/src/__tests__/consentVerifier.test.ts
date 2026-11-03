import { describe, it, expect } from 'vitest';
import { app } from '../app';
import { evaluateTextSentiment, verifyConsent } from '../services/consentVerifier';

describe('consentVerifier: 필기 서약 동의 실시간 판정 검증', () => {
  it('동의, 네, ㅇㅇ, yes 등 긍정적 답변을 AGREED로 정확히 판별해야 한다', () => {
    const affirmativeSamples = ['동의', '동의함', '동의합니다', '동의해요', '네', '예', 'ㅇㅇ', 'yes', 'ok'];

    for (const text of affirmativeSamples) {
      const result = evaluateTextSentiment(text);
      expect(result.isAgreed, `Failed for text: ${text}`).toBe(true);
      expect(result.sentiment).toBe('AGREED');
    }
  });

  it('거부, 아니오, ㄴㄴ, ㄴ, no 등 부정적 답변을 DISAGREED로 판별하고 isAgreed를 false로 설정해야 한다', () => {
    const negativeSamples = ['거부', '거절', '아니오', '아니요', '싫어요', 'ㄴㄴ', 'ㄴ', 'no'];

    for (const text of negativeSamples) {
      const result = evaluateTextSentiment(text);
      expect(result.isAgreed, `Failed for text: ${text}`).toBe(false);
      expect(result.sentiment).toBe('DISAGREED');
    }
  });

  it('무관한 단어나 낙서 등은 UNCLEAR로 분류하고 isAgreed를 false로 설정해야 한다', () => {
    const unclearSamples = ['피자', '12345', '블라블라'];

    for (const text of unclearSamples) {
      const result = evaluateTextSentiment(text);
      expect(result.isAgreed, `Failed for text: ${text}`).toBe(false);
      expect(result.sentiment).toBe('UNCLEAR');
    }
  });

  it('획수가 0인 경우 필기 내용 없음으로 UNCLEAR를 반환해야 한다', async () => {
    const result = await verifyConsent({
      strokeMetadata: { strokeCount: 0 },
    });
    expect(result.isAgreed).toBe(false);
    expect(result.sentiment).toBe('UNCLEAR');
  });

  it('POST /api/auth/verify-consent 엔드포인트를 통해 실시간 검증 결과를 정상 수신해야 한다', async () => {
    const res = await app.request('/api/auth/verify-consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rawTextInput: '동의함',
        strokeMetadata: { strokeCount: 8, avgSpeed: 0.35 },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isAgreed).toBe(true);
    expect(body.sentiment).toBe('AGREED');
    expect(body.recognizedText).toBe('동의함');
  });

  it('외부 AI가 연결되지 않은 임의의 획 입력은 임의로 동의 처리하지 않고 UNCLEAR를 반환해야 한다', async () => {
    const origKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const result = await verifyConsent({
        strokeMetadata: { strokeCount: 3 },
      });
      expect(result.isAgreed).toBe(false);
      expect(result.sentiment).toBe('UNCLEAR');
    } finally {
      process.env.GEMINI_API_KEY = origKey;
    }
  });
});
