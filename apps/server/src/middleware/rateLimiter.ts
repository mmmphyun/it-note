import type { MiddlewareHandler } from 'hono';

// ponytail: in-memory sliding window map, distributed redis if scaling multi-instance
export interface RateLimiterOptions {
  windowMs?: number; // 기본 24시간
  maxRequests?: number; // 기본 100회
}

export function createSlidingWindowRateLimiter(options: RateLimiterOptions = {}): MiddlewareHandler {
  const windowMs = options.windowMs ?? 24 * 60 * 60 * 1000;
  const maxRequests = options.maxRequests ?? 100;
  const ipLogs = new Map<string, number[]>();

  return async (c, next) => {
    const forwardedFor = c.req.header('x-forwarded-for');
    const realIp = c.req.header('x-real-ip');
    const ip = (forwardedFor ? forwardedFor.split(',')[0].trim() : null) || realIp || '127.0.0.1';

    const now = Date.now();
    const timestamps = ipLogs.get(ip) ?? [];

    // 윈도우 이전 타임스탬프 제거
    const windowStart = now - windowMs;
    const validTimestamps = timestamps.filter((t) => t > windowStart);

    if (validTimestamps.length >= maxRequests) {
      const oldest = validTimestamps[0];
      const retryAfterSec = Math.ceil((oldest + windowMs - now) / 1000);
      c.header('Retry-After', String(Math.max(1, retryAfterSec)));
      return c.json(
        {
          error: 'Rate limit exceeded',
          message: '일일 최대 호출 한도를 초과했습니다.',
          retryAfter: retryAfterSec,
        },
        429
      );
    }

    validTimestamps.push(now);
    ipLogs.set(ip, validTimestamps);

    await next();
  };
}
