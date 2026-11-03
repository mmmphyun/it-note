import { describe, it, expect } from 'vitest';
import { app } from '../app';

describe('Auth & Session Integration', () => {
  it('POST /api/auth/demo — 데모 계정 원클릭 로그인 시 세션과 쿠키를 정상 발급한다', async () => {
    const res = await app.request('/api/auth/demo', {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.session).toBeDefined();
    expect(data.session.user.role).toContain('DevSecOps');
    expect(Array.isArray(data.routine)).toBe(true);

    // Set-Cookie 헤더 확인
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain('itnote_session=');
    expect(setCookie).toContain('HttpOnly');
  });

  it('GET /api/auth/session — 쿠키나 토큰이 없으면 401을 반환한다', async () => {
    const res = await app.request('/api/auth/session');
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.authenticated).toBe(false);
  });

  it('GET /api/auth/session — 유효한 세션 쿠키 전달 시 인증에 성공한다', async () => {
    // 1. 데모 로그인으로 세션 생성
    const loginRes = await app.request('/api/auth/demo', { method: 'POST' });
    const loginData = await loginRes.json();
    const sessionId = loginData.session.sessionId;

    // 2. 세션 쿠키 전달하여 조회
    const sessionRes = await app.request('/api/auth/session', {
      headers: {
        Cookie: `itnote_session=${sessionId}`,
      },
    });

    expect(sessionRes.status).toBe(200);
    const sessionData = await sessionRes.json();
    expect(sessionData.authenticated).toBe(true);
    expect(sessionData.session.sessionId).toBe(sessionId);
    expect(sessionData.session.user.name).toBe('부트캠프 심사위원');
  });

  it('PUT /api/auth/profile & PUT /api/auth/routine — 세션 인증 후 프로필과 루틴을 수정한다', async () => {
    const loginRes = await app.request('/api/auth/demo', { method: 'POST' });
    const loginData = await loginRes.json();
    const sessionId = loginData.session.sessionId;
    const authHeaders = { Cookie: `itnote_session=${sessionId}`, 'Content-Type': 'application/json' };

    // 프로필 수정
    const profRes = await app.request('/api/auth/profile', {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        role: 'Svelte 5 Fullstack Lead',
        interests: ['Svelte 5', 'Hono', 'Vite'],
      }),
    });
    expect(profRes.status).toBe(200);
    const profData = await profRes.json();
    expect(profData.profile.role).toBe('Svelte 5 Fullstack Lead');

    // 루틴 수정
    const routineRes = await app.request('/api/auth/routine', {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        routine: [{ dayOfWeek: 3, startHour: 10, endHour: 18, label: '몰입 코딩' }],
      }),
    });
    expect(routineRes.status).toBe(200);
    const routineData = await routineRes.json();
    expect(routineData.routine.length).toBe(1);
    expect(routineData.routine[0].label).toBe('몰입 코딩');
  });

  it('POST /api/auth/logout — 로그아웃 시 세션이 파기된다', async () => {
    const loginRes = await app.request('/api/auth/demo', { method: 'POST' });
    const loginData = await loginRes.json();
    const sessionId = loginData.session.sessionId;

    const logoutRes = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: `itnote_session=${sessionId}` },
    });
    expect(logoutRes.status).toBe(200);

    // 로그아웃 후 조회 시 401 확인
    const checkRes = await app.request('/api/auth/session', {
      headers: { Cookie: `itnote_session=${sessionId}` },
    });
    expect(checkRes.status).toBe(401);
  });
});
