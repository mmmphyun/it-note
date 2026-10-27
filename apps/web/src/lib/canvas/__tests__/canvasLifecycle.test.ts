import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CanvasLifecycleEngine,
  formatHandwrittenSentence,
  generateRandomTilt,
  calculateVisibleHypothesisBbox
} from '../canvasLifecycle';
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

    // 필기 입력 (100, 100) -> (300, 200)
    engine.pointerDown({ x: 100, y: 100, t: 0, pressure: 0.5 });
    engine.pointerMove({ x: 300, y: 200, t: 1000, pressure: 0.5 });
    engine.pointerUp(1000);

    // 30초 대기 만료 (31,000ms)
    engine.tick(31000);
    expect(extractedCrop).toBeNull();

    // 90초 만료 시점 (91,000ms)
    const finalState = engine.tick(91000);
    expect(finalState.isEvaporated).toBe(true);
    expect(finalState.opacity).toBe(0);

    // 크롭 결과 확인
    expect(extractedCrop).not.toBeNull();
    expect(extractedCrop!.strokeCount).toBe(1);
    expect(extractedCrop!.base64).toMatch(/^data:image\/png;base64,/);

    // 캔버스 획 상태는 메모리에서 파기되어 0으로 리셋 확인 (원본 필기 휘발 처리)
    expect(engine.strokes.length).toBe(0);
    expect(engine.lastPointerUpTime).toBeNull();
  });

  it('증발 완료 후 1개의 추론 문장(activeHypothesis)이 생성되고 콜백이 호출되어야 한다', () => {
    let spawnedCount = 0;
    const engine = new CanvasLifecycleEngine({
      onHypothesisSpawned: () => {
        spawnedCount++;
      },
    }, false);

    engine.pointerDown({ x: 200, y: 200, t: 0 });
    engine.pointerUp(1000);

    // 90초 경과로 증발 유도
    engine.tick(91000);

    expect(spawnedCount).toBe(1);
    expect(engine.activeHypothesis).not.toBeNull();
    expect(engine.activeHypothesis!.sentence).toContain('Svelte 5');
    expect(engine.activeHypothesis!.isConfirmed).toBe(false);
    expect(engine.activeHypothesis!.isRejected).toBe(false);
  });

  it('AI 문장 위 O 제스처 입력 시 해당 문장이 확정 노트(ConfirmedNote)로 흡수되어야 한다', () => {
    let confirmedNote: ConfirmedNote | null = null;
    const engine = new CanvasLifecycleEngine({
      onHypothesisConfirmed: (note) => {
        confirmedNote = note;
      },
    }, false);

    // 모의 AI 문장 설정
    engine.activeHypothesis = {
      id: 'test-hypo-1',
      sentence: 'React 대신 Svelte 5 모노레포를 채택한다는 아이디어 맞나요?',
      bbox: [200, 200, 400, 80],
      createdAt: 1000,
      isConfirmed: false,
      isRejected: false,
    };

    // 문장 바운딩 박스를 둘러싸는 원형(O) 제스처 입력
    const r = 70;
    const cx = 350;
    const cy = 240;
    engine.pointerDown({ x: cx + r, y: cy, t: 2000 });
    for (let deg = 30; deg <= 360; deg += 30) {
      const rad = (deg * Math.PI) / 180;
      engine.pointerMove({
        x: cx + r * Math.cos(rad),
        y: cy + r * Math.sin(rad),
        t: 2000 + deg * 2,
      });
    }
    engine.pointerUp(3000);
    engine.tick(3800); // 700ms 유예 시간 경과 후 최종 판정

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
    engine.tick(3100); // 700ms 유예 시간 경과 후 최종 판정

    // 기각 및 새 문장 교체 확인
    expect(rejectedCount).toBe(1);
    expect(engine.rejectedHypotheses).toContain('가설 1번 문장');
    expect(engine.activeHypothesis).not.toBeNull();
    expect(engine.activeHypothesis!.sentence).not.toBe('가설 1번 문장');
    expect(engine.activeHypothesis!.isConfirmed).toBe(false);
  });

  it('formatHandwrittenSentence는 긴 문장이라도 최대 3줄을 절대 초과하지 않고 고르게 분할해야 한다', () => {
    const veryLongText = '하나 둘 셋 넷 다섯 여섯 일곱 여덟 아홉 열 열하나 열둘 열셋 열넷 열다섯 열여섯';
    const formatted = formatHandwrittenSentence(veryLongText, 3);

    const lines = formatted.split('\n');
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines.length).toBe(3);

    // 각 줄에 단어가 고르게 배분되었는지 확인 (단어 수 차이가 1개 이하)
    const wordCounts = lines.map((l) => l.trim().split(/\s+/).length);
    const maxWords = Math.max(...wordCounts);
    const minWords = Math.min(...wordCounts);
    expect(maxWords - minWords).toBeLessThanOrEqual(1);

    // 원본 단어 순서와 일치하는지 확인
    const originalWords = veryLongText.trim().split(/\s+/);
    const formattedWords = formatted.trim().split(/\s+/);
    expect(formattedWords).toEqual(originalWords);
  });

  it('generateRandomTilt는 0도 부근 데드존([-0.7, +0.7])을 배제하고 확연한 기울기 각도를 반환해야 한다', () => {
    for (let i = 0; i < 30; i++) {
      const tilt = generateRandomTilt();
      // 절댓값이 최소 0.7 이상이어야 함 (0도 부근 평평한 수평 배제)
      expect(Math.abs(tilt)).toBeGreaterThanOrEqual(0.7);
      expect(Math.abs(tilt)).toBeLessThanOrEqual(2.5);
    }
  });

  it('AI 문장 위에서 2개 획으로 X를 그렸을 때 정상 기각되고 불필요한 새 문장 루프가 방지되어야 한다', () => {
    let rejectedCount = 0;
    const engine = new CanvasLifecycleEngine({
      onHypothesisRejected: () => {
        rejectedCount++;
      },
    }, 'instant');

    engine.activeHypothesis = {
      id: 'test-hypo-2',
      sentence: '가설 2번 문장',
      bbox: [200, 200, 400, 80],
      createdAt: 1000,
      isConfirmed: false,
      isRejected: false,
    };

    // 1번째 짧은 대각선 획 (\ - 단독으로는 취소선 폭 미충족)
    engine.pointerDown({ x: 320, y: 220, t: 2000 });
    engine.pointerMove({ x: 360, y: 260, t: 2050 });
    engine.pointerUp(2100);

    // 1번째 획 후: 일반 strokes에 들어가지 않고 제스처 버퍼에 보류되므로 strokes 길이는 0 유지
    expect(engine.strokes.length).toBe(0);
    expect(rejectedCount).toBe(0);

    // 2번째 짧은 대각선 획 (/ - 1번째 획과 정확히 교차)
    engine.pointerDown({ x: 320, y: 260, t: 2200 });
    engine.pointerMove({ x: 360, y: 220, t: 2250 });
    engine.pointerUp(2300);

    // 2번째 획 직후(200ms 경과): 아직 유예 시간(700ms) 미만이므로 성급하게 판정하지 않고 대기
    engine.tick(2500);
    expect(rejectedCount).toBe(0);

    // 700ms 유예 시간 경과(3100ms 시점): 사용자 입력이 멈춘 것을 감지하고 비로소 최종 X 기각 판정!
    engine.tick(3100);
    expect(rejectedCount).toBe(1);
    expect(engine.strokes.length).toBe(0); // 일반 필기 증발로 잘못 전이되지 않음
  });

  it('calculateVisibleHypothesisBbox는 획이 화면 우측 끝에 있어도 가시 영역 내로 클램핑해야 한다', () => {
    const viewport = { scrollX: 0, scrollY: 0, width: 1000, height: 700 };
    // 화면 우측 끝 (x=880~950)에 필기된 획
    const cropBbox: [number, number, number, number] = [880, 200, 950, 260];

    const [adjX, adjY, w, h] = calculateVisibleHypothesisBbox(cropBbox, viewport, 480, 105);

    // 문장의 우측 끝(adjX + w)이 화면 우측 경계(1000px)를 넘지 않아야 함
    expect(adjX + w).toBeLessThanOrEqual(viewport.width);
    expect(adjX).toBeGreaterThanOrEqual(24);
    // 문장의 하단 끝(adjY + h)이 화면 하단 경계(700px)를 넘지 않아야 함
    expect(adjY + h).toBeLessThanOrEqual(viewport.height);
  });

  it('calculateVisibleHypothesisBbox는 획이 화면 하단 끝에 있어도 가시 영역 내로 상향 클램핑해야 한다', () => {
    const viewport = { scrollX: -200, scrollY: -400, width: 800, height: 600 };
    // 현재 가시 영역: x: 200~1000, y: 400~1000
    // 화면 하단 끝 (y=950)에 필기된 획
    const cropBbox: [number, number, number, number] = [300, 920, 500, 980];

    const [adjX, adjY, w, h] = calculateVisibleHypothesisBbox(cropBbox, viewport, 480, 105);

    const visMaxX = -viewport.scrollX + viewport.width; // 1000
    const visMaxY = -viewport.scrollY + viewport.height; // 1000

    expect(adjX + w).toBeLessThanOrEqual(visMaxX);
    expect(adjY + h).toBeLessThanOrEqual(visMaxY);
    expect(adjY).toBeGreaterThanOrEqual(-viewport.scrollY);
  });
});
