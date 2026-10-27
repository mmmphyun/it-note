import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CanvasLifecycleEngine } from '../canvasLifecycle';
import type { CroppedImageResult } from '../cropExtractor';
import type { ConfirmedNote } from '@itnote/shared';

describe('CanvasLifecycleEngine - 가상 타이머 수명 주기 통합 테스트', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('펜 입력 후 25초 시점에 추가 펜 입력 시 30초 대기 타이머가 정상 리셋되어야 한다', () => {
    const engine = new CanvasLifecycleEngine({}, false);

    // 1. 첫 번째 획 필기 (0초 ~ 1초)
    engine.pointerDown({ x: 100, y: 100, t: 0, pressure: 0.6 });
    engine.pointerMove({ x: 120, y: 105, t: 500, pressure: 0.6 });
    engine.pointerUp(1000);

    expect(engine.lastPointerUpTime).toBe(1000);
    expect(engine.strokes.length).toBe(1);

    // 2. 25초 경과 (26,000ms 시점)
    const stateAt25s = engine.tick(26000);
    expect(stateAt25s.phase).toBe('idle');
    expect(stateAt25s.opacity).toBe(1.0);
    expect(stateAt25s.isEvaporated).toBe(false);

    // 3. 25초 시점에 추가 펜 입력 발생 -> 30초 대기 타이머 리셋 확인
    engine.pointerDown({ x: 130, y: 110, t: 26000, pressure: 0.7 });
    expect(engine.lastPointerUpTime).toBeNull();

    engine.pointerMove({ x: 160, y: 115, t: 26500, pressure: 0.7 });
    engine.pointerUp(27000); // 27초 시점에 두 번째 획 종료
    expect(engine.lastPointerUpTime).toBe(27000);
    expect(engine.strokes.length).toBe(2);

    // 4. 첫 획 종료 기준 31초 경과(32,000ms 시점): 두 번째 획 기준으로는 5초만 경과했으므로 여전히 idle (1.0)
    const stateAt32s = engine.tick(32000);
    expect(stateAt32s.phase).toBe('idle');
    expect(stateAt32s.opacity).toBe(1.0);

    // 5. 두 번째 획 종료 기준 29초 경과(56,000ms 시점): 여전히 idle 유지
    const stateAt56s = engine.tick(56000);
    expect(stateAt56s.phase).toBe('idle');
    expect(stateAt56s.opacity).toBe(1.0);

    // 6. 두 번째 획 종료 기준 31초 경과(58,000ms 시점): 비로소 fading 단계 진입
    const stateAt58s = engine.tick(58000);
    expect(stateAt58s.phase).toBe('fading');
    expect(stateAt58s.opacity).toBeLessThan(1.0);
  });

  it('30초 대기 + 60초 증발(총 90초) 만료 시점에 최소 바운딩 박스 크롭 이미지 이벤트가 정상 방출되어야 한다', () => {
    let extractedCrop: CroppedImageResult | null = null;
    const engine = new CanvasLifecycleEngine({
      onCropExtracted: (crop) => {
        extractedCrop = crop;
      },
    }, false);

    // 획 필기: (100, 150)에서 (300, 250)까지
    engine.pointerDown({ x: 100, y: 150, t: 0 });
    engine.pointerMove({ x: 200, y: 200, t: 500 });
    engine.pointerMove({ x: 300, y: 250, t: 1000 });
    engine.pointerUp(1000);

    // 90초 경과 시점 전 (85초 경과: 86,000ms)
    engine.tick(86000);
    expect(extractedCrop).toBeNull();
    expect(engine.strokes.length).toBe(1);

    // 90초 경과 시점 (91,001ms) -> 증발 완료
    const finalState = engine.tick(91001);
    expect(finalState.isEvaporated).toBe(true);
    expect(finalState.opacity).toBe(0);

    // 크롭 이벤트 검증
    expect(extractedCrop).not.toBeNull();
    expect(extractedCrop!.strokeCount).toBe(1);
    expect(extractedCrop!.bbox[0]).toBe(100);
    expect(extractedCrop!.bbox[1]).toBe(150);
    expect(extractedCrop!.bbox[2]).toBe(300);
    expect(extractedCrop!.bbox[3]).toBe(250);

    // 캔버스 획 정리 및 AI 가설 문장 생성 확인
    expect(engine.strokes.length).toBe(0);
    expect(engine.activeHypothesis).not.toBeNull();
    expect(engine.activeHypothesis?.sentence).toBeTruthy();
  });

  it('AI 문장 위 O 획 입력 시 해당 문장이 흡수(isConfirmed: true) 상태로 전이되어야 한다', () => {
    let confirmedNote: ConfirmedNote | null = null;
    const engine = new CanvasLifecycleEngine({
      onHypothesisConfirmed: (note) => {
        confirmedNote = note;
      },
    }, false);

    // AI 문장 임의 배치 [200, 200, 400, 80]
    engine.activeHypothesis = {
      id: 'test-hypo-1',
      sentence: 'React 대신 Svelte 5 모노레포를 채택한다는 아이디어 맞나요?',
      bbox: [200, 200, 400, 80],
      createdAt: 1000,
      isConfirmed: false,
      isRejected: false,
    };

    // 문장 위에 원형 O 제스처 그리기
    const centerX = 350;
    const centerY = 240;
    const radius = 40;
    const steps = 24;

    engine.pointerDown({
      x: centerX + radius,
      y: centerY,
      t: 2000,
      pressure: 0.6,
    });

    for (let i = 1; i <= steps; i++) {
      const theta = (i / steps) * 2 * Math.PI;
      engine.pointerMove({
        x: centerX + radius * Math.cos(theta),
        y: centerY + radius * Math.sin(theta),
        t: 2000 + i * 20,
        pressure: 0.6,
      });
    }

    engine.pointerUp(3000);

    // 흡수(isConfirmed = true) 상태 전이 및 확정 노트 목록 보존 확인
    expect(engine.activeHypothesis!.isConfirmed).toBe(true);
    expect(confirmedNote).not.toBeNull();
    expect(confirmedNote!.sentence).toBe('React 대신 Svelte 5 모노레포를 채택한다는 아이디어 맞나요?');
    expect(engine.confirmedNotes.length).toBe(1);
  });

  it('AI 문장 위 X 획 입력 시 해당 문장이 기각(isRejected: true)되고 새 대안 문장으로 교체되어야 한다', () => {
    let rejectedCount = 0;
    const engine = new CanvasLifecycleEngine({
      onHypothesisRejected: () => {
        rejectedCount++;
      },
    }, false);

    // 첫 번째 AI 문장
    engine.activeHypothesis = {
      id: 'test-hypo-1',
      sentence: '가설 1번 문장',
      bbox: [200, 200, 400, 80],
      createdAt: 1000,
      isConfirmed: false,
      isRejected: false,
    };

    // 문장 폭 40% 이상 가로지르는 취소선 획 (150px 폭)
    engine.pointerDown({ x: 220, y: 240, t: 2000 });
    engine.pointerMove({ x: 300, y: 240, t: 2100 });
    engine.pointerMove({ x: 420, y: 240, t: 2200 });
    engine.pointerUp(2300);

    // 기각 및 새 문장 교체 확인
    expect(rejectedCount).toBe(1);
    expect(engine.rejectedHypotheses).toContain('가설 1번 문장');
    expect(engine.activeHypothesis).not.toBeNull();
    expect(engine.activeHypothesis!.sentence).not.toBe('가설 1번 문장');
    expect(engine.activeHypothesis!.isConfirmed).toBe(false);
  });
});
