# MLX Studio 벤치마크 기준서

## 1. 목적

이 문서는 `MLX Studio`가 `Ollama` 및 가능하면 `LM Studio`보다 실제로 더 빠르거나 더 효율적인지 검증하기 위한 공정한 비교 기준을 정의한다.

이 문서의 목적은 세 가지다.

- 비교 조건을 고정해 결과 해석이 흔들리지 않게 한다.
- 구현 변경 전후의 성능 차이를 재현 가능하게 측정한다.
- "체감상 빠르다"가 아니라 수치로 판단한다.

## 2. 비교 원칙

모든 비교는 아래 원칙을 우선 적용한다.

- 같은 하드웨어에서 측정한다.
- 같은 모델 계열을 사용한다.
- 가능한 한 동등한 양자화 수준을 사용한다.
- 같은 프롬프트 세트, 같은 출력 길이, 같은 샘플링 조건을 사용한다.
- 각 실험은 반복 실행 후 중앙값과 상위 백분위수를 함께 본다.
- 단일 최고 기록이 아니라 반복 가능한 평균 성능을 본다.

## 3. 비교 대상

초기 비교 대상은 아래 3개다.

- `MLX Studio` 자체 런타임
- `Ollama`
- 가능하면 `LM Studio`

비교 대상이 추가되더라도 초기 기준은 `MLX Studio vs Ollama`를 우선한다.

이유:

- `Ollama`는 자동화가 상대적으로 쉽다.
- 실질적으로 `llama.cpp` 계열과의 비교 성격을 가진다.
- 초기 벤치마크 자동화 기준점으로 적합하다.

## 4. 하드웨어 및 시스템 조건

초기 공식 기준 환경은 아래와 같다.

- 기기: `Apple M4 Mac mini`
- 메모리: `16GB unified memory`
- 전원 상태: 전원 연결
- 실행 모드: 배터리 절약 모드 비활성
- 백그라운드 앱: 가능한 한 최소화
- 네트워크 상태: 모델 다운로드 완료 후 벤치마크 중 네트워크 의존 제거

기록해야 할 환경 정보:

- macOS 버전
- MLX 버전
- Python 버전
- Ollama 버전
- LM Studio 버전
- 모델 이름과 정확한 리비전

## 5. 모델 선정 기준

초기 모델은 아래처럼 2개까지로 제한한다.

- `3B`급 instruct 모델 1개
- `7B`급 instruct 모델 1개

선정 조건:

- `MLX`와 `Ollama`에서 모두 사용 가능한 모델이어야 한다.
- 채팅 템플릿이 명확해야 한다.
- 실제 사용 빈도가 높은 instruct 계열이어야 한다.
- 16GB 환경에서 안정적으로 반복 측정 가능해야 한다.

초기 권장 후보:

- `Llama 3.2 3B Instruct`
- `Qwen2.5 7B Instruct` 또는 `Llama 3.1 8B` 대신 메모리 안정성이 더 좋은 7B급

## 6. 양자화 공정성 원칙

완전 동일 포맷 비교가 불가능할 수 있으므로, 아래 순서로 공정성을 맞춘다.

1. 같은 원본 모델 계열을 쓴다.
2. 가능한 한 같은 bit 수준을 맞춘다.
3. 템플릿과 토크나이저 동작 차이가 있으면 문서에 명시한다.
4. 완전 동일 비교가 불가능하면 결과를 `참고 비교`로 표기한다.

초기 원칙:

- `MLX`: 공식 또는 널리 사용되는 `4bit` MLX 변환 모델
- `Ollama/LM Studio`: 가능한 한 동등한 `Q4` 수준 모델

다음 경우에는 "직접 비교 불가"로 기록한다.

- 토크나이저 결과가 의미 있게 다를 때
- chat template 차이로 prompt token 수가 크게 달라질 때
- 동일 모델 계열이라고 보기 어려운 변형일 때

## 7. 고정 실험 조건

모든 런타임에서 아래 조건을 고정한다.

- `temperature`: `0.0`
- `top_p`: 가능한 경우 고정값 적용, 불가 시 명시
- `max_tokens`: 실험별 고정
- `system prompt`: 동일
- `user prompt`: 동일
- `streaming`: 측정 목적에 맞게 고정
- `동시 요청 수`: 1
- `warm/cold` 상태: 명시적으로 분리

## 8. 실험 구분

### 8.1 Cold Start Test

목적:

- 모델이 메모리에 없는 상태에서 시작 성능 측정

측정 항목:

- load time
- first request TTFT
- first request peak memory

### 8.2 Warm Single-Turn Test

목적:

- 모델 로드 후 단일 요청 처리 성능 측정

측정 항목:

- TTFT
- prefill throughput
- decode throughput
- peak memory

### 8.3 Warm Repeated Prompt Test

목적:

- 동일한 system prompt와 유사한 요청이 반복될 때 캐시 효과 측정

측정 항목:

- request 1 대비 request 2~N의 TTFT 변화
- prefix cache hit 여부
- 평균 decode throughput 변화

### 8.4 Multi-Turn Chat Test

목적:

- 실제 채팅형 사용 시나리오에서 turn이 누적될 때 성능 유지 여부 측정

측정 항목:

- turn별 TTFT
- turn별 prefill 시간
- turn 증가에 따른 메모리 변화
- session KV reuse 적용 전후 차이

## 9. 프롬프트 세트

프롬프트는 길이와 목적별로 분리한다.

- `short`: 짧은 일반 질문
- `medium`: 다중 문장 지시와 제약이 있는 질문
- `long`: 긴 system prompt 또는 긴 문맥이 포함된 질문

권장 개수:

- 각 그룹당 `5~10개`
- 전체 `15~20개`

프롬프트 설계 원칙:

- 지식 정답 여부보다 추론 경로 길이가 안정적인 질문을 우선한다.
- 동일 조건 재현이 쉬운 질문을 사용한다.
- 툴 사용, 웹 검색, 함수 호출 같은 외부 변수는 제외한다.

## 10. 측정 지표 정의

### 필수 지표

- `Load Time`
  - 정의: 요청 가능한 상태가 될 때까지 걸린 시간

- `TTFT`
  - 정의: 요청 전송 시점부터 첫 출력 토큰 수신까지 시간

- `Prefill Time`
  - 정의: 입력 프롬프트를 모델 상태로 반영하는 데 걸린 시간

- `Prefill Throughput`
  - 정의: prefill token 수 / prefill 시간

- `Decode Time`
  - 정의: 첫 토큰 이후 나머지 출력 토큰 생성에 걸린 시간

- `Decode Throughput`
  - 정의: output token 수 / decode 시간

- `Peak Memory`
  - 정의: 요청 처리 중 최대 메모리 사용량
  - 단위: `GB`

### 보조 지표

- `Prompt Tokens`
- `Completion Tokens`
- `Cache Hit Rate`
- `P50`, `P95`, `P99`
- 표준편차

## 11. 측정 횟수와 통계 처리

초기 기준:

- 각 시나리오별 `20회` 반복
- 결과는 `평균`보다 `P50`을 우선 보고
- 흔들림 확인용으로 `P95`를 함께 기록

이상치 처리 원칙:

- 명백한 오류 로그가 있는 실행은 별도 표기 후 제외 가능
- 제외 시 제외 이유를 반드시 결과 파일에 남긴다
- 조용히 버린 결과는 허용하지 않는다

## 12. 공정성 체크리스트

각 벤치마크 실행 전 아래를 확인한다.

- 모델이 정확히 일치하는가
- 양자화 수준이 동등한가
- system prompt가 같은가
- 출력 토큰 제한이 같은가
- temperature가 같은가
- warm/cold 상태가 명확한가
- 동일 실행 횟수를 사용했는가
- 다른 앱이 대량 메모리를 점유하고 있지 않은가

## 13. 결과 해석 규칙

다음 경우 `MLX Studio 우세`로 본다.

- `TTFT`가 `20%` 이상 개선되거나
- `Decode Throughput`이 `10%` 이상 개선되거나
- `Peak Memory`가 `15%` 이상 절감되고
- 결과가 반복 실행에서 일관되게 유지될 때

다음 경우 `부분 우세`로 본다.

- `TTFT`는 개선되지만 decode는 비슷하거나 더 느릴 때
- 메모리는 유리하지만 cold start는 불리할 때
- 특정 prompt category에서만 개선될 때

다음 경우 `우세 주장 보류`로 본다.

- 비교 포맷이 공정하지 않을 때
- 반복 실행에서 변동성이 너무 클 때
- warm/cold 상태가 섞였을 때

## 14. 로그 포맷

각 실행은 최소 아래 필드를 기록한다.

```json
{
  "runtime": "mlx_studio",
  "model_id": "mlx-community/Llama-3.2-3B-Instruct-4bit",
  "model_family": "llama-3.2-3b-instruct",
  "quantization": "4bit",
  "scenario": "warm_single_turn",
  "prompt_group": "medium",
  "run_index": 1,
  "prompt_tokens": 412,
  "completion_tokens": 200,
  "load_time_ms": 0,
  "ttft_ms": 84.2,
  "prefill_time_ms": 61.8,
  "prefill_tps": 6667.0,
  "decode_time_ms": 3012.7,
  "decode_tps": 66.4,
  "peak_memory_gb": 4.2805,
  "cache_hit": false,
  "notes": ""
}
```

## 15. 구현 전 최소 완료 조건

벤치마크 자동화 전에 아래가 준비되어 있어야 한다.

- prompt JSON 포맷 확정
- metrics logger 형식 확정
- cold/warm 실행 절차 문서화
- Ollama 호출 방식 확정
- MLX Studio 호출 방식 확정

## 16. 초반 실험 우선순위

가장 먼저 할 실험은 아래 4개다.

1. `3B warm single-turn` 기준 `MLX Studio vs Ollama`
2. `3B repeated prompt` 기준 prefix cache 효과 확인
3. `7B warm single-turn` 기준 메모리 안정성 확인
4. `multi-turn chat` 기준 session KV reuse 필요성 확인

## 17. 실패해도 남는 것

벤치마크 결과에서 `MLX Studio`가 바로 이기지 못하더라도 아래는 반드시 남아야 한다.

- 병목이 `prefill`인지 `decode`인지 구분한 데이터
- Python 오버헤드가 의미 있는지 여부
- 캐시 전략이 실제로 먹히는지 여부
- Swift 전환이 필요한지 아닌지 판단 근거

즉, 첫 벤치마크의 목적은 승리 선언이 아니라 다음 최적화 우선순위를 정확히 잡는 것이다.
