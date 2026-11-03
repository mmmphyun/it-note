<script lang="ts">
  import type { RoutineSlot } from '@itnote/shared';

  interface Props {
    routineSlots: RoutineSlot[];
    onChange: (slots: RoutineSlot[]) => void;
  }

  let { routineSlots, onChange }: Props = $props();

  const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const HOURS = Array.from({ length: 24 }, (_, i) => i);

  // 빠른 조회를 위한 boolean matrix [day][hour]
  let activeGrid = $state<boolean[][]>(
    Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => false))
  );

  // 초기 routineSlots 반영
  $effect(() => {
    const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => false));
    for (const slot of routineSlots) {
      const d = slot.dayOfWeek;
      for (let h = slot.startHour; h < slot.endHour; h++) {
        if (grid[d] && h >= 0 && h < 24) {
          grid[d][h] = true;
        }
      }
    }
    activeGrid = grid;
  });

  let isDragging = $state(false);
  let dragMode = $state<boolean>(true); // true: 활성화, false: 비활성화

  function toggleCell(day: number, hour: number, forceValue?: boolean) {
    const nextVal = forceValue !== undefined ? forceValue : !activeGrid[day][hour];
    activeGrid[day][hour] = nextVal;
    emitChange();
  }

  function handlePointerDown(day: number, hour: number) {
    isDragging = true;
    dragMode = !activeGrid[day][hour];
    toggleCell(day, hour, dragMode);
  }

  function handlePointerEnter(day: number, hour: number) {
    if (isDragging) {
      toggleCell(day, hour, dragMode);
    }
  }

  function handlePointerUp() {
    isDragging = false;
  }

  function emitChange() {
    // grid -> RoutineSlot[] 변환 (연속된 시간대 병합)
    const newSlots: RoutineSlot[] = [];
    for (let d = 0; d < 7; d++) {
      let start: number | null = null;
      for (let h = 0; h < 24; h++) {
        if (activeGrid[d][h]) {
          if (start === null) start = h;
        } else {
          if (start !== null) {
            newSlots.push({ dayOfWeek: d, startHour: start, endHour: h, label: '집중 시간' });
            start = null;
          }
        }
      }
      if (start !== null) {
        newSlots.push({ dayOfWeek: d, startHour: start, endHour: 24, label: '집중 시간' });
      }
    }
    onChange(newSlots);
  }
</script>

<svelte:window onpointerup={handlePointerUp} />

<div class="matrix-wrapper">
  <div class="matrix-instructions">
    <span>💡 펜 또는 마우스로 드래그하여 주간 집중 작업 시간대를 지정하세요.</span>
  </div>

  <div class="matrix-grid">
    <!-- 헤더 행: 시간 라벨 (4시간 간격 요약) -->
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
            class:active={activeGrid[dayIndex][hour]}
            onpointerdown={() => handlePointerDown(dayIndex, hour)}
            onpointerenter={() => handlePointerEnter(dayIndex, hour)}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                toggleCell(dayIndex, hour);
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

  .matrix-instructions {
    font-size: 13px;
    color: #666;
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

  .matrix-cell.active {
    background-color: #385E72;
  }
  .matrix-cell:not(.active):hover {
    background-color: rgba(56, 94, 114, 0.12);
  }
</style>
