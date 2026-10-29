import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { inferRoute } from './routes/infer';
import { createSlidingWindowRateLimiter } from './middleware/rateLimiter';

// Node.js 기본 내장 환경변수 로더 (현재 디렉터리 및 루트 .env 자동 로드)
try {
  process.loadEnvFile?.('.env');
} catch {}
try {
  process.loadEnvFile?.('../../.env');
} catch {}

export const app = new Hono();

// 1. CORS 미들웨어 (프론트엔드 연동)
app.use(
  '*',
  cors({
    origin: (origin) => origin || '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
);

// 2. IP당 일일 호출 제한 (In-Memory Sliding Window Rate Limiter)
app.use('/api/*', createSlidingWindowRateLimiter({ windowMs: 24 * 60 * 60 * 1000, maxRequests: 100 }));

// 3. 헬스 체크
app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));

// 4. 추론 라우트 마운트
app.route('/api/infer', inferRoute);

// Node.js 환경에서 직접 실행 시 서버 구동
const port = Number(process.env.PORT) || 8787;

if (process.env.NODE_ENV !== 'test') {
  serve({ fetch: app.fetch, port }, (info) => {
    // eslint-disable-next-line no-console
    console.log(`[It!note Server] Running on http://localhost:${info.port}`);
  });
}
