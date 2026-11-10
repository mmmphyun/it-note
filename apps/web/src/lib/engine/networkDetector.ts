import type { NetworkStatus } from '@itnote/shared';

/**
 * 브라우저 Network Information API를 활용해 셀룰러 데이터 및 데이터 절약 모드를 감지합니다.
 */
export function getNetworkStatus(): NetworkStatus {
  if (typeof navigator === 'undefined') {
    return { isCellular: false, saveData: false, effectiveType: 'unknown' };
  }

  // Network Information API (Chrome, Edge 등 Chromium 브라우저 지원)
  const connection = (navigator as unknown as { connection?: { type?: string; effectiveType?: string; saveData?: boolean } }).connection;

  if (!connection) {
    return { isCellular: false, saveData: false, effectiveType: 'unknown' };
  }

  const isCellular = connection.type === 'cellular' || connection.effectiveType === '2g' || connection.effectiveType === '3g';
  const saveData = Boolean(connection.saveData);
  const effectiveType = connection.effectiveType || 'unknown';

  return {
    isCellular,
    saveData,
    effectiveType
  };
}

/**
 * 네트워크 변경 감지 이벤트 리스너 등록
 */
export function onNetworkChange(callback: (status: NetworkStatus) => void): () => void {
  if (typeof navigator === 'undefined') {
    return () => {};
  }

  const connection = (navigator as unknown as { connection?: EventTarget & { type?: string; effectiveType?: string; saveData?: boolean } }).connection;

  if (!connection || typeof connection.addEventListener !== 'function') {
    return () => {};
  }

  const handler = () => {
    callback(getNetworkStatus());
  };

  connection.addEventListener('change', handler);
  return () => {
    connection.removeEventListener('change', handler);
  };
}
