from __future__ import annotations

import argparse

from backend.model_store import ModelStore


def main() -> None:
    parser = argparse.ArgumentParser(description="Download a model into the Hugging Face cache.")
    parser.add_argument("--model-id", required=True)
    parser.add_argument("--format", default="mlx", choices=["mlx", "gguf"])
    parser.add_argument("--filename", default=None)
    args = parser.parse_args()

    store = ModelStore()
    store.download_model(args.model_id, format=args.format, filename=args.filename)


if __name__ == "__main__":
    main()
