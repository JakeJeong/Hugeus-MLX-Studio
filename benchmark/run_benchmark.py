from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

from backend.config import BenchmarkDefaults
from backend.core.metrics import append_jsonl, summarize_records
from backend.core.prompts import load_prompt_cases
from backend.core.runtime import build_runtime


def main() -> None:
    defaults = BenchmarkDefaults()

    parser = argparse.ArgumentParser(description="Run benchmark scenarios for MLX Studio.")
    parser.add_argument("--runtime", default=defaults.runtime, choices=["mlx", "mock"])
    parser.add_argument("--model", default=defaults.model_id)
    parser.add_argument("--prompts", type=Path, required=True)
    parser.add_argument("--runs", type=int, default=20)
    parser.add_argument("--max-tokens", type=int, default=defaults.max_tokens)
    parser.add_argument("--temperature", type=float, default=defaults.temperature)
    parser.add_argument("--scenario", default="warm_single_turn")
    parser.add_argument("--output-dir", type=Path, default=defaults.results_dir)
    args = parser.parse_args()

    prompt_cases = load_prompt_cases(args.prompts)
    runtime = build_runtime(args.runtime, args.model)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    output_path = args.output_dir / f"{args.runtime}-{timestamp}.jsonl"

    all_records = []
    for run_index in range(1, args.runs + 1):
        for prompt in prompt_cases:
            result = runtime.generate(
                prompt,
                max_tokens=args.max_tokens,
                temperature=args.temperature,
            )
            all_records.append(result.to_record(prompt, scenario=args.scenario, run_index=run_index))

    append_jsonl(output_path, all_records)
    summary = summarize_records(all_records)

    print(json.dumps(
        {
            "output_path": str(output_path),
            "records": len(all_records),
            "summary": summary,
        },
        ensure_ascii=True,
        indent=2,
    ))


if __name__ == "__main__":
    main()
