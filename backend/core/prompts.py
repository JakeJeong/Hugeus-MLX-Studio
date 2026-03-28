from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class PromptCase:
    prompt_id: str
    prompt_group: str
    system_prompt: str
    user_prompt: str

    def messages(self) -> list[dict[str, str]]:
        messages: list[dict[str, str]] = []
        if self.system_prompt:
            messages.append({"role": "system", "content": self.system_prompt})
        messages.append({"role": "user", "content": self.user_prompt})
        return messages


def load_prompt_cases(path: Path) -> list[PromptCase]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    prompt_group = payload["group"]
    prompts = payload["prompts"]

    cases: list[PromptCase] = []
    for item in prompts:
        cases.append(
            PromptCase(
                prompt_id=item["id"],
                prompt_group=prompt_group,
                system_prompt=item.get("system", ""),
                user_prompt=item["user"],
            )
        )
    return cases
