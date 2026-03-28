from __future__ import annotations

import copy
import importlib.util
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Protocol

from backend.core.cache_manager import PromptCacheMatch, SessionCache, SharedPrefixCache
from backend.core.metrics import BenchmarkRecord
from backend.core.prompts import PromptCase

_LLAMA_TEMPLATE_PATCHED = False


@dataclass
class GenerationResult:
    runtime: str
    model_id: str
    model_family: str
    quantization: str
    prompt_tokens: int
    completion_tokens: int
    load_time_ms: float
    ttft_ms: float | None
    prefill_time_ms: float | None
    prefill_tps: float | None
    decode_time_ms: float | None
    decode_tps: float | None
    total_time_ms: float
    peak_memory_gb: float | None
    cache_hit: bool
    cached_tokens: int
    cache_source: str
    output_text: str
    notes: str = ""

    def metrics_dict(self) -> dict[str, float | int | bool | str | None]:
        return {
            "ttft_ms": self.ttft_ms,
            "prefill_time_ms": self.prefill_time_ms,
            "prefill_tps": self.prefill_tps,
            "decode_time_ms": self.decode_time_ms,
            "decode_tps": self.decode_tps,
            "load_time_ms": self.load_time_ms,
            "peak_memory_gb": self.peak_memory_gb,
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_time_ms": self.total_time_ms,
            "cache_hit": self.cache_hit,
            "cached_tokens": self.cached_tokens,
            "cache_source": self.cache_source,
        }

    def to_record(self, prompt: PromptCase, scenario: str, run_index: int) -> BenchmarkRecord:
        return BenchmarkRecord(
            runtime=self.runtime,
            model_id=self.model_id,
            model_family=self.model_family,
            quantization=self.quantization,
            scenario=scenario,
            prompt_group=prompt.prompt_group,
            prompt_id=prompt.prompt_id,
            run_index=run_index,
            prompt_tokens=self.prompt_tokens,
            completion_tokens=self.completion_tokens,
            load_time_ms=self.load_time_ms,
            ttft_ms=self.ttft_ms,
            prefill_time_ms=self.prefill_time_ms,
            prefill_tps=self.prefill_tps,
            decode_time_ms=self.decode_time_ms,
            decode_tps=self.decode_tps,
            total_time_ms=self.total_time_ms,
            peak_memory_gb=self.peak_memory_gb,
            cache_hit=self.cache_hit,
            cached_tokens=self.cached_tokens,
            cache_source=self.cache_source,
            output_preview=self.output_text[:120],
            notes=self.notes,
        )


class Runtime(Protocol):
    def load(self) -> None:
        ...

    def warmup(self) -> None:
        ...

    def unload(self) -> None:
        ...

    def is_loaded(self) -> bool:
        ...

    def current_model(self) -> str:
        ...

    def generate(self, prompt: PromptCase, max_tokens: int, temperature: float) -> GenerationResult:
        ...

    def generate_messages(
        self,
        messages: list[dict[str, str]],
        max_tokens: int,
        temperature: float,
        top_p: float = 0.0,
        min_p: float = 0.0,
        top_k: int = 0,
        repetition_penalty: float | None = None,
        repetition_context_size: int = 20,
        stop_strings: list[str] | None = None,
        enable_thinking: bool = False,
        session_id: str | None = None,
    ) -> GenerationResult:
        ...

    def stream_messages(
        self,
        messages: list[dict[str, str]],
        max_tokens: int,
        temperature: float,
        top_p: float = 0.0,
        min_p: float = 0.0,
        top_k: int = 0,
        repetition_penalty: float | None = None,
        repetition_context_size: int = 20,
        stop_strings: list[str] | None = None,
        enable_thinking: bool = False,
        session_id: str | None = None,
    ) -> Iterator[dict[str, object]]:
        ...


class MockRuntime:
    def __init__(self, model_id: str) -> None:
        self.model_id = model_id
        self._load_time_ms = 150.0
        self._loaded = False
        self._warmed = False

    def generate(self, prompt: PromptCase, max_tokens: int, temperature: float) -> GenerationResult:
        return self.generate_messages(
            prompt.messages(),
            max_tokens=max_tokens,
            temperature=temperature,
        )

    def generate_messages(
        self,
        messages: list[dict[str, str]],
        max_tokens: int,
        temperature: float,
        top_p: float = 0.0,
        min_p: float = 0.0,
        top_k: int = 0,
        repetition_penalty: float | None = None,
        repetition_context_size: int = 20,
        stop_strings: list[str] | None = None,
        enable_thinking: bool = False,
        session_id: str | None = None,
    ) -> GenerationResult:
        start = time.perf_counter()
        load_time_ms = 0.0
        if not self._loaded:
            time.sleep(0.15)
            self._loaded = True
            load_time_ms = self._load_time_ms

        time.sleep(0.04)
        ttft_ms = (time.perf_counter() - start) * 1000
        last_user = next((msg["content"] for msg in reversed(messages) if msg["role"] == "user"), "")
        generated = (
            f"[mock] Answer for: {last_user[:48]}. "
            f"temperature={temperature:.1f}, max_tokens={max_tokens}."
        )
        completion_tokens = min(max_tokens, len(generated.split()))
        time.sleep(0.02)
        total_time_ms = (time.perf_counter() - start) * 1000
        decode_time_ms = max(total_time_ms - ttft_ms, 0.0)

        return GenerationResult(
            runtime="mock",
            model_id=self.model_id,
            model_family=_infer_model_family(self.model_id),
            quantization=_infer_quantization(self.model_id),
            prompt_tokens=sum(len(msg["content"].split()) for msg in messages),
            completion_tokens=completion_tokens,
            load_time_ms=load_time_ms,
            ttft_ms=round(ttft_ms, 3),
            prefill_time_ms=None,
            prefill_tps=None,
            decode_time_ms=round(decode_time_ms, 3),
            decode_tps=round(_safe_tps(completion_tokens, decode_time_ms), 3),
            total_time_ms=round(total_time_ms, 3),
            peak_memory_gb=0.256,
            cache_hit=False,
            cached_tokens=0,
            cache_source="none",
            output_text=generated,
            notes="mock runtime for harness validation",
        )

    def stream_messages(
        self,
        messages: list[dict[str, str]],
        max_tokens: int,
        temperature: float,
        top_p: float = 0.0,
        min_p: float = 0.0,
        top_k: int = 0,
        repetition_penalty: float | None = None,
        repetition_context_size: int = 20,
        stop_strings: list[str] | None = None,
        enable_thinking: bool = False,
        session_id: str | None = None,
    ) -> Iterator[dict[str, object]]:
        result = self.generate_messages(
            messages,
            max_tokens=max_tokens,
            temperature=temperature,
            top_p=top_p,
            min_p=min_p,
            top_k=top_k,
            repetition_penalty=repetition_penalty,
            repetition_context_size=repetition_context_size,
            stop_strings=stop_strings,
            enable_thinking=enable_thinking,
            session_id=session_id,
        )
        yield {
            "type": "status",
            "phase": "prefill",
            "label": "Thinking...",
            "badge": "Thinking",
        }
        yield {
            "type": "status",
            "phase": "responding",
            "label": "Responding...",
            "badge": "Responding",
        }
        for token in result.output_text.split(" "):
            yield {"type": "delta", "text": token + " "}
        yield {"type": "done", "model_id": result.model_id, "metrics": result.metrics_dict()}

    def load(self) -> None:
        if not self._loaded:
            time.sleep(0.15)
            self._loaded = True

    def warmup(self) -> None:
        self.load()
        if self._warmed:
            return
        time.sleep(0.02)
        self._warmed = True

    def unload(self) -> None:
        self._loaded = False
        self._warmed = False

    def is_loaded(self) -> bool:
        return self._loaded

    def current_model(self) -> str:
        return self.model_id


class LlamaCppRuntime:
    def __init__(self, model_id: str) -> None:
        self.model_id = model_id
        self._loaded = False
        self._warmed = False
        self._load_time_ms = 0.0
        self._llama = None

    def load(self) -> None:
        self._ensure_loaded()

    def warmup(self) -> None:
        self._ensure_loaded()
        if self._warmed:
            return
        self.generate_messages(
            [
                {"role": "system", "content": "You are a local assistant warmup request."},
                {"role": "user", "content": "hi"},
            ],
            max_tokens=1,
            temperature=0.0,
        )
        self._warmed = True

    def unload(self) -> None:
        self._llama = None
        self._loaded = False
        self._warmed = False
        self._load_time_ms = 0.0

    def is_loaded(self) -> bool:
        return self._loaded

    def current_model(self) -> str:
        return self.model_id

    def generate(self, prompt: PromptCase, max_tokens: int, temperature: float) -> GenerationResult:
        return self.generate_messages(
            prompt.messages(),
            max_tokens=max_tokens,
            temperature=temperature,
        )

    def generate_messages(
        self,
        messages: list[dict[str, str]],
        max_tokens: int,
        temperature: float,
        top_p: float = 0.0,
        min_p: float = 0.0,
        top_k: int = 0,
        repetition_penalty: float | None = None,
        repetition_context_size: int = 20,
        stop_strings: list[str] | None = None,
        enable_thinking: bool = False,
        session_id: str | None = None,
    ) -> GenerationResult:
        result: GenerationResult | None = None
        for event in self._iterate_messages(
            messages,
            max_tokens=max_tokens,
            temperature=temperature,
            top_p=top_p,
            min_p=min_p,
            top_k=top_k,
            repetition_penalty=repetition_penalty,
            repetition_context_size=repetition_context_size,
            stop_strings=stop_strings,
            enable_thinking=enable_thinking,
            session_id=session_id,
        ):
            if event["type"] == "done":
                result = event["result"]
        assert result is not None
        return result

    def stream_messages(
        self,
        messages: list[dict[str, str]],
        max_tokens: int,
        temperature: float,
        top_p: float = 0.0,
        min_p: float = 0.0,
        top_k: int = 0,
        repetition_penalty: float | None = None,
        repetition_context_size: int = 20,
        stop_strings: list[str] | None = None,
        enable_thinking: bool = False,
        session_id: str | None = None,
    ) -> Iterator[dict[str, object]]:
        for event in self._iterate_messages(
            messages,
            max_tokens=max_tokens,
            temperature=temperature,
            top_p=top_p,
            min_p=min_p,
            top_k=top_k,
            repetition_penalty=repetition_penalty,
            repetition_context_size=repetition_context_size,
            stop_strings=stop_strings,
            enable_thinking=enable_thinking,
            session_id=session_id,
        ):
            if event["type"] == "status":
                yield event
            if event["type"] == "delta":
                yield {"type": "delta", "text": event["text"]}
            elif event["type"] == "done":
                result: GenerationResult = event["result"]
                yield {"type": "done", "model_id": result.model_id, "metrics": result.metrics_dict()}

    def _ensure_loaded(self) -> None:
        if self._loaded:
            return
        if not self.model_id:
            raise RuntimeError("Select a local GGUF file before using llama.cpp.")

        model_path = Path(self.model_id).expanduser()
        if not model_path.exists() or model_path.suffix.lower() != ".gguf":
            raise RuntimeError("llama.cpp runtime expects a local .gguf model path.")

        try:
            from llama_cpp import Llama, llama_chat_format
        except ImportError as exc:
            raise RuntimeError(
                "llama.cpp runtime dependency is missing. Install llama-cpp-python with Metal support first."
            ) from exc

        _patch_llama_chat_formatter(llama_chat_format)

        load_start = time.perf_counter()
        self._llama = Llama(
            model_path=str(model_path),
            n_gpu_layers=-1,
            n_ctx=8192,
            verbose=False,
        )
        self._loaded = True
        self._load_time_ms = (time.perf_counter() - load_start) * 1000

    def _iterate_messages(
        self,
        messages: list[dict[str, str]],
        max_tokens: int,
        temperature: float,
        top_p: float = 0.0,
        min_p: float = 0.0,
        top_k: int = 0,
        repetition_penalty: float | None = None,
        repetition_context_size: int = 20,
        stop_strings: list[str] | None = None,
        enable_thinking: bool = False,
        session_id: str | None = None,
    ) -> Iterator[dict[str, object]]:
        del repetition_context_size, session_id, enable_thinking
        self._ensure_loaded()
        assert self._llama is not None

        start = time.perf_counter()
        first_token_at: float | None = None
        emitted_generating_status = False
        chunks: list[str] = []
        pending_text = ""
        stop_strings = [item for item in (stop_strings or []) if item]
        prompt_text = _render_llama_prompt(messages)
        prompt_tokens = _estimate_token_count(prompt_text, self._llama)
        default_stop_strings = ["\nUser:", "\nSystem:"]
        completion_stop_strings = list(dict.fromkeys([*stop_strings, *default_stop_strings]))

        yield {
            "type": "status",
            "phase": "prefill",
            "label": "Thinking...",
            "badge": "Thinking",
        }

        stream = self._llama.create_completion(
            prompt=prompt_text,
            max_tokens=max_tokens,
            temperature=temperature,
            top_p=top_p if top_p > 0 else 1.0,
            top_k=top_k if top_k > 0 else 40,
            min_p=min_p if min_p > 0 else 0.0,
            repeat_penalty=repetition_penalty if repetition_penalty and repetition_penalty > 0 else 1.0,
            stop=completion_stop_strings,
            stream=True,
        )

        finish_reason = "stop"
        for chunk in stream:
            choice = (chunk.get("choices") or [{}])[0]
            text = choice.get("text") or ""
            if choice.get("finish_reason"):
                finish_reason = choice["finish_reason"]
            if not text:
                continue
            if first_token_at is None:
                first_token_at = time.perf_counter()
            if not emitted_generating_status:
                emitted_generating_status = True
                yield {
                    "type": "status",
                    "phase": "responding",
                    "label": "Responding...",
                    "badge": "Responding",
                }
            pending_text += text
            emit_text, pending_text, matched_stop = _split_stop_strings(pending_text, stop_strings)
            if emit_text:
                chunks.append(emit_text)
                yield {"type": "delta", "text": emit_text}
            if matched_stop:
                finish_reason = "stop"
                break

        if pending_text:
            chunks.append(pending_text)
            yield {"type": "delta", "text": pending_text}

        output_text = "".join(chunks)
        end = time.perf_counter()
        completion_tokens = _estimate_token_count(output_text, self._llama)
        ttft_ms = ((first_token_at - start) * 1000) if first_token_at is not None else None
        total_time_ms = (end - start) * 1000
        decode_time_ms = ((end - first_token_at) * 1000) if first_token_at is not None else None

        result = GenerationResult(
            runtime="llama_cpp",
            model_id=self.model_id,
            model_family=_infer_model_family(self.model_id),
            quantization=_infer_quantization(self.model_id),
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            load_time_ms=round(self._load_time_ms, 3),
            ttft_ms=_round_or_none(ttft_ms),
            prefill_time_ms=_round_or_none(ttft_ms),
            prefill_tps=_round_or_none(_safe_tps(prompt_tokens, ttft_ms)),
            decode_time_ms=_round_or_none(decode_time_ms),
            decode_tps=_round_or_none(_safe_tps(completion_tokens, decode_time_ms)),
            total_time_ms=round(total_time_ms, 3),
            peak_memory_gb=None,
            cache_hit=False,
            cached_tokens=0,
            cache_source="none",
            output_text=output_text,
            notes=f"llama.cpp Metal runtime via llama-cpp-python with safe prompt fallback, finish_reason={finish_reason}.",
        )
        yield {"type": "done", "result": result}


class MlxRuntime:
    def __init__(self, model_id: str) -> None:
        self.model_id = model_id
        self._loaded = False
        self._warmed = False
        self._load_time_ms = 0.0
        self._model = None
        self._tokenizer = None
        self._mx = None
        self._stream_generate = None
        self._make_prompt_cache = None
        self._prefix_cache = SharedPrefixCache(max_entries=8, max_bytes=6 * (1 << 30))
        self._session_cache = SessionCache(max_sessions=24)

    def load(self) -> None:
        self._ensure_loaded()

    def warmup(self) -> None:
        self._ensure_loaded()
        if self._warmed:
            return

        assert self._tokenizer is not None
        assert self._model is not None
        assert self._stream_generate is not None
        assert self._make_prompt_cache is not None

        warmup_messages = [
            {"role": "system", "content": "You are a local assistant warmup request."},
            {"role": "user", "content": "hi"},
        ]
        prompt = self._render_chat_template(warmup_messages, enable_thinking=False)
        prompt_tokens = list(self._tokenizer.encode(prompt))
        prompt_cache = self._make_prompt_cache(self._model)

        for _ in self._stream_generate(
            self._model,
            self._tokenizer,
            prompt_tokens,
            max_tokens=1,
            sampler=None,
            prompt_cache=prompt_cache,
        ):
            pass

        self._warmed = True

    def _ensure_loaded(self) -> None:
        if self._loaded:
            return

        load_start = time.perf_counter()
        try:
            import mlx.core as mx
            from mlx_lm import load, stream_generate
            from mlx_lm.models.cache import make_prompt_cache
        except ImportError as exc:
            raise RuntimeError(
                "MLX runtime dependencies are missing. Install backend/requirements.txt first."
            ) from exc

        self._model, self._tokenizer = load(self.model_id)
        self._mx = mx
        self._stream_generate = stream_generate
        self._make_prompt_cache = make_prompt_cache
        self._loaded = True
        self._load_time_ms = (time.perf_counter() - load_start) * 1000

    def generate(self, prompt: PromptCase, max_tokens: int, temperature: float) -> GenerationResult:
        return self.generate_messages(
            prompt.messages(),
            max_tokens=max_tokens,
            temperature=temperature,
        )

    def generate_messages(
        self,
        messages: list[dict[str, str]],
        max_tokens: int,
        temperature: float,
        top_p: float = 0.0,
        min_p: float = 0.0,
        top_k: int = 0,
        repetition_penalty: float | None = None,
        repetition_context_size: int = 20,
        stop_strings: list[str] | None = None,
        enable_thinking: bool = False,
        session_id: str | None = None,
    ) -> GenerationResult:
        result: GenerationResult | None = None
        for event in self._iterate_messages(
            messages,
            max_tokens=max_tokens,
            temperature=temperature,
            top_p=top_p,
            min_p=min_p,
            top_k=top_k,
            repetition_penalty=repetition_penalty,
            repetition_context_size=repetition_context_size,
            stop_strings=stop_strings,
            enable_thinking=enable_thinking,
            session_id=session_id,
        ):
            if event["type"] == "done":
                result = event["result"]
        assert result is not None
        return result

    def stream_messages(
        self,
        messages: list[dict[str, str]],
        max_tokens: int,
        temperature: float,
        top_p: float = 0.0,
        min_p: float = 0.0,
        top_k: int = 0,
        repetition_penalty: float | None = None,
        repetition_context_size: int = 20,
        stop_strings: list[str] | None = None,
        enable_thinking: bool = False,
        session_id: str | None = None,
    ) -> Iterator[dict[str, object]]:
        for event in self._iterate_messages(
            messages,
            max_tokens=max_tokens,
            temperature=temperature,
            top_p=top_p,
            min_p=min_p,
            top_k=top_k,
            repetition_penalty=repetition_penalty,
            repetition_context_size=repetition_context_size,
            stop_strings=stop_strings,
            enable_thinking=enable_thinking,
            session_id=session_id,
        ):
            if event["type"] == "status":
                yield event
            if event["type"] == "delta":
                yield {"type": "delta", "text": event["text"]}
            elif event["type"] == "done":
                result: GenerationResult = event["result"]
                yield {
                    "type": "done",
                    "model_id": result.model_id,
                    "metrics": result.metrics_dict(),
                }

    def _iterate_messages(
        self,
        messages: list[dict[str, str]],
        max_tokens: int,
        temperature: float,
        top_p: float = 0.0,
        min_p: float = 0.0,
        top_k: int = 0,
        repetition_penalty: float | None = None,
        repetition_context_size: int = 20,
        stop_strings: list[str] | None = None,
        enable_thinking: bool = False,
        session_id: str | None = None,
    ) -> Iterator[dict[str, object]]:
        self._ensure_loaded()
        assert self._tokenizer is not None
        assert self._model is not None
        assert self._mx is not None
        assert self._stream_generate is not None
        assert self._make_prompt_cache is not None

        rendered_prompt = self._render_chat_template(messages, enable_thinking=enable_thinking)
        prompt_tokens_list = list(self._tokenizer.encode(rendered_prompt))
        cache_match = self._resolve_prompt_cache(prompt_tokens_list, session_id=session_id)
        prompt_input: list[int] = cache_match.remaining_tokens
        active_prompt_cache = cache_match.prompt_cache
        self._reset_peak_memory()

        start = time.perf_counter()
        first_token_at: float | None = None
        emitted_generating_status = False
        chunks: list[str] = []
        generated_token_ids: list[int] = []
        last_generation_count = 0
        prompt_tokens: int | None = None
        completion_tokens = 0
        prompt_tps: float | None = None
        generation_tps: float | None = None
        peak_memory_gb: float | None = None

        sampler = None
        logits_processors = None
        if temperature > 0 or top_p > 0 or min_p > 0 or top_k > 0:
            try:
                from mlx_lm.sample_utils import make_logits_processors, make_sampler
            except ImportError as exc:
                raise RuntimeError("mlx_lm.sample_utils is unavailable.") from exc
            sampler = make_sampler(
                temp=temperature,
                top_p=top_p,
                min_p=min_p,
                top_k=top_k,
            )
            logits_processors = make_logits_processors(
                repetition_penalty=repetition_penalty,
                repetition_context_size=repetition_context_size,
            )
        elif repetition_penalty is not None and repetition_penalty > 0:
            try:
                from mlx_lm.sample_utils import make_logits_processors
            except ImportError as exc:
                raise RuntimeError("mlx_lm.sample_utils is unavailable.") from exc
            logits_processors = make_logits_processors(
                repetition_penalty=repetition_penalty,
                repetition_context_size=repetition_context_size,
            )

        stop_strings = [item for item in (stop_strings or []) if item]
        pending_text = ""
        stopped_on_string = False

        yield {
            "type": "status",
            "phase": "prefill",
            "label": "Thinking...",
            "badge": "Thinking",
        }

        for response in self._stream_generate(
            self._model,
            self._tokenizer,
            prompt_input,
            max_tokens=max_tokens,
            sampler=sampler,
            logits_processors=logits_processors,
            prompt_cache=active_prompt_cache,
        ):
            if not response.text:
                continue
            if first_token_at is None:
                first_token_at = time.perf_counter()
            if not emitted_generating_status:
                emitted_generating_status = True
                yield {
                    "type": "status",
                    "phase": "responding",
                    "label": "Responding...",
                    "badge": "Responding",
                }
            if prompt_tokens is None:
                prompt_tokens = response.prompt_tokens + cache_match.cached_tokens
            if response.generation_tokens is not None:
                completion_tokens = response.generation_tokens
                if response.generation_tokens > last_generation_count:
                    generated_token_ids.append(int(response.token))
                    last_generation_count = response.generation_tokens
            if response.prompt_tps is not None:
                prompt_tps = response.prompt_tps
            if response.generation_tps is not None:
                generation_tps = response.generation_tps
            if response.peak_memory is not None:
                peak_memory_gb = response.peak_memory
            pending_text += response.text
            emit_text, pending_text, matched_stop = _split_stop_strings(pending_text, stop_strings)
            if emit_text:
                chunks.append(emit_text)
                yield {"type": "delta", "text": emit_text}
            if matched_stop:
                stopped_on_string = True
                break

        end = time.perf_counter()
        if pending_text and not stopped_on_string:
            chunks.append(pending_text)
            yield {"type": "delta", "text": pending_text}
        output_text = "".join(chunks)
        if prompt_tokens is None:
            prompt_tokens = len(prompt_tokens_list)
        if completion_tokens == 0 and output_text:
            completion_tokens = len(self._tokenizer.encode(output_text))
        total_time_ms = (end - start) * 1000
        ttft_ms = ((first_token_at - start) * 1000) if first_token_at is not None else None
        decode_time_ms = ((end - first_token_at) * 1000) if first_token_at is not None else None
        if peak_memory_gb is None:
            peak_memory_gb = self._peak_memory_gb()
        prefill_time_ms = _tps_to_ms(prompt_tokens, prompt_tps)
        if decode_time_ms is None and generation_tps is not None and completion_tokens > 0:
            decode_time_ms = _tps_to_ms(completion_tokens, generation_tps)

        prompt_only_cache = copy.deepcopy(active_prompt_cache)
        if generated_token_ids:
            self._trim_prompt_cache(prompt_only_cache, len(generated_token_ids))
        self._prefix_cache.insert(self.model_id, prompt_tokens_list, prompt_only_cache)

        if session_id:
            final_cache = copy.deepcopy(active_prompt_cache)
            self._session_cache.insert(
                session_id,
                self.model_id,
                prompt_tokens_list + generated_token_ids,
                final_cache,
            )

        result = GenerationResult(
            runtime="mlx",
            model_id=self.model_id,
            model_family=_infer_model_family(self.model_id),
            quantization=_infer_quantization(self.model_id),
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            load_time_ms=round(self._load_time_ms, 3),
            ttft_ms=_round_or_none(ttft_ms),
            prefill_time_ms=_round_or_none(prefill_time_ms),
            prefill_tps=_round_or_none(prompt_tps),
            decode_time_ms=_round_or_none(decode_time_ms),
            decode_tps=_round_or_none(generation_tps)
            if generation_tps is not None
            else round(_safe_tps(completion_tokens, decode_time_ms), 3),
            total_time_ms=round(total_time_ms, 3),
            peak_memory_gb=_round_or_none(peak_memory_gb),
            cache_hit=cache_match.cache_hit,
            cached_tokens=cache_match.cached_tokens,
            cache_source=cache_match.cache_source,
            output_text=output_text,
            notes="Runtime with shared prefix cache, per-session KV reuse, and configurable sampling.",
        )
        yield {"type": "done", "result": result}

    def unload(self) -> None:
        self._model = None
        self._tokenizer = None
        self._mx = None
        self._stream_generate = None
        self._make_prompt_cache = None
        self._loaded = False
        self._warmed = False
        self._load_time_ms = 0.0
        self._prefix_cache.clear()
        self._session_cache.clear()

    def is_loaded(self) -> bool:
        return self._loaded

    def current_model(self) -> str:
        return self.model_id

    def reset_session(self, session_id: str) -> None:
        self._session_cache.reset(session_id)

    def _resolve_prompt_cache(self, prompt_tokens: list[int], session_id: str | None) -> PromptCacheMatch:
        if session_id:
            session_match = self._session_cache.fetch(session_id, self.model_id, prompt_tokens)
            if session_match.prompt_cache is not None:
                return session_match

        prefix_match = self._prefix_cache.fetch(self.model_id, prompt_tokens)
        if prefix_match.prompt_cache is not None:
            return prefix_match

        return PromptCacheMatch(
            prompt_cache=self._make_prompt_cache(self._model),
            remaining_tokens=prompt_tokens,
            cached_tokens=0,
            cache_hit=False,
            cache_source="none",
        )

    def _trim_prompt_cache(self, prompt_cache: list[object], num_tokens: int) -> None:
        try:
            from mlx_lm.models.cache import trim_prompt_cache
        except ImportError:
            return
        trim_prompt_cache(prompt_cache, num_tokens)

    def _reset_peak_memory(self) -> None:
        if hasattr(self._mx, "reset_peak_memory"):
            self._mx.reset_peak_memory()
            return
        metal = getattr(self._mx, "metal", None)
        if metal is not None and hasattr(metal, "reset_peak_memory"):
            metal.reset_peak_memory()

    def _peak_memory_gb(self) -> float | None:
        if hasattr(self._mx, "get_peak_memory"):
            return self._mx.get_peak_memory() / 1e9
        metal = getattr(self._mx, "metal", None)
        if metal is not None and hasattr(metal, "get_peak_memory"):
            return metal.get_peak_memory() / 1e9
        return None

    def _render_chat_template(self, messages: list[dict[str, str]], enable_thinking: bool) -> str:
        template_kwargs = _chat_template_kwargs(self.model_id, enable_thinking)
        try:
            return self._tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
                **template_kwargs,
            )
        except TypeError:
            return self._tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
            )


def build_runtime(runtime_name: str, model_id: str) -> Runtime:
    if runtime_name == "mock":
        return MockRuntime(model_id)
    if runtime_name == "mlx":
        return MlxRuntime(model_id)
    if runtime_name == "llama_cpp":
        return LlamaCppRuntime(model_id)
    raise ValueError(f"Unsupported runtime: {runtime_name}")


def runtime_capabilities() -> list[dict[str, object]]:
    return [
        {
            "id": "mlx",
            "label": "MLX",
            "available": True,
            "needs_local_path": False,
        },
        {
            "id": "llama_cpp",
            "label": "llama.cpp Metal",
            "available": importlib.util.find_spec("llama_cpp") is not None,
            "needs_local_path": True,
        },
        {
            "id": "mock",
            "label": "Mock",
            "available": True,
            "needs_local_path": False,
        },
    ]


def _safe_tps(tokens: int, duration_ms: float | None) -> float:
    if not duration_ms or duration_ms <= 0:
        return 0.0
    return tokens / (duration_ms / 1000)


def _tps_to_ms(tokens: int, tps: float | None) -> float | None:
    if tps is None or tps <= 0 or tokens <= 0:
        return None
    return (tokens / tps) * 1000


def _round_or_none(value: float | None) -> float | None:
    if value is None:
        return None
    return round(value, 3)


def _chat_template_kwargs(model_id: str, enable_thinking: bool) -> dict[str, object]:
    lowered = model_id.lower()
    if "qwen3.5" in lowered or "qwen3_5" in lowered:
        return {"enable_thinking": enable_thinking}
    return {}


def _patch_llama_chat_formatter(llama_chat_format_module: object) -> None:
    global _LLAMA_TEMPLATE_PATCHED
    if _LLAMA_TEMPLATE_PATCHED:
        return

    formatter_cls = getattr(llama_chat_format_module, "Jinja2ChatFormatter", None)
    if formatter_cls is None:
        _LLAMA_TEMPLATE_PATCHED = True
        return
    if getattr(formatter_cls, "_mlx_safe_patch", False):
        _LLAMA_TEMPLATE_PATCHED = True
        return

    import jinja2

    original_init = formatter_cls.__init__
    fallback_template = (
        "{% for message in messages %}"
        "{{ message['role'] | capitalize }}: {{ message['content'] }}\n\n"
        "{% endfor %}"
        "{% if add_generation_prompt %}Assistant:{% endif %}"
    )

    def safe_init(
        self,
        template: str,
        eos_token: str,
        bos_token: str,
        add_generation_prompt: bool = True,
        stop_token_ids: list[int] | None = None,
    ) -> None:
        try:
            original_init(
                self,
                template,
                eos_token,
                bos_token,
                add_generation_prompt=add_generation_prompt,
                stop_token_ids=stop_token_ids,
            )
        except jinja2.exceptions.TemplateSyntaxError:
            original_init(
                self,
                fallback_template,
                eos_token,
                bos_token,
                add_generation_prompt=add_generation_prompt,
                stop_token_ids=stop_token_ids,
            )

    formatter_cls.__init__ = safe_init
    formatter_cls._mlx_safe_patch = True
    _LLAMA_TEMPLATE_PATCHED = True


def _render_llama_prompt(messages: list[dict[str, str]]) -> str:
    lines: list[str] = []
    for message in messages:
        role = message.get("role", "user")
        if role == "system":
            prefix = "System"
        elif role == "assistant":
            prefix = "Assistant"
        else:
            prefix = "User"
        content = (message.get("content") or "").strip()
        lines.append(f"{prefix}: {content}")
    lines.append("Assistant:")
    return "\n\n".join(lines)


def _estimate_token_count(text: str, tokenizer: object) -> int:
    if not text:
        return 0
    try:
        return len(tokenizer.tokenize(text.encode("utf-8")))
    except Exception:
        return max(len(text.split()), 1)


def _estimate_message_tokens(output_text: str, messages: list[dict[str, str]], tokenizer: object) -> int:
    del output_text
    try:
        joined = "\n".join(f"{message['role']}: {message['content']}" for message in messages)
        return len(tokenizer.tokenize(joined.encode("utf-8")))
    except Exception:
        return sum(len(message["content"].split()) for message in messages)


def _split_stop_strings(text: str, stop_strings: list[str]) -> tuple[str, str, bool]:
    if not text or not stop_strings:
        return text, "", False

    earliest_index: int | None = None
    matched_stop = ""
    for stop in stop_strings:
        index = text.find(stop)
        if index == -1:
            continue
        if earliest_index is None or index < earliest_index:
            earliest_index = index
            matched_stop = stop

    if earliest_index is not None:
        return text[:earliest_index], "", bool(matched_stop)

    holdback = 0
    for stop in stop_strings:
        max_prefix = min(len(text), len(stop) - 1)
        for prefix_length in range(max_prefix, 0, -1):
            if text.endswith(stop[:prefix_length]):
                holdback = max(holdback, prefix_length)
                break

    if holdback > 0:
        return text[:-holdback], text[-holdback:], False
    return text, "", False


def _infer_model_family(model_id: str) -> str:
    normalized = model_id.lower()
    for family in ("llama", "qwen", "mistral", "phi"):
        if family in normalized:
            return family
    return "unknown"


def _infer_quantization(model_id: str) -> str:
    normalized = model_id.lower()
    if "4bit" in normalized or "q4" in normalized:
        return "4bit"
    if "8bit" in normalized or "q8" in normalized:
        return "8bit"
    return "unknown"
