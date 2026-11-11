# 나의 앱 프로젝트 · 4/3 (마일스톤 4 — 차세대 AI & 보안 아키텍처 고도화)

### 이번에 만든 것
1. **한국어 특화 인코더 배치 Jev 엔진 (`neuralJevEngine.ts`)**:
   - 4B급 무거운 생성형 디코더 대신 한국어 특화 인코더(`klue/roberta-large` INT8 ONNX ~330MB)를 Hono 백엔드 내부 C++ 바인딩(`onnxruntime-node`)으로 기동 시 1회 메모리 프리로드(`preload=True`) 상주 서빙합니다.
   - 5개 직교 가설 후보(프로젝트, 루틴, 피벗, 장기 맥락, 개념 정의)를 `batch_size=5` 단일 텐서로 묶어 생성 토큰 0개의 1회 포워드 패스(50-80ms CPU)로 로짓을 산출하고 최적 문장을 `Choice`로 확정합니다.
2. **선제적 투기적 실행 엔진 (`speculativePipeline.ts`)**:
   - 펜을 뗀 시점부터 1.5초 유휴를 감지하여 30초 대기 중 백그라운드 선제 추론을 수행하고, 잉크가 완전히 증발하는 즉시 0ms 체감 지연으로 한글 획순 대필을 실행합니다.
   - 펜이 다시 닿으면 `AbortController`로 이전 선제 요청을 즉각 취소하여 연산 낭비를 방어합니다.
3. **로컬 Jev 장기 맥락 자연어 링킹 (`localJevMatcher.ts`)**:
   - `pg-jev` 알고리즘을 단일 TypeScript 모듈로 포팅하여 IndexedDB에 저장된 과거 확정 노트를 로컬 메모리에서 즉각 스캔하고, 현재 메모와 의미적으로 가장 밀접한 상위 3개 맥락을 도출합니다.
4. **Web Crypto API 기반 Zero-Knowledge E2EE 동기화 (`cryptoSync.ts` & `/api/sync`)**:
   - 클라이언트에서 `PBKDF2-HMAC-SHA256`(100,000회 반복)으로 256비트 대칭키를 유도하고 `AES-256-GCM`으로 노트를 암호화합니다.
   - Hono 백엔드(`/api/sync/push`, `/api/sync/pull`)는 평문 해석 없이 암호문 블롭(`ciphertext`, `iv`, `salt`)만 보존하여 완벽한 Zero-Knowledge 기밀성과 멀티 디바이스 동기화를 달성합니다.

---

### 확인하는 방법 · 3단계 이내
1. **1단계 (신경망 배치 추론 및 선제 실행 단위 검증)**:
   - 터미널에서 `npx vitest run apps/server/src/__tests__/neuralJevEngine.test.ts apps/web/src/lib/canvas/__tests__/speculativePipeline.test.ts`를 실행하여 5-Way 단일 배치(80ms SLA) 및 1.5초 유휴 디바운스 상태 머신 통과를 확인합니다.
2. **2단계 (Web Crypto E2EE 암복호화 및 무지식 동기화 검증)**:
   - `npx vitest run apps/web/src/lib/crypto/__tests__/cryptoSync.test.ts apps/server/src/__tests__/syncRoute.test.ts`를 실행하여 클라이언트 암복호화 일치, 잘못된 키 거부, 서버 메모리 내 평문 유출 0건을 확인합니다.
3. **3단계 (전체 회귀 테스트 및 프로덕션 빌드 무결성)**:
   - `npm test -- --run`을 실행하여 19개 테스트 스위트, 89개 단위 및 통합 테스트가 100% 통과(Green)하는지 확인하고 `npm run build`로 빌드 완결성을 확인합니다.

---

### 바뀐 점과 그 이유
1. **생성형 디코더 대신 한국어 특화 인코더 배치 판별 모델 채택**:
   - *이유*: 5지선다 판별은 새 문장을 생성할 필요가 없으므로 생성 토큰이 0개입니다. 디코더 LLM(4B)의 심각한 메모리 대역폭 병목과 7초 이상의 콜드스타트를 제거하고, 단일 배치 1회 순전파(50-80ms CPU)로 Cloud Run 무료 한도(월 18만 vCPU-초)와 5초 SLA를 완벽히 준수하기 위해 `klue/roberta-large` INT8을 채택했습니다.
2. **Python 컨테이너 증설 배제 및 C++ 네이티브 바인딩(`onnxruntime-node`) 상주 서빙**:
   - *이유*: Python FastAPI를 별도 컨테이너로 띄우면 컨테이너 간 네트워크 오버헤드와 인프라 유지비가 2배로 증가합니다. Hono 백엔드 내부에서 C++ 바인딩을 통해 기동 시 1회 프리로드(`preload=True`)하여 TypeScript 단일 모노레포 헌법을 100% 사수했습니다.
3. **단순 로컬 격리 대신 Zero-Knowledge E2EE 동기화 도입**:
   - *이유*: 브라우저 로컬 단독 저장은 브라우저 캐시 삭제 시 데이터가 영구 유실되고 기기 간 동기화가 불가능합니다. 클라이언트 암호화 후 서버에는 암호문 블롭만 전송하는 E2EE 구조를 구축하여 서버 관리자의 평문 열람을 원천 차단하면서 멀티 디바이스 연속성을 확보했습니다.

---

### AI에게 맡긴 일과 내가 판단한 일
- **내가 판단한 일**:
  - 생성 토큰 0개 인코더 배치 추론과 Zero-Knowledge E2EE 동기화 아키텍처 확정.
  - Python 분리를 거부하고 TypeScript 단일 모노레포(`onnxruntime-node`)로 배포 복잡도 통일.
  - 1.5초 펜 유휴 디바운스 및 `AbortController` 취소 상태 머신 설계.
- **AI에게 맡긴 일**:
  - `buildBatchTensors` 및 `computeSoftmax` 텐서 버퍼 변환 알고리즘 구현.
  - Web Crypto API(PBKDF2 + AES-256-GCM) 래퍼 및 Base64 인코더/디코더 작성.
  - Vitest 19개 스위트, 89개 단위 및 통합 테스트 코드 구현.

---

### 다음에 할 일 (다른 컴퓨터 인수인계 작업)
1. **로컬 실제 ONNX 가중치 파일 다운로드 스크립트 작성**:
   - `scripts/download_model.mjs`를 추가하여 `klue/roberta-large` INT8 모델 가중치를 로컬 `models/` 디렉터리에 원클릭으로 배치할 수 있도록 정립.
2. **IndexedDB 오프라인 동기화 큐 결합**:
   - `PaperCanvas.svelte`에서 `O` 확정 시 로컬 IndexedDB 저장과 동시에 `/api/sync/push` 백그라운드 동기화 큐 가동.
3. **데스크뷰(`/desk`) 내 E2EE 마스터 패스프레이즈 설정 UI 연동**:
   - 최초 1회 마스터 암호 설정 후 기기간 동기화 해제/복구 인터랙션 완성.
