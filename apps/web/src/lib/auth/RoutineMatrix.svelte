<script lang="ts">
  import type { RoutineSlot } from '@itnote/shared';

  interface Props {
    routineSlots: RoutineSlot[];
    onChange: (slots: RoutineSlot[]) => void;
  }

  let { routineSlots, onChange }: Props = $props();

  const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const HOURS = Array.from({ length: 24 }, (_, i) => i);

  const CATEGORIES = [
    { id: 'DEVELOPMENT', label: '개발 / 코딩', color: '#385E72' },
    { id: 'DESIGN', label: '기획 / 설계', color: '#3E7B68' },
    { id: 'RESEARCH', label: '학습 / 연구', color: '#C27D38' },
    { id: 'ERASER', label: '지우개 (비우기)', color: '#FFFFFF' },
  ] as const;

  let selectedCategory = $state<string>('개발 / 코딩');

  // 셀별 라벨 매트릭스 [day][hour] (null이면 미지정)
  let labelGrid = $state<(string | null)[][]>(
    Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => null))
  );

  // 초기 routineSlots 반영
  $effect(() => {
    const grid: (string | null)[][] = Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, () => null)
    );
    for (const slot of routineSlots) {
      const d = slot.dayOfWeek;
      const lbl = slot.label || '개발 / 코딩';
      for (let h = slot.startHour; h < slot.endHour; h++) {
        if (grid[d] && h >= 0 && h < 24) {
          grid[d][h] = lbl;
        }
      }
    }
    labelGrid = grid;
  });

  let isDragging = $state(false);

  function applyCell(day: number, hour: number) {
    if (selectedCategory === '지우개 (비우기)') {
      labelGrid[day][hour] = null;
    } else {
      labelGrid[day][hour] = selectedCategory;
    }
    emitChange();
  }

  function handlePointerDown(day: number, hour: number) {
    isDragging = true;
    applyCell(day, hour);
  }

  function handlePointerEnter(day: number, hour: number) {
    if (isDragging) {
      applyCell(day, hour);
    }
  }

  function handlePointerUp() {
    isDragging = false;
  }

  function emitChange() {
    // grid -> RoutineSlot[] 변환 (동일 요일, 동일 라벨 연속 구간 병합)
    const newSlots: RoutineSlot[] = [];
    for (let d = 0; d < 7; d++) {
      let currentLabel: string | null = null;
      let start: number | null = null;

      for (let h = 0; h < 24; h++) {
        const cellLabel = labelGrid[d][h];
        if (cellLabel !== null) {
          if (start === null) {
            start = h;
            currentLabel = cellLabel;
          } else if (cellLabel !== currentLabel) {
            newSlots.push({
              dayOfWeek: d,
              startHour: start,
              endHour: h,
              label: currentLabel!,
            });
            start = h;
            currentLabel = cellLabel;
          }
        } else {
          if (start !== null) {
            newSlots.push({
              dayOfWeek: d,
              startHour: start,
              endHour: h,
              label: currentLabel!,
            });
            start = null;
            currentLabel = null;
          }
        }
      }
      if (start !== null) {
        newSlots.push({
          dayOfWeek: d,
          startHour: start,
          endHour: 24,
          label: currentLabel!,
        });
      }
    }
    onChange(newSlots);
  }

  function getCellColor(label: string | null): string {
    if (!label) return 'transparent';
    const cat = CATEGORIES.find((c) => c.label === label);
    return cat ? cat.color : '#385E72';
  }
</script>

<svelte:window onpointerup={handlePointerUp} />

<div class="matrix-wrapper">
  <!-- 카테고리 선택 팔레트 -->
  <div class="palette-bar">
    <span class="palette-title">작업 모드 브러시:</span>
    <div class="palette-items">
      {#each CATEGORIES as cat}
        <button
          type="button"
          class="palette-chip"
          class:active={selectedCategory === cat.label}
          onclick={() => (selectedCategory = cat.label)}
        >
          <span
            class="color-dot"
            style="background: {cat.color}; border: {cat.id === 'ERASER' ? '1px dashed #999' : 'none'}"
          ></span>
          <span>{cat.label}</span>
        </button>
      {/each}
    </div>
  </div>

  <div class="matrix-instructions">
    <span>💡 위 브러시를 선택한 후, 마우스나 펜으로 긁어 주간 작업 루틴을 색칠하세요.</span>
  </div>

  <div class="matrix-grid">
    <!-- 헤더 행: 시간 라벨 -->
    <div class="row header-row">
      <div class="day-label corner">요일</div>
      {#each HOURS as hour}
        <div class="hour-header-cell">
          {hour % 3 === 0 ? `${hour}시` : ''}
        </div>
      {/each}
    </div>

    <!-- 7일 행 (월~일 순서) -->
    {#each [1, 2, 3, 4, 5, 6, 0] as dayIndex}
      <div class="row day-row">
        <div class="day-label" class:weekend={dayIndex === 0 || dayIndex === 6}>
          {DAYS[dayIndex]}
        </div>
        {#each HOURS as hour}
          <div
            role="button"
            tabindex="0"
            class="matrix-cell"
            style="background-color: {getCellColor(labelGrid[dayIndex][hour])};"
            title="{DAYS[dayIndex]}요일 {hour}시: {labelGrid[dayIndex][hour] || '비어 있음'}"
            onpointerdown={() => handlePointerDown(dayIndex, hour)}
            onpointerenter={() => handlePointerEnter(dayIndex, hour)}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                applyCell(dayIndex, hour);
              }
            }}
          ></div>
        {/each}
      </div>
    {/each}
  </div>
</div>

<style>
  .matrix-wrapper {
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
  }

  .palette-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }

  .palette-title {
    font-size: 13px;
    font-weight: 600;
    color: #444;
  }

  .palette-items {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .palette-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid rgba(0, 0, 0, 0.15);
    background: #FFF;
    color: #333;
    transition: all 0.15s ease;
  }
  .palette-chip:hover {
    background: #F8F8F8;
  }
  .palette-chip.active {
    border-color: #1A1A1A;
    box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.2);
  }

  .color-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    display: inline-block;
  }

  .matrix-instructions {
    font-size: 12px;
    color: #777;
    margin-bottom: 12px;
  }

  .matrix-grid {
    display: flex;
    flex-direction: column;
    border: 1px solid rgba(0, 0, 0, 0.12);
    border-radius: 8px;
    overflow: hidden;
    background: #FFF;
  }

  .row {
    display: flex;
    align-items: center;
    border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  }
  .row:last-child {
    border-bottom: none;
  }

  .header-row {
    background: #F8F7F5;
    font-size: 11px;
    color: #777;
    height: 28px;
  }

  .day-label {
    width: 44px;
    font-size: 13px;
    font-weight: 600;
    text-align: center;
    flex-shrink: 0;
    border-right: 1px solid rgba(0, 0, 0, 0.08);
  }
  .day-label.corner {
    font-size: 11px;
    color: #999;
  }
  .day-label.weekend {
    color: #E25555;
  }

  .hour-header-cell {
    flex: 1;
    text-align: center;
    font-size: 10px;
    overflow: hidden;
    white-space: nowrap;
  }

  .day-row {
    height: 32px;
  }

  .matrix-cell {
    flex: 1;
    height: 100%;
    border-right: 1px solid rgba(0, 0, 0, 0.04);
    cursor: crosshair;
    transition: background-color 0.1s ease;
  }
  .matrix-cell:last-child {
    border-right: none;
  }
</style>
