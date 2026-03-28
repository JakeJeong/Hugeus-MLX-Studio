from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
PROMPTS_DIR = ROOT_DIR / "benchmark" / "prompts"
RESULTS_DIR = ROOT_DIR / "benchmark" / "results"
FRONTEND_DIR = ROOT_DIR / "frontend"

DEFAULT_MODEL = "mlx-community/Qwen2.5-7B-Instruct-4bit"
DEFAULT_RUNTIME = "mlx"
DEFAULT_RUNTIME_CHOICES = ("mlx", "llama_cpp", "mock")
DEFAULT_MAX_TOKENS = 200
DEFAULT_TEMPERATURE = 0.0
DEFAULT_TOP_P = 0.95
DEFAULT_MIN_P = 0.0
DEFAULT_TOP_K = 40
DEFAULT_REPEAT_PENALTY = 1.05
DEFAULT_REPEAT_CONTEXT_SIZE = 64
DEFAULT_STOP_STRINGS: tuple[str, ...] = ()
DEFAULT_ENABLE_THINKING = False
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000
DEFAULT_MODELS = (
    "mlx-community/Qwen2.5-7B-Instruct-4bit",
    "mlx-community/Llama-3.2-3B-Instruct-4bit",
)
WARMUP_SYSTEM_PROMPT = "You are a local assistant warmup request."
WARMUP_USER_PROMPT = "hi"
WARMUP_MAX_TOKENS = 1
WARMUP_TEMPERATURE = 0.0


@dataclass(frozen=True)
class BenchmarkDefaults:
    runtime: str = DEFAULT_RUNTIME
    runtimes: tuple[str, ...] = DEFAULT_RUNTIME_CHOICES
    model_id: str = DEFAULT_MODEL
    max_tokens: int = DEFAULT_MAX_TOKENS
    temperature: float = DEFAULT_TEMPERATURE
    top_p: float = DEFAULT_TOP_P
    min_p: float = DEFAULT_MIN_P
    top_k: int = DEFAULT_TOP_K
    repeat_penalty: float = DEFAULT_REPEAT_PENALTY
    repeat_context_size: int = DEFAULT_REPEAT_CONTEXT_SIZE
    stop_strings: tuple[str, ...] = DEFAULT_STOP_STRINGS
    enable_thinking: bool = DEFAULT_ENABLE_THINKING
    prompts_dir: Path = PROMPTS_DIR
    results_dir: Path = RESULTS_DIR
    frontend_dir: Path = FRONTEND_DIR
    host: str = DEFAULT_HOST
    port: int = DEFAULT_PORT
    models: tuple[str, ...] = DEFAULT_MODELS
    warmup_system_prompt: str = WARMUP_SYSTEM_PROMPT
    warmup_user_prompt: str = WARMUP_USER_PROMPT
    warmup_max_tokens: int = WARMUP_MAX_TOKENS
    warmup_temperature: float = WARMUP_TEMPERATURE
