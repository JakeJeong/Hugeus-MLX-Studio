from __future__ import annotations

import json
import statistics
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable


@dataclass
class BenchmarkRecord:
    runtime: str
    model_id: str
    model_family: str
    quantization: str
    scenario: str
    prompt_group: str
    prompt_id: str
    run_index: int
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
    output_preview: str
    notes: str = ""

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=True)


def ensure_parent_dir(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def append_jsonl(path: Path, records: Iterable[BenchmarkRecord]) -> None:
    ensure_parent_dir(path)
    with path.open("a", encoding="utf-8") as handle:
        for record in records:
            handle.write(record.to_json())
            handle.write("\n")


def summarize_records(records: list[BenchmarkRecord]) -> dict[str, float | int | None]:
    if not records:
        return {
            "count": 0,
            "p50_ttft_ms": None,
            "p95_ttft_ms": None,
            "avg_decode_tps": None,
            "avg_peak_memory_gb": None,
        }

    ttft_values = [record.ttft_ms for record in records if record.ttft_ms is not None]
    decode_values = [record.decode_tps for record in records if record.decode_tps is not None]
    memory_values = [record.peak_memory_gb for record in records if record.peak_memory_gb is not None]

    return {
        "count": len(records),
        "p50_ttft_ms": _percentile(ttft_values, 50),
        "p95_ttft_ms": _percentile(ttft_values, 95),
        "avg_decode_tps": statistics.fmean(decode_values) if decode_values else None,
        "avg_peak_memory_gb": statistics.fmean(memory_values) if memory_values else None,
    }


def _percentile(values: list[float], percentile: int) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    rank = (percentile / 100) * (len(ordered) - 1)
    lower = int(rank)
    upper = min(lower + 1, len(ordered) - 1)
    fraction = rank - lower
    return ordered[lower] + (ordered[upper] - ordered[lower]) * fraction
