import type { ConfirmedNote } from './note';

/**
 * 사용자 프로필, 7일 루틴 슬롯 및 휘발되지 않는 진화 맥락 타입 정의
 */

export interface PersonalPreferences {
  subInterests?: string[];       // 사이드 프로젝트 / 서브 관심 기술 (예: React, PyTorch)
  lifestyleHabits?: string[];    // 취미 / 일상 관심사 (예: 커피, 운동, 독서)
  thinkingStyle?: 'PRAGMATIC' | 'SYSTEMATIC'; // 실용적 구현 vs 체계적 설계
  sentenceTone?: 'CONCISE' | 'DETAILED';      // 날카로운 단문 vs 완결형 복문
}

export interface UserProfile {
  id: string;
  email?: string;
  name?: string;
  role: string;
  interests: string[];
  preferences?: PersonalPreferences;
  createdAt: number;
}

export interface RoutineSlot {
  dayOfWeek: number; // 0 (일) - 6 (토)
  startHour: number; // 0 - 23
  endHour: number;   // 1 - 24
  label: string;
}

export interface EvolvingContext {
  ongoingTopics: string[];
  domainVocabulary: string[];
  lifestyleVocabulary?: string[];
  confirmedPreferences: string[];
  recentConfirmedNotes: ConfirmedNote[];
}

export interface AuthSession {
  sessionId: string;
  user: UserProfile;
  expiresAt: number;
}

export type BillingPlan = 'free' | 'pro';

export interface BillingStatus {
  plan: BillingPlan;
  isActive: boolean;
  status?: 'PAID' | 'REFUNDED';
  orderId?: string;
  paymentKey?: string;
  method?: string;
  paidAt?: number;
  refundedAt?: number;
  amount?: number;
  cancelReason?: string;
}

export interface PaymentConfirmRequest {
  paymentKey: string;
  orderId: string;
  amount: number;
}

export interface PaymentConfirmResponse {
  success: boolean;
  orderId: string;
  plan: BillingPlan;
  paidAt: number;
  amount: number;
  paymentKey: string;
  method: string;
}

export interface RefundRequest {
  orderId: string;
  cancelReason: string;
}

export interface RefundResponse {
  success: boolean;
  orderId: string;
  plan: BillingPlan;
  refundedAt: number;
  cancelReason: string;
}
