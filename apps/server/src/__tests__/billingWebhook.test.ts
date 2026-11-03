import { describe, it, expect } from 'vitest';
import { app } from '../app';

describe('Billing & Webhook Idempotency Integration', () => {
  it('POST /api/billing/prepare — 주문 준비 시 orderId와 정가(9,900원)가 발급된다', async () => {
    const res = await app.request('/api/billing/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.orderId).toBeDefined();
    expect(data.amount).toBe(9900);
    expect(data.orderName).toContain('Pro');
  });

  it('POST /api/billing/confirm — 클라이언트 금액 위변조 시 400 AMOUNT_MISMATCH로 방어한다', async () => {
    // 1. 주문 준비 (정가 9,900원)
    const prepRes = await app.request('/api/billing/prepare', { method: 'POST' });
    const { orderId } = await prepRes.json();

    // 2. 공격자가 100원으로 변조하여 승인 요청
    const tamperedRes = await app.request('/api/billing/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentKey: 'mock_toss_tampered_key',
        orderId,
        amount: 100, // 위변조 시도
      }),
    });

    expect(tamperedRes.status).toBe(400);
    const errData = await tamperedRes.json();
    expect(errData.code).toBe('AMOUNT_MISMATCH');
    expect(errData.expected).toBe(9900);
    expect(errData.received).toBe(100);
  });

  it('POST /api/billing/confirm — 정상 금액 승인 시 Pro 멤버십이 활성화된다', async () => {
    const loginRes = await app.request('/api/auth/demo', { method: 'POST' });
    const { session } = await loginRes.json();
    const authHeaders = { Cookie: `itnote_session=${session.sessionId}`, 'Content-Type': 'application/json' };

    // 1. 주문 준비
    const prepRes = await app.request('/api/billing/prepare', { method: 'POST', headers: authHeaders });
    const { orderId, amount } = await prepRes.json();

    // 2. 정상 승인
    const confirmRes = await app.request('/api/billing/confirm', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        paymentKey: 'mock_toss_valid_key',
        orderId,
        amount,
      }),
    });

    expect(confirmRes.status).toBe(200);
    const confirmData = await confirmRes.json();
    expect(confirmData.success).toBe(true);
    expect(confirmData.plan).toBe('pro');

    // 3. 결제 상태 조회 검증
    const statusRes = await app.request('/api/billing/status', { headers: authHeaders });
    const statusData = await statusRes.json();
    expect(statusData.status.plan).toBe('pro');
    expect(statusData.status.isActive).toBe(true);

    // 4. 결제 취소 및 전액 환불 요청 검증
    const refundRes = await app.request('/api/billing/refund', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        orderId,
        cancelReason: '단순 변심 테스트 환불',
      }),
    });
    expect(refundRes.status).toBe(200);
    const refundData = await refundRes.json();
    expect(refundData.success).toBe(true);
    expect(refundData.plan).toBe('free');

    // 5. 환불 후 상태 조회 시 Free 플랜 원복 확인
    const postRefundStatusRes = await app.request('/api/billing/status', { headers: authHeaders });
    const postRefundData = await postRefundStatusRes.json();
    expect(postRefundData.status.plan).toBe('free');
    expect(postRefundData.status.status).toBe('REFUNDED');
  });

  it('POST /api/billing/webhook — 동일한 Idempotency Key 중복 수신 시 멱등성을 방어한다', async () => {
    const idempotencyKey = `idemp_evt_${Date.now()}_99`;
    const webhookPayload = {
      eventType: 'PAYMENT_STATUS_CHANGED',
      orderId: 'order_test_webhook_01',
      status: 'DONE',
      amount: 9900,
    };

    // 1차 웹훅 전송
    const res1 = await app.request('/api/billing/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(webhookPayload),
    });

    expect(res1.status).toBe(200);
    const data1 = await res1.json();
    expect(data1.success).toBe(true);
    expect(data1.idempotent).toBe(false); // 첫 수신 처리

    // 2차 동일 웹훅 재전송 (네트워크 재시도 시뮬레이션)
    const res2 = await app.request('/api/billing/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(webhookPayload),
    });

    expect(res2.status).toBe(200);
    const data2 = await res2.json();
    expect(data2.success).toBe(true);
    expect(data2.idempotent).toBe(true); // 멱등성 캐시 히트 (중복 결제/중복 처리 차단)
    expect(data2.message).toContain('Already processed');
  });
});
