import { serve } from '@hono/node-server';
import { app } from './app';
import { preloadNeuralJevEngine } from './services/neuralJevEngine';

export { app };

const port = Number(process.env.PORT) || 8787;

if (process.env.NODE_ENV !== 'test') {
  serve({ fetch: app.fetch, port }, (info) => {
    // eslint-disable-next-line no-console
    console.log(`[It!note Server] Running on http://localhost:${info.port}`);
    // 기동 시 1회 메모리 프리로드 (preload=True)
    preloadNeuralJevEngine().catch((err) => {
      console.warn('[It!note Server] Preload warning:', err);
    });
  });
}
