from __future__ import annotations

import argparse
from dataclasses import dataclass, field

from backend.config import BenchmarkDefaults


@dataclass
class ChatSession:
    system_prompt: str
    messages: list[dict[str, str]] = field(default_factory=list)

    def reset(self) -> None:
        self.messages.clear()

    def history(self) -> list[dict[str, str]]:
        history: list[dict[str, str]] = []
        if self.system_prompt:
            history.append({"role": "system", "content": self.system_prompt})
        history.extend(self.messages)
        return history


def build_parser() -> argparse.ArgumentParser:
    defaults = BenchmarkDefaults()

    parser = argparse.ArgumentParser(description="Interactive terminal chat for a local MLX model.")
    parser.add_argument("--model", default=defaults.model_id)
    parser.add_argument("--system-prompt", default="You are a helpful local assistant.")
    parser.add_argument("--max-tokens", type=int, default=defaults.max_tokens)
    parser.add_argument("--temperature", type=float, default=defaults.temperature)
    return parser


def main() -> None:
    args = build_parser().parse_args()

    try:
        from mlx_lm import load, stream_generate
        from mlx_lm.sample_utils import make_sampler
    except ImportError as exc:
        raise SystemExit(
            "mlx-lm is not installed in the project venv. Run with .venv/bin/python after installing dependencies."
        ) from exc

    print(f"Loading model: {args.model}")
    model, tokenizer = load(args.model)
    sampler = make_sampler(temp=args.temperature) if args.temperature > 0 else None
    session = ChatSession(system_prompt=args.system_prompt)

    print("Ready. Commands: /reset, /history, /exit")

    while True:
        try:
            user_input = input("\nYou> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nBye.")
            break

        if not user_input:
            continue
        if user_input == "/exit":
            print("Bye.")
            break
        if user_input == "/reset":
            session.reset()
            print("Conversation cleared.")
            continue
        if user_input == "/history":
            for message in session.history():
                print(f"{message['role']}: {message['content']}")
            continue

        session.messages.append({"role": "user", "content": user_input})
        prompt = tokenizer.apply_chat_template(
            session.history(),
            tokenize=False,
            add_generation_prompt=True,
        )

        print("Assistant> ", end="", flush=True)
        chunks: list[str] = []

        try:
            for response in stream_generate(
                model,
                tokenizer,
                prompt,
                max_tokens=args.max_tokens,
                sampler=sampler,
            ):
                if not response.text:
                    continue
                print(response.text, end="", flush=True)
                chunks.append(response.text)
        except KeyboardInterrupt:
            print("\n[interrupted]")
            if session.messages and session.messages[-1]["role"] == "user":
                session.messages.pop()
            continue

        assistant_text = "".join(chunks).strip()
        print()

        if assistant_text:
            session.messages.append({"role": "assistant", "content": assistant_text})
        else:
            print("[empty response]")


if __name__ == "__main__":
    main()
