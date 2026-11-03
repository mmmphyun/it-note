import { Hono } from 'hono';
import type { BillingStatus, PaymentConfirmRequest } from '@itnote/shared';
import { extractSessionId, getSession } from './auth';

export const billingRoute = new Hono();

// 주문 금액 위변조 방어용 사전 등록 스토어 (In-Memory)
interface PreparedOrder {
  orderId: string;
  userId: string;
  amount: number;
  plan: 'pro';
  createdAt: number;
}

// 사용자별 결제 상태 스토어 (In-Memory)
const userBillingStore = new Map<string, BillingStatus>();
const preparedOrders = new Map<string, PreparedOrder>();

// Webhook 멱등성(Idempotency) 방어 캐시 스토어 (In-Memory)
interface ProcessedWebhookEvent {
  idempotencyKey: string;
  eventType: string;
  processedAt: number;
  result: any;
}
const webhookIdempotencyCache = new Map<string, ProcessedWebhookEvent>();

const PRO_PLAN_PRICE = 9900; // It!note Pro 월간 정가 9,900원

function getUserId(c: any): string {
  const sessionId = extractSessionId(c);
  const session = getSession(sessionId);
  return session ? session.user.id : 'anonymous-session';
}

/**
 * 1. 결제 준비 (POST /api/billing/prepare)
 * 클라이언트 결제창 띄우기 전 금액 및 주문번호 사전 등록 (위변조 방어 기준)
 */
billingRoute.post('/prepare', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json().catch(() => ({}));
  const orderId = body.orderId || `order_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const amount = PRO_PLAN_PRICE;

  preparedOrders.set(orderId, {
    orderId,
    userId,
    amount,
    plan: 'pro',
    createdAt: Date.now(),
  });

  return c.json({
    orderId,
    amount,
    orderName: '잇적(It!note) Pro 월간 구독',
    success: true,
  });
});

/**
 * 2. 결제 승인 검증 (POST /api/billing/confirm)
 * 클라이언트 결제창 완료 후 전달받은 paymentKey, orderId, amount 위변조 검증
 */
billingRoute.post('/confirm', async (c) => {
  const userId = getUserId(c);
  const body = (await c.req.json().catch(() => null)) as PaymentConfirmRequest | null;

  if (!body || !body.orderId || !body.amount || !body.paymentKey) {
    return c.json({ error: 'orderId, amount, paymentKey are required' }, 400);
  }

  // 1) 사전 등록 주문 존재 여부 확인
  const prepared = preparedOrders.get(body.orderId);
  if (!prepared) {
    return c.json({ error: 'Order not found or expired', code: 'INVALID_ORDER' }, 400);
  }

  // 2) 금액 위변조 검증 (클라이언트 변조 방어 핵심)
  if (prepared.amount !== body.amount) {
    return c.json(
      {
        error: 'Payment amount mismatch. Possible tampering detected.',
        expected: prepared.amount,
        received: body.amount,
        code: 'AMOUNT_MISMATCH',
      },
      400
    );
  }

  // 3) 실제 토스페이먼츠 시크릿 키가 환경변수에 있을 경우 외부 PG 승인 호출
  const tossSecretKey = process.env.TOSS_SECRET_KEY;
  if (tossSecretKey && !body.paymentKey.startsWith('mock_')) {
    try {
      const basicAuth = Buffer.from(`${tossSecretKey}:`).toString('base64');
      const response = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          paymentKey: body.paymentKey,
          orderId: body.orderId,
          amount: body.amount,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return c.json({ error: 'PG 승인 실패', details: errorData }, 400);
      }
    } catch (err: any) {
      return c.json({ error: 'PG 승인 통신 오류', message: err.message }, 502);
    }
  }

  // 4) 결제 성공 처리 및 Pro 상태 갱신
  const status: BillingStatus = {
    plan: 'pro',
    isActive: true,
    status: 'PAID',
    orderId: body.orderId,
    paymentKey: body.paymentKey,
    method: '토스페이먼츠 (테스트 카드)',
    paidAt: Date.now(),
    amount: body.amount,
  };
  userBillingStore.set(userId, status);
  preparedOrders.delete(body.orderId);

  return c.json({
    success: true,
    orderId: body.orderId,
    plan: 'pro',
    paidAt: status.paidAt,
    amount: body.amount,
    paymentKey: status.paymentKey,
    method: status.method,
  });
});

/**
 * 3. 결제 취소 및 전액 환불 (POST /api/billing/refund)
 */
billingRoute.post('/refund', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json().catch(() => null);

  const currentStatus = userBillingStore.get(userId);
  if (!currentStatus || currentStatus.plan !== 'pro' || !currentStatus.orderId) {
    return c.json({ error: 'No active paid subscription found', code: 'NO_ACTIVE_PAYMENT' }, 400);
  }

  const cancelReason = (body && body.cancelReason) || '고객 단순 변심 및 테스트 환불 요청';
  const paymentKey = currentStatus.paymentKey;

  // 실제 토스페이먼츠 시크릿 키가 있을 경우 결제 취소 API 호출
  const tossSecretKey = process.env.TOSS_SECRET_KEY;
  if (tossSecretKey && paymentKey && !paymentKey.startsWith('mock_')) {
    try {
      const basicAuth = Buffer.from(`${tossSecretKey}:`).toString('base64');
      const response = await fetch(`https://api.tosspayments.com/v1/payments/${paymentKey}/cancel`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ cancelReason }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return c.json({ error: 'PG사 결제 취소 거절', details: errorData }, 400);
      }
    } catch (err: any) {
      return c.json({ error: 'PG 취소 통신 오류', message: err.message }, 502);
    }
  }

  // 환불 완료 처리 및 Free 플랜으로 원복
  const refundedStatus: BillingStatus = {
    ...currentStatus,
    plan: 'free',
    isActive: false,
    status: 'REFUNDED',
    refundedAt: Date.now(),
    cancelReason,
  };
  userBillingStore.set(userId, refundedStatus);

  return c.json({
    success: true,
    orderId: currentStatus.orderId,
    plan: 'free',
    refundedAt: refundedStatus.refundedAt,
    cancelReason,
    message: '결제가 성공적으로 취소 및 전액 환불 처리되었습니다.',
  });
});

/**
 * 3. PG Webhook 수신 및 멱등성(Idempotency) 방어 (POST /api/billing/webhook)
 */
billingRoute.post('/webhook', async (c) => {
  const idempotencyKey =
    c.req.header('idempotency-key') ||
    c.req.header('x-idempotency-key') ||
    c.req.header('x-webhook-id');

  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json({ error: 'Invalid webhook payload' }, 400);
  }

  // 멱등 키 결정: 헤더 우선, 없을 경우 페이로드의 paymentKey 또는 transactionId
  const effectiveKey =
    idempotencyKey ||
    body.paymentKey ||
    body.transactionId ||
    body.data?.paymentKey ||
    body.data?.orderId;

  if (effectiveKey && webhookIdempotencyCache.has(effectiveKey)) {
    // 멱등성 방어: 이미 처리된 동일 웹훅은 중복 처리 없이 기존 성공 결과 반환
    const cached = webhookIdempotencyCache.get(effectiveKey)!;
    return c.json({
      success: true,
      idempotent: true,
      message: 'Already processed webhook event',
      cachedResult: cached.result,
    });
  }

  // 웹훅 비즈니스 로직 처리 (결제 완료 이벤트 등)
  const eventType = body.eventType || body.type || 'PAYMENT_STATUS_CHANGED';
  const orderId = body.orderId || body.data?.orderId;
  const status = body.status || body.data?.status;

  const result = {
    eventType,
    orderId,
    status: status || 'DONE',
    processedAt: Date.now(),
  };

  if (effectiveKey) {
    webhookIdempotencyCache.set(effectiveKey, {
      idempotencyKey: effectiveKey,
      eventType,
      processedAt: Date.now(),
      result,
    });
  }

  return c.json({
    success: true,
    idempotent: false,
    result,
  });
});

/**
 * 4. 현재 사용자의 결제 상태 조회 (GET /api/billing/status)
 */
billingRoute.get('/status', (c) => {
  const userId = getUserId(c);
  const status = userBillingStore.get(userId) || {
    plan: 'free',
    isActive: false,
  };
  return c.json({ status });
});
