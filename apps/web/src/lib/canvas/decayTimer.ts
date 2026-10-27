/**
 * 잉크 증발(Decay) 타이머 계산 모듈
 * 기본: 30초 대기(유휴) 후 60초간 선형 투명화 (총 90초)
 * fast 모드 (?fast=1): 3초 대기 후 5초간 선형 투명화 (총 8초)
 */

export interface DecayConfig {
  idleMs: number;
  fadeMs: number;
}

export const NORMAL_DECAY: DecayConfig = {
  idleMs: 30000,
  fadeMs: 60000,
};

export const FAST_DECAY: DecayConfig = {
  idleMs: 3000,
  fadeMs: 5000,
};

export interface DecayState {
  opacity: number;
  isEvaporated: boolean;
  phase: 'idle' | 'fading' | 'evaporated';
}

export function calculateDecayState(
  elapsedMs: number,
  isFast = false
): DecayState {
  const config = isFast ? FAST_DECAY : NORMAL_DECAY;
  const totalMs = config.idleMs + config.fadeMs;

  if (elapsedMs < 0) {
    return { opacity: 1, isEvaporated: false, phase: 'idle' };
  }

  if (elapsedMs < config.idleMs) {
    return { opacity: 1, isEvaporated: false, phase: 'idle' };
  }

  if (elapsedMs >= totalMs) {
    return { opacity: 0, isEvaporated: true, phase: 'evaporated' };
  }

  const fadeProgress = (elapsedMs - config.idleMs) / config.fadeMs;
  const opacity = Math.max(0, Math.min(1, 1 - fadeProgress));
  return { opacity, isEvaporated: false, phase: 'fading' };
}
