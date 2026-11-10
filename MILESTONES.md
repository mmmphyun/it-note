# 잇적 (It!note) — 무맥락(Zero-Context) 에이전트 실행용 3단계 마일스톤 명세서

> [!IMPORTANT]
> **새 세션 에이전트(Flash 등) 필수 숙지 사항**
> 이 문서는 이전 대화 맥락이 전혀 없는 상태에서도 에이전트가 단독으로 코드를 구현·검증할 수 있도록 작성된 **결정론적 구현 명세서(Executable Spec)**입니다.
> 1. 작업 시작 전 반드시 루트의 `AGENTS.md`와 `.githooks/pre-commit`을 먼저 읽으십시오.
> 2. 존재하지 않는 가상 패키지(예: `hangul-stroke-magic` 등)를 임의로 `import`하지 마십시오. 아래 명시된 허용 패키지 목록과 순수 알고리즘만 사용합니다.
> 3. 한 번의 커밋에는 **10개 이하의 파일**만 포함하며, 각 체크리스트 항목 완료 시 `npm run check` 통과를 확인한 후 원자적 커밋(`<type>(<scope>): <한글 요약>`)을 수행하십시오.

---

## 0. 고정 기술 스택 및 스키마 규격 (Single Source of Truth)

새 세션에서 에이전트가 임의로 라이브러리를 선택해 충돌하는 것을 막기 위한 고정 규격입니다.

### 0.1. 워크스페이스 및 허용 패키지
* **패키지 매니저**: `npm workspaces` (`package.json` 루트 `"workspaces": ["packages/*", "apps/*"]`)
* **`packages/shared`**: 외부 의존성 없음 (순수 TypeScript 인터페이스 및 유틸리티)
* **`apps/web` (Vite + Svelte 5 + TS)**:
  * 필수 패키지: `svelte@^5.0.0`, `@sveltejs/vite-plugin-svelte`, `vite`, `typescript`, `svelte-check`, `perfect-freehand` (필압 스트로크 폴리곤 생성용), `tegaki` (폰트 기반 한글 손글씨 획순 애니메이션 라이브러리)
  * **주의**: `apps/web/src/lib/canvas/` 하위 파일에는 `<header>`, `<footer>`, `<nav>`, `<button>`, `<input>`, `<select>`, `<textarea>` 태그를 절대 작성하지 마십시오 (하드가드 차단 대상).
* **`apps/server` (Hono + Node + TS)**:
  * 필수 패키지: `hono`, `@hono/node-server`, `@google/genai` (또는 표준 `fetch` 기반 Gemini/Jev 호출), `tsx`, `typescript`
  * **주의**: `apps/server/src/` 하위 파일에서 `fs.writeFile`, `fs.writeFileSync`, `fs.appendFile` 등 로컬 디스크 파일 쓰기 함수를 절대 호출하지 마십시오 (하드가드 차단 대상).

### 0.2. 핵심 알고리즘 수식 명세 (환각 방지용)
1. **펜촉 전용 워터마크 진입 (`PaperCanvas.svelte`)**:
   * 조건: `e.pointerType === 'pen'`으로 우측 하단 워터마크 영역(`[width - 140, height - 60, width, height]`)을 **400ms 이내 2회 탭(Double-tap)한 뒤 800ms 이상 홀드**할 때만 `/desk` 뷰로 전환. (손가락/손날 `touch` 이벤트는 워터마크 트리거에서 100% 무시).
2. **O / X 펜 제스처 기하학 판별식 (`OxGestureLayer.svelte`)**:
   * AI 문장 바운딩 박스(`bbox`) 위에서 그어진 획들의 점 배열 $P = [(x_0, y_0), \dots, (x_n, y_n)]$ 및 전체 경로 길이 $L = \sum \|P_i - P_{i-1}\|$ 기준:
   * **동그라미(`O` - 채택) 판정**: 단일 획(1 stroke)이고, 시작점-끝점 거리 비율 $\frac{\|P_n - P_0\|}{L} < 0.35$ 이며, 바운딩 박스 면적 대비 폐곡선 내부 면적(Shoelace 공식) 비율이 $0.35$ 이상일 때.
   * **엑스(`X` / 취소선 - 기각) 판정**:
     * 두 획(2 strokes)의 선분이 서로 교차(CCW 교차 판정 `true`)하거나,
     * 단일 획이 문장 가로 폭의 $40\%$ 이상을 관통하며 직선성 비율 $\frac{\|P_n - P_0\|}{L} > 0.75$ 또는 지그재그 꺾임(방향 반전 $\ge 3$회)일 때.
3. **한글 획순 대필 애니메이션 (`AiHandwriting.svelte` with `tegaki`)**:
   * 오픈소스 라이브러리 `tegaki`(`gkurt/tegaki`)를 활용하여 웹 폰트(나눔손글씨 등)로부터 스켈레톤 궤적(Skeleton Path)을 자동 추출하고, Svelte 컴포넌트 내에서 AI 문장을 실제 손글씨 획순대로 순차 렌더링합니다. (사전 벡터 DB 없이 임의의 한글 문장을 자연스럽게 지원).

---

## 마일스톤 1 (중간 점검 1차): Zero-UI 펜 캔버스 & 증발·흡수 인터랙션 루프

**목표**: 백엔드/AI 없이도 프론트엔드 단독으로 실행되어, 스타일러스 펜 필기 -> 30초 대기 후 60초 증발 -> 여백 한글 획순 대필(Mock) -> O/X 마킹 및 흡수(Sink-in)까지의 전체 UX 루프를 완벽히 시연 가능한 상태로 완성합니다.

### 구현 체크리스트 (Milestone 1)
- [ ] **Step 1-1: 모노레포 루트 및 `packages/shared` 초기화**
  - [ ] 루트 `package.json` (`workspaces: ["packages/*", "apps/*"]`, 공통 스크립트 `dev`, `build`, `check`) 및 `tsconfig.base.json` 생성
  - [ ] `packages/shared/src/jev.ts`: `Noul`, `Choice<T>`, `Score`, `Box`, `JevDecisionResult` 타입 정의
  - [ ] `packages/shared/src/note.ts`: `StrokePoint` (`x, y, t, pressure, tiltX, tiltY`), `Stroke`, `InkCluster`, `AiHypothesis`, `ConfirmedNote` 타입 정의
  - [ ] `packages/shared/src/auth.ts`: `UserProfile`, `RoutineSlot`, `EvolvingContext` 타입 정의
- [ ] **Step 1-2: `apps/web` Svelte 5 스캐폴딩 및 미색 확장형 캔버스 구축**
  - [ ] Vite + Svelte 5 (`Runes` 모드) 프로젝트 구성 및 `perfect-freehand` 연동
  - [ ] `PaperCanvas.svelte`: 미색 종이(`#FAF8F5`) 배경, 두 손가락 터치 패닝(여유 스크롤 영역 `2400x1800`), `PointerEvent` 120Hz 펜 필기 렌더링 구현
  - [ ] 펜을 뗀 시점(`lastPointerUpTime`)으로부터 **30초 대기(`Opacity: 1.0` 유지) 후 60초 동안 서서히 투명해지는(`Opacity: 1.0 -> 0.0`)** `requestAnimationFrame` 기반 Decay 타이머 구현 (개발/점검 시 빠른 확인을 위해 URL 쿼리 `?fast=1` 부여 시 `3초 대기 + 5초 증발`로 동작하는 디버그 배속 스위치 포함)
  - [ ] 잉크 증발 완료 시 펜이 닿았던 최소 바운딩 박스(`Cropped Bounding Box`)만 메모리 상의 `base64 PNG`로 추출 후 캔버스에서 획 제거
- [ ] **Step 1-3: `tegaki` 기반 한글 획순 대필 렌더러 및 O/X 펜 제스처 레이어 구현**
  - [ ] `AiHandwriting.svelte`: `tegaki` 라이브러리를 연동하여 추출된 여백 좌표에 손글씨 웹 폰트로 한글 획순 애니메이션 렌더링 구현
  - [ ] `OxGestureLayer.svelte`: AI가 적은 문장 위에서 사용자가 펜으로 `O`를 그리면 종이 아래로 스며들듯 흡수(Sink-in)되어 로컬 상태에 저장되고, `X`를 그리면 연기처럼 사라진 뒤 오답이 반영된 대체 문장이 다시 적히는 인터랙션 구현
  - [ ] 우측 하단 `잇적` 워터마크(`opacity: 0.15`) 펜촉 더블탭+홀드 시 열리는 기본 `/desk` 보관함 뷰 연결
- [ ] **Step 1-4: Vitest 단위 및 캔버스 라이프사이클 통합 테스트 작성**
  - [ ] `apps/web/src/lib/canvas/__tests__/gesture.test.ts`: Shoelace 면적 및 시작-끝점 거리 비율 기반 `O` 판정 단위 테스트, CCW 교차선 및 관통선 기반 `X` 판정 단위 테스트 작성
  - [ ] `apps/web/src/lib/canvas/__tests__/decayTimer.test.ts`: 30초 대기(투명도 1.0 유지) 및 60초 증발(투명도 선형 감소) 상태 머신 시간 계산 함수 단위 테스트 작성
  - [ ] `apps/web/src/lib/canvas/__tests__/canvasLifecycle.test.ts`: 가상 타이머(`vi.useFakeTimers()`)를 이용한 캔버스 상태 머신 통합 테스트 작성
    * 펜 입력 후 25초 시점에 추가 펜 입력 시 30초 대기 타이머가 정상 리셋되는지 검증
    * 30초 대기 + 60초 증발 만료 시점에 최소 바운딩 박스 크롭 이미지 이벤트가 정상 방출되는지 검증
    * AI 문장 위 O 획 입력 시 해당 문장이 흡수(`isConfirmed = true`) 상태로 전이되는지 검증
  - [x] `npm test -- --run` 실행으로 테스트 100% 통과 확인

### 1차 점검 제출 증빙 가이드 (3단계 확인법)
1. **이번에 만든 것**: Svelte 5 기반 Zero-UI 스타일러스 캔버스, 증발하는 잉크 타이머 엔진, 한글 획순 대필 애니메이션 및 O/X 기하학 제스처 인식기.
2. **확인하는 방법 (3단계 이내)**:
   * 1단계: 접속 후 미색 종이 위에 펜으로 단어와 취소선을 그어 필기하고 손을 뗍니다 (`?fast=1` 모드 시 3초 후 서서히 투명해지며 증발).
   * 2단계: 글씨가 사라진 여백에 AI가 한글 획순대로 단일 추론 문장을 적어 내려가는 것을 확인합니다.
   * 3단계: 문장 위에 펜으로 `O`를 그리면 종이 속으로 흡수되어 저장되고, `X`를 그리면 기각 후 새로운 문장으로 재작성되는지 확인합니다.
3. **AI에게 맡긴 일 vs 내가 판단한 일**:
   * **내가 판단한 일**: 120Hz 펜 입력 시 가상 DOM 렌더링 병목을 제거하기 위해 React 대신 Svelte 5 채택, 손날(Palm) 오작동 방지를 위한 `pointerType === 'pen'` 전용 워터마크 트리거 규칙 설계, 지우개를 없애고 취소선을 추론 데이터로 남기는 UX 설계.
   * **AI에게 맡긴 일**: `perfect-freehand` 기반 폴리곤 스트로크 렌더링, Shoelace 및 CCW 알고리즘을 이용한 O/X 폐곡선·교차선 수학적 판별 코드 작성.

---

## 마일스톤 2 (중간 점검 2차): Hono 백엔드 & Dual-Process (`Jev` + `VLM`) 추론 연동

**목표**: `apps/server` (Hono) 백엔드를 구축하고, 실제 캔버스 필기 크롭 이미지(취소선, 화살표, 마인드맵 포함)와 직전 증발 키워드 맥락을 결합해 **System 1(`Jev` 의사결정) -> System 2(단일 문장 생성)** 파이프라인 및 **`X` 마킹 오답 반영 재추론**을 End-to-End로 완성합니다.

### API 계약 (Request / Response Contract)
* **`POST /api/infer`**
  * **Request JSON**:
    ```json
    {
      "croppedImageBase64": "data:image/png;base64,...",
      "strokeMetadata": { "strokeCount": 12, "bbox": [100, 120, 420, 260], "canvasSize": [2400, 1800] },
      "previousEvaporatedContext": "직전에 증발한 키워드/문장 요약 (없으면 null)",
      "activeHypothesisSentence": "현재 화면에 표출 중인 AI 가설 문장 (없으면 null)",
      "rejectedHypotheses": ["사용자가 방금 X를 쳐서 기각한 문장 목록"],
      "userContext": {
        "persona": { "role": "DevSecOps 취준생", "interests": ["사이드 프로젝트", "보안"] },
        "currentRoutineState": "수요일 16:00 - 개인 작업 및 채용 공고 탐색",
        "evolvingTopics": ["잇적 앱 기획", "Svelte 5 + Hono"],
        "recentConfirmedNotes": ["최근 O를 친 문장 최대 5개"]
      }
    }
    ```
  * **Response JSON**:
    ```json
    {
      "jevDecision": {
        "isContinuousWithPrevious": { "type": "noul", "probability": 0.84, "value": true },
        "inputClassification": { "type": "choice", "selected": "FEEDBACK_REPLY", "confidence": 0.89 },
        "strikethroughIntent": { "type": "choice", "selected": "THOUGHT_PIVOT", "confidence": 0.91 },
        "visualStructure": { "type": "choice", "selected": "CONTRAST_ARROW", "confidence": 0.88 },
        "domainRoute": { "type": "choice", "selected": "SIDE_PROJECT_SPARK", "confidence": 0.79 },
        "marginBox": { "type": "box", "coordinates": [450, 140, 880, 220] }
      },
      "extractedKeywords": { "active": ["Svelte 5", "Hono"], "struckOut": ["React"] },
      "sentence": "가상 DOM 오버헤드가 큰 React 대신 프론트엔드와 백엔드를 Svelte 5와 Hono로 통일해 경량 모노레포를 구성한다는 아이디어 맞나요?"
    }
    ```

### 핵심 추가 기능 명세 (논의 반영)
1. **"새 단어" vs "AI 문장에 대한 답장" 구분 인식 (가장 강조된 피드백)**:
   - **대화 맥락**: "사용자 입력이 답장인지 새 단어인지는 판단하고 쓰게 해야지. 이후에 확장하기로 한 내용은 문장 위에 쓸 수 없는 구조인데..."
   - **추가할 기능**: AI 문장 위가 아니라 문장 바깥 빈 여백에 사용자가 펜으로 글씨를 썼을 때, 이것이 1) AI 문장에 대한 답장/보충 설명인지(예: "아니 DB 먼저", "Redis 추가해"), 2) 완전히 무관한 새로운 독립 메모/키워드인지 위치와 맥락을 비교해 판별하고(`inputClassification`), 답장이면 해당 피드백을 반영해 새 문장을 재작성하고, 새 단어면 기존 문장과 함께 복합 추론합니다.
2. **직전 증발 키워드와의 맥락 연속성 (Noul 시간차 추론)**:
   - **대화 맥락**: 기획 헌법 제2조 & 3조
   - **추가할 기능**: 이미 90초가 지나 완전히 투명해져 증발한 키워드라도, 사용자가 몇 분 뒤 새 단어를 적었을 때 "이전 키워드와 연관된 흐름인가?"를 Jev가 함께 판별(`isContinuousWithPrevious (Noul)`)하여 생각의 연속성을 복원하는 메모리 추론 체인 구축.

### 구현 체크리스트 (Milestone 2)
- [ ] **Step 2-1: `apps/server` Hono 서버 및 메모리 휘발성(Zero-Retention) 미들웨어 구축**
  - [ ] `apps/server/src/index.ts`: Hono 앱 초기화, CORS, IP당 일일 호출 제한(In-Memory Sliding Window Rate Limiter) 구현
  - [ ] `.env.example` 작성 (`GEMINI_API_KEY`, `JEV_API_KEY`, `JEV_ENDPOINT_URL`, `PORT=8787`) — 실제 키는 절대 커밋 금지
- [ ] **Step 2-2: System 1 (`system1Jev.ts`) & System 2 (`system2Writer.ts`) 파이프라인 구현**
  - [ ] `system1Jev.ts`: `/v1/systemone` (`Jev` / `OpenJev`) 규격 호출 및 API 키 미설정 시 Gemini Structured Output(`responseSchema`)으로 100% 동일한 `JevDecisionResult` 타입을 반환하는 듀얼 어댑터 구현
  - [ ] **"새 단어" vs "AI 문장 답장" 및 증발 후 연속성 보장**: `inputClassification` 판별 및 `previousEvaporatedContext`가 존재할 때 `isContinuousWithPrevious (Noul)`를 판정하여, 이미 투명해져 사라진 뒤에 적은 단어라도 맥락이 이어지면 함께 묶어 추론하도록 구현
  - [ ] `system2Writer.ts`: `system1Jev.ts`가 확정한 `THOUGHT_PIVOT`(취소선 의도), `visualStructure`(화살표/트리/표), `inputClassification`, 그리고 `rejectedHypotheses`(사용자가 `X` 친 오답 목록)를 제약 조건으로 받아 **단 1개의 완결된 문장**만 생성 후 메모리에서 이미지 버퍼 즉시 해제
- [ ] **Step 2-3: 프론트엔드-백엔드 실시간 연동**
  - [ ] `PaperCanvas.svelte`에서 잉크 증발 시 `/api/infer` 호출 -> 반환된 `marginBox` 여백 좌표에 `AiHandwriting.svelte`가 `sentence`를 한글 획순으로 필기
  - [ ] 사용자가 `X` 마킹 시 해당 문장을 `rejectedHypotheses` 배열에 추가해 즉시 `/api/infer` 재호출 -> 오답이 배제된 새 문장 대필 검증
- [ ] **Step 2-4: Vitest 백엔드 단위/통합 테스트 작성 및 검증**
  - [ ] `apps/server/src/__tests__/jevAdapter.test.ts`: Jev 원시 응답 및 Gemini Structured Fallback의 `JevDecisionResult` 스키마 일치성 테스트
  - [ ] `apps/server/src/__tests__/continuity.test.ts`: 직전 증발 키워드 맥락 존재 시 `isContinuousWithPrevious (Noul)` 처리 및 프롬프트 결합 로직 검증
  - [ ] `apps/server/src/__tests__/rejectionRefinement.test.ts`: `rejectedHypotheses`에 담긴 문장이 다음 생성 프롬프트의 금지 제약(Negative Constraint)으로 정확히 주입되는지 검증
  - [x] `npm test -- --run` 실행으로 테스트 100% 통과 확인

### 2차 점검 제출 증빙 가이드 (3단계 확인법)
1. **이번에 만든 것**: Hono 기반 무상태 추론 백엔드(`/api/infer`), System 1(`Jev` 타입 판별) + System 2(단일 문장 대필) 파이프라인, 취소선 의도(`THOUGHT_PIVOT`) 해석 및 `X` 마킹 오답 배제 재추론 루프.
2. **확인하는 방법 (3단계 이내)**:
   * 1단계: 캔버스에 `몽고DB`를 적고 취소선으로 지운 뒤 옆에 화살표(`->`)와 `PostgreSQL`을 적습니다.
   * 2단계: 잉크 증발 후 AI가 "단순히 PostgreSQL을 쓴다"가 아니라 **"처음엔 몽고DB를 고려했으나 PostgreSQL로 방향을 선회했다"**는 취소선 맥락까지 포함해 여백에 한 문장으로 적는지 확인합니다.
   * 3단계: 적힌 문장에 `X`를 그었을 때, 이전 가설을 배제하고 다른 관점(예: 업무 대신 사이드 프로젝트 관점)의 새 문장을 즉시 다시 적는지 확인합니다.

### [아키텍처 결정 기록 (ADR): 마일스톤 2.5(로컬 손글씨 OCR + SemIf-OpenJev) 신설 기각 및 v2 로드맵 이관]
- **논의 안건**: 오픈소스 경량 손글씨 모델(`VerifiedIdiot/korean-handwriting-rec` 15MB ONNX)과 로짓 판독 엔진(`TheoLeeCJ/SemIf-OpenJev` Qwen-1.5B GGUF)을 백엔드에 통합하여, "구조화된 입력(로컬 텍스트+기하학 관계 JSON) -> 구조화된 출력(JSON)" 3-Tier 파이프라인으로 전환하는 '마일스톤 2.5' 신설 여부.
- **결정**: **마일스톤 2.5 신설 기각 (SemIf와 로컬 OCR을 한 쌍으로 묶어 v2 확장 백로그로 이관)**
- **결정 근거 (Why & Why Not)**:
  1. *SemIf 도입 시점의 의존성*: `SemIf`는 이미지 픽셀이 아닌 텍스트 기호를 입력받아 선택지 로짓을 판독하므로, 로컬 손글씨 OCR이 선행되지 않은 상태에서 SemIf만 단독 도입하는 것은 기술적으로 불가능함.
  2. *비즈니스 마감 일정 준수*: 채용 핵심 역량(OAuth 2.0 자동 로그인, PG 결제 트랜잭션, Docker 단일 컨테이너 배포)을 검증하는 마일스톤 3 마감 일정을 최우선 보호.
  3. *텍스트 탐지기(Detector) 부재 리스크*: 인식 모델(Recognizer)만으로는 캔버스 비정형 필기 영역 분할 및 화살표/취소선 분리 클러스터링(DBSCAN 등) 전처리가 필요해 공수 폭증.
  4. *C++ 네이티브 바인딩(`onnxruntime-node`, `llama.cpp`) 배포 위험*: Windows 개발 환경과 최종 Linux Docker 멀티스테이지 배포 환경 간의 라이브러리 충돌 위험 사전 회피.
  5. *Ponytail 원칙*: 현행 `gemini-3.8-flash` 1콜 파이프라인으로도 충분히 목적을 달성하므로 조기 최적화(Premature Optimization)를 지양하고 v2 백로그로 이관.

---

## 마일스톤 3 (최종 제출): 소셜 자동 로그인 + 본인 맥락 진화(`profileEnricher`) + PG 결제 및 배포

**목표**: 최초 1회 소셜 로그인 후 다음 접속부터는 곧바로 백지 캔버스만 뜨는 자동 로그인, 온보딩(프로필 + 7일 드래그 시간표), `O`를 칠수록 본인 정보 맥락이 휘발되지 않고 단단해지는 누적기, PG사 결제 검증 및 단일 `Dockerfile` 배포를 완성합니다.

### 구현 체크리스트 (Milestone 3)
- [x] **Step 3-1: 소셜 로그인(OAuth 2.0 + 자동 로그인 세션) 및 온보딩 UI**
  - [x] `apps/server/src/routes/auth.ts`: 카카오 / 구글 OAuth 2.0 인증 콜백 및 `HttpOnly` 장기 세션 토큰(자동 로그인) 발급 라우트 구현 (로컬/심사 환경에서 클릭 한 번으로 즉시 체험 가능한 '데모 계정 원클릭 자동 로그인' 병행 지원)
  - [x] `LoginView.svelte`: 자동 로그인 기본 활성화. 세션이 유효하면 로그인 화면을 0초 만에 건너뛰고 즉시 `PaperCanvas.svelte`만 렌더링
  - [x] `ProfileSetup.svelte` & `RoutineMatrix.svelte`: 직무/관심사 입력 및 마우스·펜 드래그로 색칠하는 7일(월-일) x 타임블록 루틴 매트릭스 구현
- [x] **Step 3-2: 휘발되지 않는 본인 정보 맥락 진화기 (`profileEnricher.ts`)**
  - [x] `apps/server/src/services/profileEnricher.ts`: 사용자가 AI 문장에 동그라미(`O`)를 쳐서 확정(`POST /api/notes/confirm`)할 때마다, 문장 내 핵심 토픽·고유명사·작업 맥락을 추출해 사용자의 `EvolvingContext` (`ongoingTopics`, `domainVocabulary`)에 병합 업데이트
  - [x] `DeskView.svelte` (`/desk` 관리 화면): 워터마크 펜 더블탭+홀드로 진입 시 1) 흡수된 확정 노트 목록, 2) 지금까지 자동으로 단단해진 '내 진화 맥락 태그'(직접 수정/삭제 가능), 3) 시간표 수정 화면을 일반 마우스/키보드 UI로 제공
- [x] **Step 3-3: PG사 결제 연동 및 단일 컨테이너(`Dockerfile`) 배포**
  - [x] `PaymentModal.svelte` & `apps/server/src/routes/billing.ts`: 토스페이먼츠(또는 포트원 V2) 테스트 결제창 호출, 백엔드 결제 승인 금액 위변조 검증 및 Webhook 멱등성(Idempotency Key) 처리 구현
  - [x] 루트 `Dockerfile` 작성: Multi-stage 빌드(`apps/web` 정적 빌드 산출물을 `apps/server` Hono가 서빙)로 단일 컨테이너 패키징 및 배포 URL 확보
- [x] **Step 3-4: Vitest 인증·결제·누적기 통합 테스트 작성 및 검증**
  - [x] `apps/server/src/__tests__/profileEnricher.test.ts`: `O` 확정 문장에서 키워드 추출 및 중복 없는 맥락 병합 로직 검증
  - [x] `apps/server/src/__tests__/billingWebhook.test.ts`: PG 웹훅 동일 이벤트 중복 수신 시 멱등성(Idempotency) 방어 테스트
  - [x] `npm test -- --run` 실행으로 전체 테스트 100% 통과 확인

### 최종 제출 증빙 가이드 (3단계 확인법)
1. **이번에 만든 것**: OAuth 소셜 자동 로그인, 7일 드래그 시간표 온보딩, `O` 확정 기반 본인 정보 맥락 누적기(`profileEnricher`), PG 결제 승인/웹훅 검증 모듈, 단일 Docker 컨테이너 배포.
2. **확인하는 방법 (3단계 이내)**:
   * 1단계: 최초 로그인 및 7일 시간표 드래그 설정 후 새로고침 시, 로그인 창이나 UI 없이 즉시 백지 캔버스로 직행하는지 확인합니다.
   * 2단계: 단어 메모 후 AI 문장에 동그라미(`O`)를 쳐서 흡수시킨 뒤, 워터마크를 통해 `/desk`로 이동하여 **내 프로필 맥락에 방금 확정한 주제가 휘발되지 않고 누적 추가되었는지** 확인합니다.
   * 3단계: `/desk` 내 Pro 업그레이드/후원 메뉴에서 PG사 테스트 결제를 진행하고 결제 승인 검증 및 Pro 상태 전환이 완료되는지 확인합니다.

---

## 마일스톤 4 (v2 고도화 / AI 엔지니어링): 텍스트 맥락 추론 특화 온디바이스 SLM 및 선제적 파이프라인

**목표**: 비전 OCR과 언어 맥락 추론을 분리하고, 텍스트 토큰 간 의미론적 관계 및 다중 턴 맥락 결합을 전담하는 0.5B~2B급 특화 SLM 및 투기적 실행(Speculative Execution) 엔진을 온디바이스(CPU/ONNX)로 구축하여 제로 레이턴시(0ms), API 비용 0원, 프라이버시 100%를 달성합니다.

### 상세 구현 체크리스트 (Milestone 4 Executable Checklist)
- [ ] **Step 4-1: 클라이언트 1.5초 펜 유휴 감지 및 AbortController 상태 머신 구축**
  - [ ] `apps/web/src/lib/canvas/speculativePipeline.ts` 신설: 1.5초 유휴 디바운스 타이머 및 `pointerdown` 발생 시 즉각 중단(`AbortController.abort()`) 로직 구현
  - [ ] `packages/shared/src/speculative.ts` 신설: `SpeculativeInferenceRequest`, `PrefetchedHypothesisSlot` 인터페이스 정의
  - [ ] `apps/web/src/lib/canvas/__tests__/speculativePipeline.test.ts` 작성: 가상 타이머 1.5초 후 선제 요청 방출 및 재터치 시 취소 토큰 무결성 검증
- [ ] **Step 4-2: 프리페치 캐시 풀 및 0ms 트랜지션 연동**
  - [ ] `PaperCanvas.svelte` 라이프사이클 연동: 잉크 투명도 0.0 도달 프레임에서 대기 없이 캐시된 문장을 즉시 `tegaki` 한글 획순 대필로 연결
  - [ ] 최소 호출 간격 3초 쓰로틀(Throttle) 및 네트워크 실패 시 90초 만료 시점 온디맨드 추론으로 조용한 폴백(Silent Fallback) 구현
- [ ] **Step 4-3: 로컬 Jev 기반 장기 맥락 자연어 검색 엔진 구축**
  - [ ] 로컬 SQLite / 인메모리 확정 노트 인덱스 구축 (`confirmed_notes` 테이블)
  - [ ] 30초 펜 유휴 시간 동안 로컬 IPC 루프백으로 과거 수백 개 노트 중 시맨틱 연관 맥락 Top-3 동적 추출 알고리즘 구현
  - [ ] 최근 5개 FIFO 대비 과거 장기 맥락 보존율 벤치마크 테스트 작성
- [ ] **Step 4-4: 3-Tier 온디바이스 모델 통합 및 레이턴시 벤치마크**
  - [ ] Tier 1: `korean-handwriting-rec` (PP-OCRv5 ONNX ~15MB) 획-텍스트 변환기 연동
  - [ ] Tier 2: `SemIf-OpenJev` (Qwen-1.5B INT4) CPU 30ms 단일 포워드 패스 로짓 판독기 연동
  - [ ] Tier 3: 로컬 가설 합성기 결합으로 완전한 Zero-Outbound 기밀성 및 0ms 체감 지연 완성

### 핵심 구현 명세 (Milestone 4 Specifications)
- **0. 선제적 투기적 추론 파이프라인 (Speculative Pre-Inference Engine)**:
  - 펜 유휴 1.5초 감지 시 30초 증발 대기 시간 동안 백그라운드 선제적 필기 변환 및 가설 생성
  - 잉크 소멸 시점 0ms 제로 레이턴시 대필 및 펜 재터치 시 `AbortController` 캐시 무효화
- **1. 로컬 Jev 기반 장기 맥락 자연어 검색 (`pg-jev` / `SemIf` 로컬 바인딩)**:
  - 최근 5개 FIFO 제한을 극복하고 과거 수백 개 확정 노트 중 의미적 연관 맥락 Top-K 동적 추출
  - 로컬 IPC 루프백 통신으로 네트워크 왕복 지연(190ms) 제거 및 무과금 맥락 링킹 달성
- **2. 파이프라인 책임 분리 (Separation of Concerns)**:
  - *Tier 1*: 로컬 경량 한글 OCR (손글씨 획 -> 단어열 및 기호 토큰 추출)
  - *Tier 2*: **전용 맥락 추론 SLM (`Jev-SLM`)** (단어열 + 직전 맥락 + 시간 메타데이터 -> 구조화 Jev JSON 프리미티브 도출)
  - *Tier 3*: 상용 LLM 또는 로컬 생성기 (Jev 결정 프리미티브 기반 단일 완결 문장 합성)
- **3. 합성 데이터셋 구축 (Teacher-Student Data Generation)**:
  - Gemini를 교사 모델로 활용하여 불완전한 메모 단어열과 관계 기호(`->`, `~~`) 10,000건 생성 및 라벨링
- **4. 경량 파인튜닝 (PEFT LoRA)**:
  - `Qwen2.5-0.5B / 1.5B` 또는 `Gemma-2-2B`에 LoRA 파인튜닝 적용
  - 정확한 JSON 출력 스키마 준수율 99% 이상 검증 (DeepEval / Ragas 기반 벤치마크)
- **5. 온디바이스 양자화 및 서빙 (INT4 ONNX Runtime)**:
  - INT4 가중치 양자화로 모델 크기 400MB 이하 압축
  - 브라우저 WebAssembly 또는 백엔드 CPU에서 50ms 미만 초고속 추론 달성

---

## 5. 마일스톤 공통 마감 거버넌스 프로토콜 (4-Step Gate)

모든 마일스톤 세션 종료 전, 에이전트는 아래 4단계를 반드시 통과해야 세션을 마감할 수 있습니다.

### Gate 1: 에이전트 자체 무결성 검증 (Self-Verification)
터미널에서 아래 명령을 순차 실행하여 오류가 0건임을 확인합니다.
1. `npm run check` (TypeScript 및 Svelte 컴파일 오류 0건)
2. `npm test -- --run` (작성된 Vitest 단위/통합 테스트 100% PASS)
3. `npm run build` (프로덕션 빌드 성공 및 dist 산출물 생성)
4. `gitleaks protect --staged` (시크릿 누출 0건)

### Gate 2: 사용자 수동 검증 가이드 제시 (User Acceptance Test)
에이전트는 독단으로 마감하지 않고, 사용자에게 로컬 서버 실행 명령(`npm run dev`)과 함께 브라우저에서 직접 테스트해 볼 수 있는 **구체적인 3단계 시나리오와 디버그 플래그(`?fast=1`)**를 최종 응답에 명확히 안내해야 합니다.

### Gate 3: 부트캠프 제출 양식 보고서 자동 생성 (`docs/submissions/`)
에이전트는 해당 마일스톤의 커밋 로그와 실제 구현 내용을 기반으로, 부트캠프 제출 화면에 복사할 수 있는 보고서 파일(`docs/submissions/SUBMISSION_M{N}.md`)을 자동으로 작성하여 워크스페이스에 저장해야 합니다.

* **보고서 파일 필수 포함 항목 (`SUBMISSION_M{N}.md`)**:
  ```markdown
  # 나의 앱 프로젝트 · {N}/3 (중간 점검 {N}차)

  ### 이번에 만든 것
  (실제 구현한 기능과 동작을 구체적으로 서술)

  ### 확인하는 방법 · 3단계 이내
  1. ...
  2. ...
  3. ...

  ### 바뀐 점과 그 이유
  (이전 계획 대비 수정한 내용과 기술적 이유 서술)

  ### AI에게 맡긴 일과 내가 판단한 일
  - 내가 판단한 일: (아키텍처 결정, 트레이드오프 선택, 제약 조건 등)
  - AI에게 맡긴 일: (보일러플레이트 코드 작성, 수학 알고리즘 수식 구현, 테스트 코드 작성 등)

  ### 다음에 할 일
  (다음 마일스톤 작업 내용 서술)
  ```

### Gate 4: 원자적 커밋 및 Git 태그 발행
모든 테스트와 보고서 생성이 끝나면 10개 이하의 파일로 커밋하고 마일스톤 태그를 발행합니다:
* `git commit -m "feat(milestone-{N}): 마일스톤 {N} 구현 및 검증 완료"`
* `git tag v0.{N}.0-m{N}`

