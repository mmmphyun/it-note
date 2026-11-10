/**
 * 차세대 선제적 투기 실행 및 3-Tier 엔진 스키마
 */

export type EngineTier = 'high-local' | 'lite-local' | 'cloud';

export interface EngineConfig {
  tier: EngineTier;
  modelDownloaded: boolean;
  modelDownloadProgress: number; // 0 - 100
  offlineReady: boolean;
  selectedAt: string;
}

export interface NetworkStatus {
  isCellular: boolean;
  saveData: boolean;
  effectiveType: string; // '4g', '3g', '2g', 'slow-2g', 'unknown'
}

export interface LinkedContextItem {
  noteId: string;
  sentence: string;
  similarity: number;
  matchedKeywords: string[];
  createdAt: string;
}

export interface SpeculativeInferenceRequest {
  croppedImageBase64?: string;
  rawTextInput?: string;
  previousEvaporatedContext?: string | null;
  rejectedHypotheses?: string[];
  linkedContexts: LinkedContextItem[];
}

export interface PrefetchedHypothesisSlot {
  hypothesisSentence: string;
  candidateKey?: string;
  confidenceScore: number;
  fetchedAt: number;
  isStale: boolean;
}
