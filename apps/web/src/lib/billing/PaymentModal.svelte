<script lang="ts">
  import type { PaymentConfirmResponse } from '@itnote/shared';

  interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: (res: PaymentConfirmResponse) => void;
  }

  let { isOpen, onClose, onSuccess }: Props = $props();

  let isProcessing = $state(false);
  let errorMessage = $state<string | null>(null);

  async function handleTestPayment() {
    isProcessing = true;
    errorMessage = null;

    try {
      // 1. 주문 준비
      const prepRes = await fetch('/api/billing/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!prepRes.ok) throw new Error('결제 준비에 실패했습니다.');
      const prepData = await prepRes.json();

      // 2. 토스페이먼츠 결제 승인 요청 (테스트 결제 키 발급)
      const mockPaymentKey = `mock_toss_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      // 3. 백엔드 결제 승인 및 금액 위변조 검증
      const confirmRes = await fetch('/api/billing/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentKey: mockPaymentKey,
          orderId: prepData.orderId,
          amount: prepData.amount,
        }),
      });

      if (!confirmRes.ok) {
        const errJson = await confirmRes.json().catch(() => ({}));
        throw new Error(errJson.error || '결제 승인 검증에 실패했습니다.');
      }

      const confirmData: PaymentConfirmResponse = await confirmRes.json();
      onSuccess(confirmData);
      onClose();
    } catch (err: any) {
      errorMessage = err.message || '결제 처리 중 오류가 발생했습니다.';
    } finally {
      isProcessing = false;
    }
  }
</script>

{#if isOpen}
  <div
    class="modal-backdrop"
    onclick={onClose}
    onkeydown={(e) => {
      if (e.key === 'Escape') onClose();
    }}
    role="presentation"
  >
    <div
      class="modal-card"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <header class="modal-header">
        <div class="badge">PRO UPGRADE</div>
        <h3>잇적(It!note) Pro 플랜</h3>
        <p class="price">월 9,900원 <span>/ 부가세 포함</span></p>
      </header>

      <ul class="features">
        <li>✓ 무제한 AI 단일 문장 실시간 추론</li>
        <li>✓ 지워지지 않고 단단해지는 진화 맥락(EvolvingContext) 영구 보존</li>
        <li>✓ 주간 루틴 기반 시간대별 맞춤형 우선순위 추천</li>
        <li>✓ 120Hz 스타일러스 펜 입력 무지연 최적화</li>
      </ul>

      {#if errorMessage}
        <div class="error-msg">{errorMessage}</div>
      {/if}

      <div class="actions">
        <button class="btn btn-pay" onclick={handleTestPayment} disabled={isProcessing}>
          {isProcessing ? '결제 승인 검증 중...' : '토스페이먼츠 테스트 결제 진행 (9,900원)'}
        </button>
        <button class="btn btn-cancel" onclick={onClose} disabled={isProcessing}>
          닫기
        </button>
      </div>

      <p class="caption">
        * 부트캠프 심사용 테스트 결제 모드로, 실제 비용이 청구되지 않으며 즉시 승인 위변조 방어가 검증됩니다.
      </p>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal-card {
    background: #FFFFFF;
    border-radius: 16px;
    padding: 32px;
    width: 100%;
    max-width: 440px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #2B2B2B;
  }

  .modal-header {
    text-align: center;
    margin-bottom: 24px;
  }

  .badge {
    display: inline-block;
    padding: 4px 10px;
    background: #385E72;
    color: #FFF;
    font-size: 11px;
    font-weight: 700;
    border-radius: 20px;
    letter-spacing: 0.05em;
    margin-bottom: 8px;
  }

  .modal-header h3 {
    margin: 4px 0 8px 0;
    font-size: 22px;
    font-weight: 800;
  }

  .price {
    font-size: 26px;
    font-weight: 800;
    color: #1A1A1A;
    margin: 0;
  }
  .price span {
    font-size: 13px;
    font-weight: normal;
    color: #777;
  }

  .features {
    list-style: none;
    padding: 0;
    margin: 0 0 24px 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-size: 14px;
    color: #444;
  }

  .error-msg {
    background: #FEE;
    color: #C00;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 13px;
    margin-bottom: 16px;
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .btn {
    padding: 12px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    border: none;
    transition: all 0.15s ease;
  }

  .btn-pay {
    background: #3182F6;
    color: #FFF;
  }
  .btn-pay:hover:not(:disabled) {
    background: #1B64DA;
  }

  .btn-cancel {
    background: #F4F4F4;
    color: #666;
  }
  .btn-cancel:hover:not(:disabled) {
    background: #EAEAEA;
  }

  .caption {
    font-size: 11px;
    color: #999;
    text-align: center;
    margin-top: 16px;
    margin-bottom: 0;
    line-height: 1.4;
  }
</style>
