import type { ConfirmedNote } from './note';

/**
 * 사용자 프로필, 7일 루틴 슬롯 및 휘발되지 않는 진화 맥락 타입 정의
 */

export interface UserProfile {
  id: string;
  email?: string;
  name?: string;
  role: string;
  interests: string[];
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
  confirmedPreferences: string[];
  recentConfirmedNotes: ConfirmedNote[];
}
