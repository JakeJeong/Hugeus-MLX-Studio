# Hugeus MLX Studio

Apple Silicon 환경에서 로컬 LLM을 빠르게 제어하고 실험하기 위한 프로젝트입니다.  
핵심 목표는 `MLX`와 `llama.cpp Metal` 경로를 한곳에서 다루면서, 웹 UI와 VS Code Extension으로 실제 사용감까지 검증하는 것입니다.

## 무엇을 만드는 프로젝트인가

이 저장소는 단순 채팅 앱이 아니라 아래 3가지를 함께 다룹니다.

- `backend`
  - FastAPI 기반 로컬 LLM 제어 서버
  - MLX / llama.cpp Metal 런타임 전환
  - 모델 로드, 언로드, 다운로드, 삭제, 스트리밍 응답, 세션 관리
- `frontend`
  - 브라우저 기반 LLM 제어 UI
  - 모델 매니저, 런타임 전환, 워크스페이스 파일 컨텍스트, 성능 메트릭 확인
- `vscode-extension`
  - VS Code 안에서 로컬 서버에 붙는 채팅 패널
  - 활성 파일/선택 영역을 컨텍스트로 보내는 코딩 보조용 MVP

## 주요 특징

- `MLX`와 `GGUF(llama.cpp Metal)`를 한 UI 안에서 비교 가능
- 모델 검색, 다운로드, 로컬 모델 관리, 삭제 지원
- `TTFT`, `Prefill`, `Decode`, `Peak Memory` 메트릭 표시
- `prefix cache`, `session KV reuse`, `warmup` 기반 체감 속도 개선
- 응답 스트리밍 및 `Thinking / Responding / Reasoning` 상태 표시
- 웹 기반 LLM 제어와 VS Code 내부 채팅 패널을 함께 제공

## 프로젝트 구조

```text
backend/           FastAPI 서버, 런타임, 모델/세션/워크스페이스 관리
frontend/          브라우저 UI
vscode-extension/  VS Code webview extension MVP
benchmark/         성능 벤치마크 실행기와 프롬프트 세트
docs/              성능 계획서와 벤치마크 문서
scripts/           실행 스크립트
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
   (MLX repos / local GGUF files)
```

## 빠른 시작

### 1. 의존성 설치

```bash
cd /Users/hugeus/develop/hugeus/MLX_project
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
```

### 2. 웹 서버 실행

기본 스크립트는 `uvicorn`으로 FastAPI 서버를 실행합니다.

```bash
cd /Users/hugeus/develop/hugeus/MLX_project
./scripts/ui.sh --port 8010
```

브라우저에서 아래 주소로 접속합니다.

- [http://127.0.0.1:8010](http://127.0.0.1:8010)

## 웹 기반 LLM 제어 UI

웹 UI는 단순 채팅창이 아니라, 로컬 런타임 제어 화면에 가깝게 설계되어 있습니다.

- `Manage Models`
  - 로컬 MLX / GGUF 모델 목록
  - 모델 전환, 삭제, GGUF 파일 선택
- `Generation controls`
  - max tokens, temperature, top-p, top-k, min-p
  - repeat penalty, stop strings, thinking mode
- `Workspace context`
  - 파일 검색 및 미리보기
  - 파일을 채팅 컨텍스트에 직접 첨부
- `Runtime metrics`
  - TTFT / Prefill / Decode / Peak Memory

프론트 코드는 아래에 있습니다.

- [frontend/index.html](/Users/hugeus/develop/hugeus/MLX_project/frontend/index.html)
- [frontend/app.js](/Users/hugeus/develop/hugeus/MLX_project/frontend/app.js)
- [frontend/js](/Users/hugeus/develop/hugeus/MLX_project/frontend/js)
- [frontend/styles.css](/Users/hugeus/develop/hugeus/MLX_project/frontend/styles.css)

## 백엔드 구성

백엔드는 FastAPI 서버 위에 로컬 추론 런타임을 얹은 구조입니다.

- 상태 관리: [backend/app_state.py](/Users/hugeus/develop/hugeus/MLX_project/backend/app_state.py)
- 서버 엔드포인트: [backend/server.py](/Users/hugeus/develop/hugeus/MLX_project/backend/server.py)
- 모델 관리: [backend/model_store.py](/Users/hugeus/develop/hugeus/MLX_project/backend/model_store.py)
- 런타임 구현: [backend/core/runtime.py](/Users/hugeus/develop/hugeus/MLX_project/backend/core/runtime.py)
- 캐시 전략: [backend/core/cache_manager.py](/Users/hugeus/develop/hugeus/MLX_project/backend/core/cache_manager.py)

지원하는 런타임:

- `mlx`
- `llama_cpp`
- `mock`

주요 API:

- `GET /api/status`
- `GET /api/models/local`
- `GET /api/models/gguf`
- `POST /api/models/select`
- `POST /api/models/download`
- `POST /api/chat/stream`
- `POST /api/settings`

## VS Code Extension

VS Code 확장은 이 저장소의 웹 UI를 그대로 옮긴 것이 아니라, 코딩 보조에 필요한 흐름만 먼저 옮긴 MVP입니다.

주요 기능:

- 오른쪽 패널로 채팅 열기
- 로컬 서버 상태 확인
- 로컬 MLX / GGUF 모델 전환
- 활성 파일 / 선택 영역을 컨텍스트로 첨부
- 스트리밍 응답 표시

관련 파일:

- [vscode-extension/package.json](/Users/hugeus/develop/hugeus/MLX_project/vscode-extension/package.json)
- [vscode-extension/extension.js](/Users/hugeus/develop/hugeus/MLX_project/vscode-extension/extension.js)
- [vscode-extension/media/main.js](/Users/hugeus/develop/hugeus/MLX_project/vscode-extension/media/main.js)
- [vscode-extension/media/main.css](/Users/hugeus/develop/hugeus/MLX_project/vscode-extension/media/main.css)

실행 방법:

1. `vscode-extension` 폴더를 VS Code에서 엽니다.
2. `F5`로 Extension Development Host를 실행합니다.
3. Command Palette에서 아래 명령 중 하나를 실행합니다.
   - `MLX Studio: Open Chat`
   - `MLX Studio: Open Chat Panel`
   - `MLX Studio: Start Local Server`

기본 서버 주소는 `http://127.0.0.1:8010`입니다.

## 벤치마크

이 프로젝트는 단순히 “대화가 되느냐”가 아니라, 실제 성능 비교도 염두에 두고 있습니다.

- 벤치마크 실행기: [benchmark/run_benchmark.py](/Users/hugeus/develop/hugeus/MLX_project/benchmark/run_benchmark.py)
- 프롬프트 세트: [benchmark/prompts](/Users/hugeus/develop/hugeus/MLX_project/benchmark/prompts)
- 계획 문서: [docs/mlx-llm-performance-plan.md](/Users/hugeus/develop/hugeus/MLX_project/docs/mlx-llm-performance-plan.md)

## 현재 포지셔닝

이 프로젝트는 “모든 모델에서 최고 정확도”를 목표로 하기보다 아래에 더 가깝습니다.

- Apple Silicon용 로컬 LLM 실행기
- 웹 기반 LLM 제어 도구
- MLX vs llama.cpp 실험장
- VS Code 안으로 확장 가능한 코딩 보조 런타임

즉, 모델 자체를 만드는 프로젝트라기보다 `로컬 LLM을 더 잘 로드하고, 더 잘 제어하고, 더 잘 비교하는 제품`에 가깝습니다.

## 참고

- 웹 UI 실행 스크립트: [scripts/ui.sh](/Users/hugeus/develop/hugeus/MLX_project/scripts/ui.sh)
- 터미널 REPL: [backend/chat_repl.py](/Users/hugeus/develop/hugeus/MLX_project/backend/chat_repl.py)
- 벤치마크 문서: [docs/benchmark-spec.md](/Users/hugeus/develop/hugeus/MLX_project/docs/benchmark-spec.md)
