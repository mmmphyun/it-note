import type { EngineConfig, EngineTier } from '@itnote/shared';

const STORAGE_KEY = 'itnote_engine_config';

const DEFAULT_CONFIG: EngineConfig = {
  tier: 'cloud', // 기본값: 즉시 실행 가능한 클라우드 티어
  modelDownloaded: false,
  modelDownloadProgress: 0,
  offlineReady: false,
  selectedAt: new Date().toISOString()
};

/**
 * 저장된 AI 엔진 설정을 불러옵니다.
 */
export function loadEngineConfig(): EngineConfig {
  if (typeof localStorage === 'undefined') {
    return DEFAULT_CONFIG;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

/**
 * AI 엔진 설정을 영구 저장합니다.
 */
export function saveEngineConfig(config: Partial<EngineConfig>): EngineConfig {
  const current = loadEngineConfig();
  const updated: EngineConfig = {
    ...current,
    ...config,
    selectedAt: new Date().toISOString()
  };

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // storage quota error 방어
    }
  }

  return updated;
}

/**
 * 선택된 티어에 따른 가중치 크기 및 설명 정보 반환
 */
export function getTierMetadata(tier: EngineTier): {
  title: string;
  sizeLabel: string;
  sizeBytes: number;
  description: string;
  recommendation: string;
} {
  switch (tier) {
    case 'high-local':
      return {
        title: '고성능 로컬 모델 (Qwen 1.5B)',
        sizeLabel: '약 900 MB',
        sizeBytes: 900 * 1024 * 1024,
        description: '가장 풍부한 문장 표현력 및 100% Zero-Outbound 기밀성 보장',
        recommendation: '고성능 데스크톱 / 최신 노트북 환경 권장'
      };
    case 'lite-local':
      return {
        title: '경량 로컬 모델 (Qwen 0.5B)',
        sizeLabel: '약 350 MB',
        sizeBytes: 350 * 1024 * 1024,
        description: '빠른 다운로드, 초경량 메모리 및 100% Zero-Outbound 기밀성 보장',
        recommendation: '일반 PC / 아이패드 및 태블릿 환경 권장'
      };
    case 'cloud':
    default:
      return {
        title: '클라우드 서버리스 엔진 (Gemini Flash)',
        sizeLabel: '0 MB (다운로드 없음)',
        sizeBytes: 0,
        description: '기기 자원 소모 0, 별도 설치 없이 즉시 초고속 추론 가동',
        recommendation: '데이터 절약 및 즉각적인 사용을 원할 때 권장'
      };
  }
}
