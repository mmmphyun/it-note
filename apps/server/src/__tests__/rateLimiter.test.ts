import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { createSlidingWindowRateLimiter } from '../middleware/rateLimiter';

describe('createSlidingWindowRateLimiter Middleware', () => {
  it('허용 한도 이내의 요청은 정상적으로 통과되어야 한다', async () => {
    const testApp = new Hono();
    testApp.use('/test', createSlidingWindowRateLimiter({ windowMs: 10000, maxRequests: 3 }));
    testApp.get('/test', (c) => c.json({ ok: true }));

    for (let i = 0; i < 3; i++) {
      const res = await testApp.request('/test', {
        headers: { 'X-Forwarded-For': '192.168.1.1' },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    }
  });

  it('한도(maxRequests) 초과 시 429와 Retry-After 헤더를 반환해야 한다', async () => {
    const testApp = new Hono();
    testApp.use('/test', createSlidingWindowRateLimiter({ windowMs: 60000, maxRequests: 2 }));
    testApp.get('/test', (c) => c.json({ ok: true }));

    // 1, 2차 호출 (허용)
    await testApp.request('/test', { headers: { 'X-Forwarded-For': '10.0.0.1' } });
    await testApp.request('/test', { headers: { 'X-Forwarded-For': '10.0.0.1' } });

    // 3차 호출 (한도 초과 차단)
    const blockedRes = await testApp.request('/test', {
      headers: { 'X-Forwarded-For': '10.0.0.1' },
    });

    expect(blockedRes.status).toBe(429);
    expect(blockedRes.headers.get('Retry-After')).toBeDefined();
    const json = await blockedRes.json();
    expect(json.error).toBe('Rate limit exceeded');
    expect(json.retryAfter).toBeGreaterThan(0);
  });

  it('서로 다른 IP는 독립적인 호출 한도 계량을 유지해야 한다', async () => {
    const testApp = new Hono();
    testApp.use('/test', createSlidingWindowRateLimiter({ windowMs: 60000, maxRequests: 1 }));
    testApp.get('/test', (c) => c.json({ ok: true }));

    // IP A 1차 호출 (성공)
    const resA1 = await testApp.request('/test', { headers: { 'X-Forwarded-For': '172.16.0.1' } });
    expect(resA1.status).toBe(200);

    // IP A 2차 호출 (차단)
    const resA2 = await testApp.request('/test', { headers: { 'X-Forwarded-For': '172.16.0.1' } });
    expect(resA2.status).toBe(429);

    // IP B 1차 호출 (IP A와 무관하게 정상 허용)
    const resB1 = await testApp.request('/test', { headers: { 'X-Forwarded-For': '172.16.0.2' } });
    expect(resB1.status).toBe(200);
  });

  it('슬라이딩 윈도우 시간 경과 후 만료된 타임스탬프가 수거되어 재호출이 가능해야 한다', async () => {
    const testApp = new Hono();
    // 50ms 초단기 윈도우 설정
    testApp.use('/test', createSlidingWindowRateLimiter({ windowMs: 50, maxRequests: 1 }));
    testApp.get('/test', (c) => c.json({ ok: true }));

    // 1차 호출
    const res1 = await testApp.request('/test', { headers: { 'X-Forwarded-For': '192.168.0.50' } });
    expect(res1.status).toBe(200);

    // 즉시 재호출 (차단)
    const resBlocked = await testApp.request('/test', { headers: { 'X-Forwarded-For': '192.168.0.50' } });
    expect(resBlocked.status).toBe(429);

    // 60ms 대기 후 윈도우 만료
    await new Promise((resolve) => setTimeout(resolve, 60));

    // 만료 후 재호출 (성공)
    const resRecovered = await testApp.request('/test', { headers: { 'X-Forwarded-For': '192.168.0.50' } });
    expect(resRecovered.status).toBe(200);
  });
});
