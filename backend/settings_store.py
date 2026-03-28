from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from backend.config import ROOT_DIR


SETTINGS_PATH = ROOT_DIR / ".mlx-studio-settings.json"


class SettingsStore:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or SETTINGS_PATH

    def load(self) -> dict[str, Any]:
        if not self.path.exists():
            return {}
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}

    def save(self, payload: dict[str, Any]) -> None:
        self.path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
