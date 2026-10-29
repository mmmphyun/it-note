import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { inferRoute } from './routes/infer';
import { createSlidingWindowRateLimiter } from './middleware/rateLimiter';

// Node.js 기본 내장 환경변수 로더 (로컬 환경 지원)
try {
  process.loadEnvFile?.('.env');
} catch {}
try {
  process.loadEnvFile?.('../../.env');
} catch {}

export const app = new Hono();

const ALLOWED_ORIGINS = [
  'https://it-note-app.web.app',
  'https://it-note-app.firebaseapp.com',
  'http://localhost:5173',
  'http://localhost:8787',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:8787',
];

// 1. CORS 미들웨어 (프론트엔드 연동 및 비인가 도메인 차단)
app.use(
  '*',
  cors({
    origin: (origin) => {
      if (!origin) return '*';
      if (ALLOWED_ORIGINS.includes(origin)) return origin;
      return null;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
);

// 2. Cloud Run 직결 바이패스 방어 (Firebase Hosting 게이트웨이 경유 강제)
app.use('/api/infer', async (c, next) => {
  if (process.env.K_SERVICE || process.env.FUNCTION_TARGET) {
    const forwardedHost = c.req.header('x-forwarded-host') ?? '';
    const isHostingGateway =
      forwardedHost === 'it-note-app.web.app' ||
      forwardedHost === 'it-note-app.firebaseapp.com';

    if (!isHostingGateway) {
      return c.json(
        {
          error: 'Forbidden',
          message: 'Direct Cloud Run access is blocked. Requests must be routed through Firebase Hosting gateway.',
        },
        403
      );
    }
  }
  await next();
});

// 3. IP당 일일 호출 제한 (In-Memory Sliding Window Rate Limiter)
app.use('/api/*', createSlidingWindowRateLimiter({ windowMs: 24 * 60 * 60 * 1000, maxRequests: 100 }));

// 3. 헬스 체크
app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: Date.now(),
    host: c.req.header('host') ?? null,
    forwardedHost: c.req.header('x-forwarded-host') ?? null,
    forwardedFor: c.req.header('x-forwarded-for') ?? null,
  });
});

// 4. 추론 라우트 마운트
app.route('/api/infer', inferRoute);
