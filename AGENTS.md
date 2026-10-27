# AGENTS.md — 잇적 (It!note) 에이전트 아키텍처 헌법 (Soft & Hard Guards)

이 문서는 AI 코딩 에이전트가 `잇적(It!note)` TypeScript 모노레포(`Svelte 5` + `Hono`)에서 작업할 때 반드시 준수해야 하는 최상위 제약 사항입니다.

---

## 1. 기술 스택 및 모노레포 구조 불변 규칙
- **언어 통일 (End-to-End TypeScript)**: 프론트엔드, 백엔드, 공유 스키마(`packages/shared`) 모두 Strict TypeScript로 작성하며 `any` 타입 사용을 금지합니다.
- **Frontend (`apps/web` — Vite + Svelte 5)**:
  - 가상 DOM 오버헤드 없는 **Svelte 5 Runes (`$state`, `$derived`, `$effect`)** 문법만 사용합니다 (레거시 Svelte 3/4 `export let`, `$:` 구문 금지).
  - 120Hz `PointerEvent` 펜 좌표 스트림은 반응형 상태 리렌더링 병목을 피하기 위해 순수 TS 버퍼/Canvas Context에서 직접 처리합니다.
- **Backend (`apps/server` — Hono + DB + OAuth + PG)**:
  - Web Standard API(`Request`/`Response`) 기반의 **Hono** 프레임워크를 사용합니다.
  - 소셜 로그인(OAuth 2.0 + 자동 로그인 세션/Refresh Token), PG사 결제 연동(웹훅 검증 및 트랜잭션 관리), 사용자 프로필/시간표 및 확정 노트 동기화를 처리합니다.

---

## 2. Zero-UI & Pure Stylus 불변 규칙 (`apps/web/src/lib/canvas/`)
- **절대 금지**: 로그인 이후 진입하는 메인 메모 화면(`apps/web/src/lib/canvas/` 하위 `.svelte`, `.ts` 파일)에 `<header>`, `<footer>`, `<nav>`, `<button>`, `<input>`, `<textarea>`, 지우개 아이콘, 색상 팔레트, 플로팅 툴바, 카드 모달을 생성하지 마십시오. (`.githooks/pre-commit` 하드가드가 정규식으로 검사하여 커밋을 물리적으로 차단합니다.)
- **유일한 시각 요소**:
  1. 미색 종이 질감(`#FAF8F5`)의 스크롤 가능한 확장형 `<canvas>` 및 한글 획순 렌더링용 `<svg>`.
  2. 모서리의 희미한 `잇적` 텍스트 워터마크(`opacity: 0.15`).
- **잉크 증발 및 맥락 연속성**:
  - 펜을 떼고 **30초 대기(유휴)** 후 **60초(1분)** 동안 서서히 투명해집니다.
  - 이미 투명해져 증발한 뒤에 적힌 키워드라도 이전 키워드와 무관하다고 단정하지 않고, 직전 맥락과의 연관성을 `Jev`가 함께 판별합니다.
- **지우개 없음 원칙**: 사용자가 잘못 쓴 글씨를 지우는 행위(취소선, 돼지꼬리, 덧칠, X표)는 삭제(`DELETE`)가 아니라 추론 컨텍스트(`THOUGHT_PIVOT` vs `TYPO_CORRECTION`)로 보존해야 합니다.

---

## 3. Dual-Process AI 추론 및 단일 문장 피드백 루프
- **System 1 (`system1Jev.ts`)**:
  - TypeSafe AI `Jev` 또는 오픈소스 `OpenJev` (`/v1/systemone`) 규격을 사용합니다.
  - 자유 텍스트를 생성하지 않고 오직 구조화된 의사결정 프리미티브(`Noul`, `Choice`, `Score`, `Box`)만 반환해야 합니다.
- **System 2 (`system2Writer.ts`) & 단일 문장 제시**:
  - 여러 줄의 보기를 나열하지 않고, `Jev`가 확정한 최우선 맥락에 따라 **단 1개의 완결된 추론 문장**만 여백에 한글 획순으로 적습니다.
  - 사용자가 동그라미(`O`)를 치면 문장이 종이로 흡수(Sink-in)되어 화면에서 사라지고 확정 노트로 저장됩니다.
  - 사용자가 엑스(`X`)를 치면 **"이전 추론 문장이 기각되었음(오답 맥락)"**을 제약 조건에 추가하여 즉시 다음 최선책 문장 1개를 새로 추론해 적습니다.

---

## 4. 보안 및 Git 커밋 규율 (Stealth-to-Public 대비)
- **원본 필기 이미지 휘발 처리**: Hono 백엔드 서버는 추론을 위해 전송된 원본 필기 크롭 이미지를 로컬 디스크(`fs.writeFile`)에 절대 기록하지 않고 인메모리에서 처리 후 즉시 파기합니다.
- **시크릿 제로**: OAuth 시크릿, PG사 API 키, AI API 키를 코드에 절대 하드코딩하지 마십시오 (`gitleaks` 하드가드 작동 중).
- **원자적 커밋 (Atomic Commits)**: 한 번의 커밋에 10개 이하의 파일만 포함하며, `<type>(<scope>): <한글 요약>` 컨벤션을 엄수합니다.

---

## 5. 테스트 주도 및 마일스톤 마감 거버넌스
- **테스트 동반 의무 (No Code without Test)**:
  - 핵심 알고리즘(O/X 제스처 판정, 30s/60s 잉크 상태 머신, Jev 스키마 어댑터, `profileEnricher` 맥락 병합)을 작성할 때 반드시 상응하는 `*.test.ts` (Vitest) 파일을 함께 작성해야 합니다.
  - `.githooks/pre-commit` 하드가드가 매 커밋마다 `npm test -- --run`을 기계적으로 실행하여 단 하나의 테스트라도 실패하면 커밋을 차단합니다.
- **마일스톤 조기 종료(Premature Exit) 금지**:
  - 에이전트는 코드 작성만으로 마일스톤을 끝낼 수 없습니다.
  - 반드시 1) `npm run check`, 2) `npm test`, 3) `npm run build`를 순차 통과하고, 4) 사용자가 직접 브라우저에서 검증할 3단계 수동 테스트 시나리오를 제시한 뒤, 5) `docs/submissions/SUBMISSION_M{N}.md` 제출 보고서 파일까지 생성해야 해당 세션을 마감할 수 있습니다.
