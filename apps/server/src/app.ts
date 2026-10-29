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
