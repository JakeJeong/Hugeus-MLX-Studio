# Hugeus MLX Studio

Apple Silicon 환경에서 로컬 LLM을 빠르게 실행하고, 비교하고, 실제 작업 흐름에 붙여보기 위한 프로젝트입니다.

이 저장소는 단순 채팅 앱이 아니라 아래 세 가지를 하나의 흐름으로 묶는 데 초점을 둡니다.

- `backend`: FastAPI 기반 로컬 LLM 제어 서버
- `frontend`: 브라우저 기반 실험용 제어 UI
- `vscode-extension`: VS Code 안에서 쓰는 코딩 보조 패널

핵심 방향은 `MLX`와 `llama.cpp Metal` 경로를 함께 다루면서, 웹 UI와 VS Code extension 양쪽에서 실제 사용성을 검증하는 것입니다.

## 현재 상태

현재 저장소에서 구현되어 있는 큰 축은 다음과 같습니다.

### 1. 백엔드

- FastAPI 기반 API 서버
- 로컬 모델 상태, 런타임 상태, 다운로드 상태 관리
- `mlx`, `llama_cpp`, `mock` 런타임 전환
- 모델 preload / unload / delete / download
- 일반 응답과 스트리밍 응답 모두 지원
- workspace 파일 목록/내용 조회 API 제공

주요 파일:

- [backend/server.py](backend/server.py)
- [backend/app_state.py](backend/app_state.py)
- [backend/model_store.py](backend/model_store.py)
- [backend/workspace_store.py](backend/workspace_store.py)
- [backend/core/runtime.py](backend/core/runtime.py)
- [backend/core/cache_manager.py](backend/core/cache_manager.py)
- [backend/core/metrics.py](backend/core/metrics.py)

### 2. 웹 프론트엔드

- 브라우저에서 로컬 서버를 바로 제어하는 UI
- 모델 선택, 런타임 전환, 다운로드/삭제, 생성 옵션 제어
- workspace 파일 검색 및 컨텍스트 첨부
- TTFT / decode / 메모리 등 메트릭 확인

주요 파일:

- [frontend/index.html](frontend/index.html)
- [frontend/app.js](frontend/app.js)
- [frontend/styles.css](frontend/styles.css)
- [frontend/js/api.js](frontend/js/api.js)
- [frontend/js/controllers/chat.js](frontend/js/controllers/chat.js)
- [frontend/js/controllers/models.js](frontend/js/controllers/models.js)
- [frontend/js/controllers/workspace.js](frontend/js/controllers/workspace.js)

### 3. VS Code Extension

VS Code 확장은 이제 단순 “채팅 MVP”를 넘어서, 실제 파일 작업 흐름을 시험하는 방향으로 많이 확장된 상태입니다.

현재 구현된 흐름:

- Activity Bar 패널에서 로컬 모델과 대화
- 현재 파일/활성 에디터를 컨텍스트로 첨부
- `@` 입력으로 workspace 파일 검색 후 첨부
- 타깃 파일 지정 후 응답을 바로 파일에 반영
- `@@path ...` 프로토콜을 이용한 새 파일 자동 생성
- 없는 폴더를 만들 때는 인라인 확인 UI 표시
- 응답 전체 복사, 코드/마크다운 블록 단위 복사
- 스트리밍 중 코드/마크다운 렌더링 개선
- `⚡ Vibe`에만 과도하게 의존하지 않는 자동 처리 흐름

관련 파일:

- [vscode-extension/README.md](vscode-extension/README.md)
- [vscode-extension/package.json](vscode-extension/package.json)
- [vscode-extension/extension.js](vscode-extension/extension.js)
- [vscode-extension/media/main.js](vscode-extension/media/main.js)
- [vscode-extension/media/main.css](vscode-extension/media/main.css)

## 프로젝트 구조

```text
MLX_project/
├── .vscode/                 루트에서 바로 Extension Host 디버깅
├── backend/                 FastAPI 서버, 런타임, 모델/세션/워크스페이스 관리
├── benchmark/               벤치마크 실행기와 프롬프트 세트
├── docs/                    성능 계획서와 벤치마크 문서
├── frontend/                브라우저 UI
├── scripts/                 실행 스크립트
└── vscode-extension/        VS Code extension 개발 폴더
```

## 아키텍처 요약

```text
VS Code Extension / Web UI
            |
            v
      FastAPI backend
            |
   +--------+---------+
   |                  |
   v                  v
 MLX runtime      llama.cpp Metal runtime
   |                  |
   +--------+---------+
            |
         Local models
```

추가로 backend는 workspace 파일 검색/읽기 API도 제공하고, VS Code extension과 웹 UI는 이를 공용으로 사용합니다.

## 주요 특징

- `MLX`와 `GGUF(llama.cpp Metal)`를 한 인터페이스에서 비교 가능
- 모델 검색, 다운로드, 로컬 모델 관리, 삭제 지원
- `TTFT`, `Prefill`, `Decode`, `Peak Memory` 메트릭 표시
- prefix cache / warmup / 세션 재사용 흐름 실험 가능
- 응답 스트리밍과 상태 표시 지원
- 웹 UI와 VS Code extension을 같은 로컬 서버에 연결 가능
- workspace 파일 컨텍스트 기반 코딩 보조 실험 가능

## 빠른 시작

아래 명령은 이 저장소의 루트 디렉터리에서 실행한다고 가정합니다.

### 1. 의존성 설치

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
```

### 2. 서버 실행

저장소 루트에서:

```bash
./scripts/ui.sh --port 8010
```

브라우저 접속:

- [http://127.0.0.1:8010](http://127.0.0.1:8010)

## 웹 UI 사용

웹 UI는 단순 채팅창이 아니라 로컬 런타임 제어 화면에 가깝습니다.

- 모델 목록/로컬 캐시 상태 확인
- MLX / GGUF 런타임 전환
- generation 옵션 조정
- workspace 파일 검색 및 컨텍스트 첨부
- 메트릭 확인

관련 진입 파일:

- [frontend/index.html](frontend/index.html)
- [frontend/app.js](frontend/app.js)
- [frontend/styles.css](frontend/styles.css)

## VS Code Extension 사용

### 루트에서 바로 디버깅

이제 루트 워크스페이스에서도 바로 `F5`로 extension 디버깅이 가능하도록 설정되어 있습니다.

- 실행 설정: [.vscode/launch.json](.vscode/launch.json)
- extension 진입점: [vscode-extension/package.json](vscode-extension/package.json)

순서:

1. 이 저장소 루트를 VS Code로 엽니다.
2. `Run and Debug`에서 `Run MLX Studio Extension`을 선택합니다.
3. `F5`를 누릅니다.
4. Extension Host 창에서 `MLX Studio: Open Chat Panel`을 실행합니다.

### 주요 명령

- `MLX Studio: Open Chat`
- `MLX Studio: Open Chat Panel`
- `MLX Studio: Start Local Server`
- `MLX Studio: Add Active File To Chat`
- `MLX Studio: Add Selection To Chat`

### 현재 확장에서 중요한 동작

- 일반 채팅은 그냥 응답으로 남음
- 응답이 “수정 가능한 코드 블록” 형태면 타깃 파일에 적용 후보로 해석
- 응답이 `@@path` + 코드 블록 형태면 새 파일 생성으로 해석
- 폴더가 없으면 바로 만들지 않고 인라인 확인 후 생성

상세 설명은 [vscode-extension/README.md](vscode-extension/README.md)에 정리되어 있습니다.

## 주요 API

대표 엔드포인트:

- `GET /api/health`
- `GET /api/status`
- `GET /api/activity`
- `GET /api/models`
- `GET /api/models/local`
- `GET /api/models/gguf`
- `POST /api/runtime`
- `POST /api/models/select`
- `POST /api/models/unload`
- `POST /api/models/delete`
- `POST /api/models/search`
- `POST /api/models/download`
- `POST /api/models/download/cancel`
- `POST /api/settings`
- `POST /api/chat`
- `POST /api/chat/stream`
- `GET /api/workspace/files`
- `POST /api/workspace/file`

## 벤치마크와 문서

- 벤치마크 실행기: [benchmark/run_benchmark.py](benchmark/run_benchmark.py)
- 성능 계획 문서: [docs/mlx-llm-performance-plan.md](docs/mlx-llm-performance-plan.md)
- 벤치마크 문서: [docs/benchmark-spec.md](docs/benchmark-spec.md)

## 현재 포지셔닝

이 프로젝트는 “모든 모델에서 최고 정확도” 자체보다 아래 쪽에 더 가깝습니다.

- Apple Silicon용 로컬 LLM 실행/제어 환경
- MLX vs llama.cpp 비교 실험장
- 웹 기반 로컬 LLM 운영 도구
- VS Code 안으로 확장 가능한 코딩 보조 런타임

즉, 모델을 직접 만드는 프로젝트라기보다 로컬 LLM을 더 잘 로드하고, 더 잘 제어하고, 더 자연스러운 작업 흐름에 붙이는 제품 실험에 가깝습니다.

## 다음에 계속 키우기 좋은 부분

- VS Code extension의 모듈 분리
- 더 안정적인 파일 생성/수정 프로토콜
- multi-file 작업과 diff preview
- 모델별 프롬프트/출력 복구 전략 개선
- 벤치마크와 실제 편집 UX 연결
