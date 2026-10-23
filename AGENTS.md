# AGENTS.md — 잇적 (It!note) 에이전트 아키텍처 헌법 (Soft & Hard Guards)

이 문서는 AI 코딩 에이전트가 `잇적(It!note)` 레포지토리에서 작업할 때 반드시 준수해야 하는 최상위 제약 사항입니다.

---

## 1. Zero-UI & Pure Stylus 불변 규칙 (`src/components/canvas/`)
- **절대 금지**: 메인 메모 화면(`src/components/canvas/` 하위 컴포넌트)에 `<header>`, `<footer>`, `<nav>`, `<button>`, `<input>`, `<textarea>`, 지우개 아이콘, 색상 팔레트, 플로팅 툴바, 카드 모달을 생성하지 마십시오. (`.githooks/pre-commit` 하드가드가 정규식으로 검사하여 커밋을 물리적으로 차단합니다.)
- **유일한 시각 요소**:
  1. 미색 종이 질감의 전체 화면 `<canvas>` 및 한글 획순 렌더링용 `<svg>`.
  2. 우측 하단 모서리의 희미한 `잇적` 텍스트 워터마크(`opacity: 0.15`, 2초 Long-press 시에만 온보딩/보관함 드로어 호출).
- **지우개 없음 원칙**: 사용자가 잘못 쓴 글씨를 지우는 행위(취소선, 돼지꼬리, 덧칠, X표)는 삭제(`DELETE`)가 아니라 추론 컨텍스트(`THOUGHT_PIVOT` vs `TYPO_CORRECTION`)로 보존해야 합니다.

---

## 2. Dual-Process AI 추론 분리 규칙 (`src/services/`)
- **System 1 (`system1Jev.ts`)**:
  - TypeSafe AI `Jev` 또는 오픈소스 `OpenJev` (`/v1/systemone`) 규격을 사용합니다.
  - 자유 텍스트를 생성하지 않고 오직 구조화된 의사결정 프리미티브(`Noul`, `Choice`, `Score`, `Box`)만 반환해야 합니다.
  - 사용자의 과거 `O`/`X` 마킹 피드백 로그(`calibration_history`)를 입력 `state`에 포함하여 무학습 인컨텍스트 보정(In-Context Calibration)을 수행합니다.
- **System 2 (`system2Writer.ts`)**:
  - 생성형 VLM/LLM이 임의로 화살표나 취소선의 구조적 성질을 추측하게 하지 마십시오.
  - 반드시 `system1Jev.ts`가 확정한 Typed Decision 결과를 제약 조건(Constraint)으로 입력받아 문장만 조립해야 합니다.

---

## 3. Stateless Zero-Retention 보안 규칙 (`api/`)
- **메모리 휘발 처리**: 백엔드 프록시(`api/infer.ts`)는 사용자의 필기 크롭 이미지를 디스크(`fs.writeFile`), 데이터베이스, 또는 서버 로그에 절대 기록해서는 안 됩니다. (하드가드가 파일 쓰기 API 호출을 차단합니다.)
- **클라이언트 로컬 저장**: 사용자 페르소나, 7일 루틴 매트릭스, 확정된 노트는 오직 브라우저 내부 `IndexedDB`에만 저장합니다.

---

## 4. Git & 커밋 규율 (Stealth-to-Public 대비)
- **시크릿 제로**: 나중에 Private 레포지토리를 Public으로 전환할 때 전체 커밋 히스토리가 공개됩니다. 테스트 목적이라도 API Key를 코드나 테스트 파일에 하드코딩하지 마십시오 (`gitleaks` 하드가드 작동 중).
- **원자적 커밋 (Atomic Commits)**: 한 번의 커밋에 10개 이하의 파일만 포함하며, `<type>(<scope>): <한글 요약>` 컨벤션을 엄수합니다.
