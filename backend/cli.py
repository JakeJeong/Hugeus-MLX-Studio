from __future__ import annotations

import argparse
import json

from backend.config import BenchmarkDefaults
from backend.core.prompts import PromptCase
from backend.core.runtime import build_runtime


def main() -> None:
    defaults = BenchmarkDefaults()

    parser = argparse.ArgumentParser(description="Run a single MLX Studio prompt.")
    parser.add_argument("--runtime", default=defaults.runtime, choices=list(defaults.runtimes))
    parser.add_argument("--model", default=defaults.model_id)
    parser.add_argument("--system-prompt", default="")
    parser.add_argument("--user-prompt", required=True)
    parser.add_argument("--max-tokens", type=int, default=defaults.max_tokens)
    parser.add_argument("--temperature", type=float, default=defaults.temperature)
    args = parser.parse_args()

    prompt = PromptCase(
        prompt_id="manual",
        prompt_group="manual",
        system_prompt=args.system_prompt,
        user_prompt=args.user_prompt,
    )
    runtime = build_runtime(args.runtime, args.model)
    result = runtime.generate(prompt, max_tokens=args.max_tokens, temperature=args.temperature)

    print(json.dumps(result.to_record(prompt, scenario="manual", run_index=1).__dict__, ensure_ascii=True, indent=2))
    if result.output_text:
        print("\n=== output ===")
        print(result.output_text)


if __name__ == "__main__":
    main()
