import { onRequest } from 'firebase-functions/v2/https';
import { getRequestListener } from '@hono/node-server';
import { app } from './app';

/**
 * Firebase Cloud Functions v2 Hono Entrypoint
 * - 리전: 서울 (asia-northeast3)
 * - 과금 방지 하드가드: maxInstances: 2
 * - 시크릿 매니저: GEMINI_API_KEY 안전 주입
 */
export const api = onRequest(
  {
    region: 'asia-northeast3',
    maxInstances: 2,
    secrets: ['GEMINI_API_KEY'],
    cors: false,
    invoker: 'public',
  },
  getRequestListener(app.fetch)
);
