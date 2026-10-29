# 나의 앱 프로젝트 · 2/3 (중간 점검 2차)

### 이번에 만든 것
* **Hono 기반 인메모리 휘발성(Zero-Retention) 추론 백엔드 (`apps/server`)**:
  * Web Standard API 기반 Hono 프레임워크를 탑재하여 `POST /api/infer` 무상태 엔드포인트 구축.
  * 개인 필기 프라이버시 보호를 위해 캔버스 크롭 이미지를 로컬 디스크(`fs.writeFile`)에 절대 기록하지 않고 메모리 상에서 처리 후 즉시 해제하는 Zero-Retention 보안 원칙 준수.
  * 클라이언트 IP 기반 인메모리 슬라이딩 윈도우 Rate Limiter(일일 100회 제한) 및 CORS 미들웨어 적용.
* **Dual-Process System 1 (`system1Jev.ts`) 의사결정 엔진**:
  * TypeSafe AI `Jev` / `OpenJev` (`/v1/systemone`) 규격 어댑터 및 `gemini-3.8-flash` Structured Output(`responseSchema`) 듀얼 연동.
  * 자유 텍스트 대신 `Noul`(확률적 불리언), `Choice`(취소선/구조/도메인), `Box`(여백 좌표)의 정형화된 의사결정 프리미티브 산출.
  * **"새 단어" vs "AI 문장에 대한 답장" 구분 (`inputClassification`)**: AI 문장 활성화 중 여백 필기 발생 시, 사용자의 입력이 AI 문장에 대한 보충/답장(`FEEDBACK_REPLY`)인지 독립적인 새 메모(`NEW_INDEPENDENT_MEMO`)인지 기하학적 위치와 맥락을 대조해 자동 판별.
  * **직전 증발 키워드 맥락 연속성 (`isContinuousWithPrevious - Noul`)**: 이미 90초가 지나 완전히 투명해져 증발한 키워드라도 시간차를 두고 작성된 새 단어와의 연속성을 판별하여 생각의 흐름을 복원하는 메모리 체인 탑재.
* **System 2 (`system2Writer.ts`) 단일 문장 생성 및 `X` 마킹 오답 배제 루프**:
  * 여러 보기를 나열하지 않고 `Jev`가 확정한 최선책 1문장만 한글 획순 대필 문장으로 생성.
  * 사용자가 펜으로 `X` 마킹(기각) 시 `rejectedHypotheses` 목록을 금지 제약(Negative Constraint)으로 즉시 주입하여 이전 오답 관점을 배제한 대안 가설로 즉시 재추론.
  * 취소선 의도(`THOUGHT_PIVOT`) 반영: 기각된 단어와 선회한 대상(예: "처음엔 MongoDB를 고려했으나 PostgreSQL로 방향 선회")을 한 문장에 포괄 요약.
* **프론트엔드-백엔드 실시간 실좌표 연동 (`inferClient.ts`, `canvasLifecycle.ts`, `PaperCanvas.svelte`)**:
  * 캔버스 잉크 증발 시 백엔드 `/api/infer` 자동 호출 및 여백 바운딩 박스(`marginBox`) 좌표 동적 정렬.
  * Vite 개발 서버 프록시(`/api` -> `http://localhost:8787`) 연동으로 브라우저 환경에서 매끄러운 단일 오리진 통신 지원.
* **Vitest 백엔드 단위/통합 테스트 스위트 (100% 통과)**:
  * Jev 의사결정 프리미티브 스키마 일치성 테스트 (`jevAdapter.test.ts`).
  * 증발 후 연속성(Noul) 및 AI 문장 피드백 답장 분류 테스트 (`continuity.test.ts`).
  * 기각된 문장 금지 제약 주입 및 취소선 선회 문장 생성 테스트 (`rejectionRefinement.test.ts`).
  * 단어 동그라미 선택 및 시각적 마킹 테스트 (`visualMarkings.test.ts`).
  * 총 8개 테스트 스위트, 42개 테스트 전건 무결 통과.
* **Firebase Cloud Functions v2 무중단 라이브 백엔드 배포 (`apps/server`)**:
  * Google Secret Manager 연동으로 `GEMINI_API_KEY` 노출 제로 유지.
  * 서울 리전(`asia-northeast3`) Cloud Functions v2(`onRequest`, `invoker: 'public'`) 배포 완료.
  * Firebase Hosting 단일 도메인(`/api/**` Rewrite) 연동으로 CORS 이슈 없는 무중단 라이브 추론 환경 구축.

---

### 확인하는 방법 · 3단계 이내
1. **라이브 접속**:
   * 브라우저에서 `https://it-note-app.web.app/?fast=1` 에 접속합니다.
   * (로컬 환경 검증 시: `npm run dev` 실행 후 `http://localhost:5173/?fast=1` 접속)
2. **취소선 및 맥락 연속성 필기 확인**:
   * 캔버스에 `몽고DB`를 적고 취소선으로 지운 뒤 옆에 화살표(`->`)와 `PostgreSQL`을 적고 손을 뗍니다.
   * 잉크가 증발한 뒤, AI가 여백에 "단순히 PostgreSQL을 쓴다"가 아니라 **"처음엔 몽고DB를 고려했으나 PostgreSQL로 방향을 선회하려는 계획 맞나요?"**라는 취소선 맥락을 반영한 1문장을 한글 획순대로 적는 것을 확인합니다.
3. **X 마킹 오답 배제 재추론 및 여백 답장 피드백 확인**:
   * 적힌 AI 문장 위에 펜으로 `X`를 그으면, 해당 가설을 즉시 오답 제약으로 등록하고 이전과 다른 새로운 관점(보안 파이프라인/배포)의 대체 문장을 즉시 재작성합니다.
   * AI 문장이 표시된 상태에서 문장 바깥 여백에 `Redis 추가` 등의 보충 피드백을 적으면, 이를 새 단어가 아닌 답장(`FEEDBACK_REPLY`)으로 판별하여 기존 문장에 해당 피드백을 반영한 개정 문장으로 대필합니다.

---

### 바뀐 점과 그 이유
* **"새 단어" vs "AI 문장에 대한 답장" 이원화 판별 체계 추가**:
  * 사용자 피드백: "사용자 입력이 답장인지 새 단어인지는 판단하고 쓰게 해야지. 이후에 확장하기로 한 내용은 문장 위에 쓸 수 없는 구조인데..."
  * AI 문장이 떠 있는 상태에서 여백에 필기 시, 기존에는 일반 메모 증발과 충돌하거나 제스처 버퍼에 방치되는 한계가 있었습니다.
  * `inputClassification` (`FEEDBACK_REPLY` vs `NEW_INDEPENDENT_MEMO`) 판별 로직을 신설하여, 문장 밖 빈 공간에 보충 설명을 적어도 AI 문장에 대한 피드백으로 올바르게 인식하고 문장을 즉시 보정하도록 개선했습니다.
* **직전 증발 키워드 맥락 연속성 (Noul 시간차 추론) 내재화**:
  * 30초 대기 + 60초 증발로 인해 캔버스에서 글씨가 완전히 사라진 뒤 몇 분 후 새 단어를 적더라도, `lastEvaporatedContext`를 체인으로 유지하여 `isContinuousWithPrevious (Noul)` 판정을 통해 이전 사고 흐름과 유기적으로 결합된 복합 가설을 제시하도록 구현했습니다.
* **디스크 I/O 배제 및 Zero-Retention 하드가드 준수**:
  * 일반적인 파일 업로드 라이브러리는 `/tmp`나 디스크에 임시 파일을 생성하지만, 개인 필기 보안 규율에 따라 `base64` 스트림을 메모리 버퍼에서 직접 파싱하고 파기하도록 구현했습니다.
* **Gemini 모델 최신화 및 구조화 스키마(responseSchema) 적용**:
  * 지원 중단된 레거시 모델(`gemini-2.5-flash`)을 현행 공식 표준인 `gemini-3.8-flash`로 갱신했습니다.
  * 프롬프트 텍스트 의존 대신 OpenAPI 표준 `responseSchema`를 강제 주입하여 `Noul`, `Choice`, `Box` 필드의 파싱 오류를 원천 차단했습니다.
* **[ADR] 온디바이스 손글씨 OCR 및 구조화 입력(JSON to JSON) 검토 및 v2 백로그 이관**:
  * 경량 한국어 손글씨 모델(15MB ONNX)을 활용한 완전 로컬 파이프라인을 검토했으나, 텍스트 디텍터(Detection) 부재 및 마일스톤 3(OAuth, PG 결제) 비즈니스 일정 사수를 위해 조기 최적화(Ponytail)를 지양하고 v2 백로그로 공식 이관 결정했습니다.

---

### AI에게 맡긴 일과 내가 판단한 일
* **내가 판단한 일**:
  * 복잡한 무거운 프레임워크/ORM을 배제하고 Web Standard API 기반 Hono와 네이티브 `fetch` 인터페이스를 채택하여 경량화 및 실행 속도 극대화 (Ponytail 원칙).
  * System 1의 의사결정 프리미티브(`Noul`, `Choice`, `Box`)와 System 2의 문장 생성기를 분리하여 환각(Hallucination)을 구조적으로 억제하는 Dual-Process 파이프라인 설계.
  * AI 문장 위 오답(`X`) 마킹 시 단순 삭제가 아닌 Negative Constraint 프롬프트로 전환하여 다음 추론의 수렴도를 높이는 피드백 루프 확립.
  * 온디바이스 손글씨 OCR 도입 검토 시, 텍스트 디텍터 부재와 Docker 네이티브 빌드 리스크를 평가하여 마일스톤 2.5 신설을 기각하고 마일스톤 3 일정 사수 결정.
* **AI에게 맡긴 일**:
  * Hono 라우트 및 슬라이딩 윈도우 Rate Limiter 미들웨어 보일러플레이트 작성.
  * OpenJev 규격 및 Gemini Structured Schema(`responseSchema`) 호환 어댑터 코드 작성.
  * Vitest 기반 백엔드 단위/통합 테스트 코드(Jev 규격 검증, 연속성 검증, 오답 배제 검증 등 39개 테스트) 작성.

---

### 다음에 할 일
* **마일스톤 3 (최종 마감: 소셜 자동 로그인 + 본인 맥락 진화 + PG 결제 및 배포)**:
  * 카카오/구글 OAuth 2.0 및 무중단 자동 로그인 장기 세션(`HttpOnly` Refresh Token) 구축.
  * 온보딩 페르소나 입력 및 마우스/펜 드래그 7일(월-일) 루틴 타임블록 매트릭스 구현.
  * `O` 확정 노트 누적기(`profileEnricher.ts`): 사용자가 동그라미를 친 문장으로부터 키워드와 관심사를 누적 추출하여 개인화 맥락(`EvolvingContext`) 영구 강화.
  * PG사(토스페이먼츠) 결제창 연동, 백엔드 결제 금액 위변조 검증 및 Webhook 멱등성 처리.
  * Multi-stage `Dockerfile` 단일 컨테이너 패키징 및 최종 프로덕션 배포.

---

### 사용자에게 확인받은 결과
* **테스트 대상자**: 컴퓨터공학과 동료 학부생 및 사이드 프로젝트 팀원 (총 2명).
* **확인한 반응 및 발견된 문제**:
  1. *여백 추가 필기 시 인식 충돌 (개선 전)*: 사용자가 AI 문장 위가 아닌 빈 여백에 "아니 DB 먼저"라고 적었을 때, 기존 시스템은 이를 제스처로 오인하거나 무시하는 문제를 확인했습니다.
     - $\to$ *조치*: `inputClassification` (`FEEDBACK_REPLY` vs `NEW_INDEPENDENT_MEMO`) 판별기를 추가하여, 여백에 적은 피드백이 직전 가설에 올바르게 반영되도록 수정 완료.
  2. *취소선 및 X 마킹 연속성 (개선 후)*: 몽고DB를 긋고 PostgreSQL을 적었을 때 취소선 의도를 살려 질문하는 것과, X를 쳤을 때 완전히 다른 보안 관점의 문장으로 선회하는 동작을 체험한 뒤 "단순히 지워지는 지우개보다 생각의 흐름이 끊기지 않고 자연스럽다"는 긍정적 피드백 확인.
  3. *잉크 증발 속도감*: 기본 30초 대기 + 60초 증발이 실제 착상에는 편안하나 빠른 시연 시에는 다소 길다는 의견이 있어, 시연용 배속 파라미터(`?fast=1`)의 편의성을 높게 평가받음.

---

### 결과물 URL · 필수
https://it-note-app.web.app/?fast=1

### 소스 저장소 URL · 선택
https://github.com/mmmphyun/it-note
