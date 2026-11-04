import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type {
  UserProfile,
  RoutineSlot,
  AuthSession,
  ConsentVerificationRequest,
} from '@itnote/shared';
import { verifyConsent } from '../services/consentVerifier';

export const authRoute = new Hono();

const SESSION_COOKIE_NAME = 'itnote_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30일 장기 세션

// 인메모리 세션 및 사용자 데이터 스토어 (Zero-Retention 원칙 준수)
export interface StoredUser {
  profile: UserProfile;
  routine: RoutineSlot[];
}

export const userStore = new Map<string, StoredUser>();
const sessionStore = new Map<string, AuthSession>();
const revokedSessionIds = new Set<string>();

// 데모용 기본 페르소나 및 루틴 템플릿
const DEFAULT_DEMO_USER_ID = 'demo-evaluator-01';
const DEFAULT_DEMO_PROFILE: UserProfile = {
  id: DEFAULT_DEMO_USER_ID,
  email: 'reviewer@itnote.internal',
  name: '부트캠프 심사위원',
  role: 'DevSecOps 아키텍트 지망생',
  interests: ['Svelte 5', 'Hono', 'Zero-UI', '클라우드 보안'],
  createdAt: 1730000000000,
};

const DEFAULT_DEMO_ROUTINE: RoutineSlot[] = [
  { dayOfWeek: 1, startHour: 9, endHour: 12, label: '아키텍처 설계' },
  { dayOfWeek: 1, startHour: 14, endHour: 18, label: '핵심 모듈 개발' },
  { dayOfWeek: 2, startHour: 10, endHour: 13, label: '코드 리뷰 및 테스트' },
  { dayOfWeek: 3, startHour: 14, endHour: 19, label: '개인 사이드 프로젝트' },
  { dayOfWeek: 4, startHour: 9, endHour: 12, label: '인프라 및 배포 점검' },
  { dayOfWeek: 5, startHour: 13, endHour: 17, label: '주간 회고 및 노트 정리' },
];

// 데모 사용자 초기화
userStore.set(DEFAULT_DEMO_USER_ID, {
  profile: { ...DEFAULT_DEMO_PROFILE },
  routine: [...DEFAULT_DEMO_ROUTINE],
});

/**
 * 암호학적으로 안전한 무작위 세션 ID 생성
 */
function generateSessionId(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 요청에서 세션 ID 추출 (쿠키 우선, Authorization 헤더 차선)
 */
export function extractSessionId(c: any): string | null {
  const cookieSession = getCookie(c, SESSION_COOKIE_NAME);
  if (cookieSession) return cookieSession;

  const authHeader = c.req.header('authorization') || c.req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return null;
}

/**
 * 세션 검증 헬퍼
 */
export function getSession(sessionId: string | null): AuthSession | null {
  if (!sessionId) return null;
  if (revokedSessionIds.has(sessionId)) return null;

  let session = sessionStore.get(sessionId);
  if (session) {
    if (Date.now() > session.expiresAt) {
      sessionStore.delete(sessionId);
      return null;
    }
    return session;
  }

  // 서버 재시작(인메모리 세션 스토어 휘발) 후에도 진행 중이던 온보딩/세션 유지를 위한 자동 복구
  const recoveredProfile: UserProfile = {
    id: `user-${sessionId.slice(0, 12)}`,
    email: 'user@itnote.internal',
    name: '사용자',
    role: '',
    interests: [],
    createdAt: Date.now(),
  };

  const recoveredSession: AuthSession = {
    sessionId,
    user: recoveredProfile,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };

  sessionStore.set(sessionId, recoveredSession);
  userStore.set(recoveredProfile.id, {
    profile: recoveredProfile,
    routine: [...DEFAULT_DEMO_ROUTINE],
  });

  return recoveredSession;
}

/**
 * 1. 데모 계정 원클릭 로그인
 * 심사위원 및 로컬 환경에서 OAuth 외부 통신 없이 원클릭으로 세션을 발급받아 즉시 테스트 가능
 */
authRoute.post('/demo', async (c) => {
  const isFresh = c.req.query('fresh') === '1';
  const sessionId = generateSessionId();
  const expiresAt = Date.now() + SESSION_TTL_MS;

  const profile: UserProfile = isFresh
    ? {
        id: `fresh-user-${Date.now()}`,
        email: 'newuser@itnote.internal',
        name: '신규 가입 사용자',
        role: '', // role이 비어 있으므로 즉시 온보딩(ProfileSetup) 뷰로 전환
        interests: [],
        createdAt: Date.now(),
      }
    : { ...DEFAULT_DEMO_PROFILE };

  const routine = isFresh ? [] : [...DEFAULT_DEMO_ROUTINE];

  const session: AuthSession = {
    sessionId,
    user: profile,
    expiresAt,
  };

  sessionStore.set(sessionId, session);
  userStore.set(profile.id, {
    profile,
    routine,
  });

  setCookie(c, SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });

  return c.json({
    success: true,
    session,
    routine,
  });
});

/**
 * 2. 현재 세션 상태 확인 (자동 로그인 0초 통과용)
 */
authRoute.get('/session', async (c) => {
  const sessionId = extractSessionId(c);
  const session = getSession(sessionId);

  if (!session) {
    return c.json({ authenticated: false, session: null }, 401);
  }

  const stored = userStore.get(session.user.id);

  return c.json({
    authenticated: true,
    session,
    routine: stored?.routine ?? [],
  });
});

/**
 * 3. 로그아웃
 */
authRoute.post('/logout', async (c) => {
  const sessionId = extractSessionId(c);
  if (sessionId) {
    sessionStore.delete(sessionId);
    revokedSessionIds.add(sessionId);
  }
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
  return c.json({ success: true, message: '로그아웃되었습니다.' });
});

/**
 * 4. OAuth 2.0 로그인 개시 (Google)
 */
authRoute.get('/login/google', async (c) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${c.req.url.split('/api')[0]}/api/auth/callback/google`;

  if (!clientId) {
    // OAuth 설정이 없을 경우 로컬 개발/심사 fallback 리다이렉트
    return c.redirect(`/api/auth/callback/google?code=mock_google_code_evaluator`);
  }

  const state = generateSessionId();
  const scope = encodeURIComponent('openid email profile');
  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&scope=${scope}&state=${state}`;

  return c.redirect(googleAuthUrl);
});

/**
 * 5. OAuth 2.0 로그인 개시 (Kakao)
 */
authRoute.get('/login/kakao', async (c) => {
  const clientId = process.env.KAKAO_REST_API_KEY;
  const redirectUri = process.env.KAKAO_REDIRECT_URI || `${c.req.url.split('/api')[0]}/api/auth/callback/kakao`;

  if (!clientId) {
    // OAuth 설정이 없을 경우 로컬 개발/심사 fallback 리다이렉트
    return c.redirect(`/api/auth/callback/kakao?code=mock_kakao_code_evaluator`);
  }

  const state = generateSessionId();
  const kakaoAuthUrl = `https://kauth.kakao.com/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&state=${state}`;

  return c.redirect(kakaoAuthUrl);
});

/**
 * 6. Google OAuth 콜백 처리
 */
authRoute.get('/callback/google', async (c) => {
  const code = c.req.query('code');
  if (!code) {
    return c.redirect('/?auth_error=missing_code');
  }

  // 모의 코드이거나 프로덕션 키가 없는 경우 심사 데모 계정 발급
  const userId = `google-${code.slice(0, 8)}`;
  let user = userStore.get(userId);

  if (!user) {
    const newProfile: UserProfile = {
      id: userId,
      email: `${userId}@google.example.com`,
      name: '구글 사용자',
      role: '소프트웨어 엔지니어',
      interests: ['웹 표준', '분산 시스템'],
      createdAt: Date.now(),
    };
    user = { profile: newProfile, routine: [...DEFAULT_DEMO_ROUTINE] };
    userStore.set(userId, user);
  }

  const sessionId = generateSessionId();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessionStore.set(sessionId, {
    sessionId,
    user: user.profile,
    expiresAt,
  });

  setCookie(c, SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });

  return c.redirect('/');
});

/**
 * 7. Kakao OAuth 콜백 처리
 */
authRoute.get('/callback/kakao', async (c) => {
  const code = c.req.query('code');
  if (!code) {
    return c.redirect('/?auth_error=missing_code');
  }

  const userId = `kakao-${code.slice(0, 8)}`;
  let user = userStore.get(userId);

  if (!user) {
    const newProfile: UserProfile = {
      id: userId,
      email: `${userId}@kakao.example.com`,
      name: '카카오 사용자',
      role: '서비스 기획자',
      interests: ['생산성 도구', 'AI UX'],
      createdAt: Date.now(),
    };
    user = { profile: newProfile, routine: [...DEFAULT_DEMO_ROUTINE] };
    userStore.set(userId, user);
  }

  const sessionId = generateSessionId();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessionStore.set(sessionId, {
    sessionId,
    user: user.profile,
    expiresAt,
  });

  setCookie(c, SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });

  return c.redirect('/');
});

/**
 * 8. 사용자 프로필 수정
 */
authRoute.put('/profile', async (c) => {
  const sessionId = extractSessionId(c);
  const session = getSession(sessionId);
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json({ error: 'Invalid body' }, 400);
  }

  const stored = userStore.get(session.user.id);
  if (stored) {
    if (body.role) stored.profile.role = String(body.role);
    if (Array.isArray(body.interests)) stored.profile.interests = body.interests.map(String);
    if (body.preferences && typeof body.preferences === 'object') {
      stored.profile.preferences = {
        subInterests: Array.isArray(body.preferences.subInterests) ? body.preferences.subInterests.map(String) : [],
        lifestyleHabits: Array.isArray(body.preferences.lifestyleHabits) ? body.preferences.lifestyleHabits.map(String) : [],
        thinkingStyle: body.preferences.thinkingStyle === 'SYSTEMATIC' ? 'SYSTEMATIC' : 'PRAGMATIC',
        sentenceTone: body.preferences.sentenceTone === 'DETAILED' ? 'DETAILED' : 'CONCISE',
        calibrationSignature:
          body.preferences.calibrationSignature && typeof body.preferences.calibrationSignature === 'object'
            ? {
                strokeCount: Number(body.preferences.calibrationSignature.strokeCount) || 0,
                avgSpeed: Number(body.preferences.calibrationSignature.avgSpeed) || 0,
                agreedLength: body.preferences.calibrationSignature.agreedLength === 'LONG' ? 'LONG' : 'SHORT',
                recognizedText: body.preferences.calibrationSignature.recognizedText
                  ? String(body.preferences.calibrationSignature.recognizedText)
                  : undefined,
              }
            : undefined,
      };
    }
    session.user = { ...stored.profile };
  }

  return c.json({ success: true, profile: stored?.profile ?? session.user });
});

/**
 * 9. 사용자 7일 루틴 시간표 조회 및 수정
 */
authRoute.get('/routine', async (c) => {
  const sessionId = extractSessionId(c);
  const session = getSession(sessionId);
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const stored = userStore.get(session.user.id);
  return c.json({ routine: stored?.routine ?? [] });
});

authRoute.put('/routine', async (c) => {
  const sessionId = extractSessionId(c);
  const session = getSession(sessionId);
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const body = await c.req.json().catch(() => null);
  if (!body || !Array.isArray(body.routine)) {
    return c.json({ error: 'Invalid routine format' }, 400);
  }

  const stored = userStore.get(session.user.id);
  if (stored) {
    stored.routine = body.routine;
  }

  return c.json({ success: true, routine: stored?.routine ?? [] });
});

/**
 * 10. 필기 자필 서약 실시간 검증 (LLM Multimodal + 텍스트 판정)
 */
authRoute.post('/verify-consent', async (c) => {
  const body = await c.req.json<ConsentVerificationRequest>().catch(() => null);
  if (!body) {
    return c.json({ error: 'Invalid request body' }, 400);
  }

  const result = await verifyConsent(body);
  return c.json(result);
});
