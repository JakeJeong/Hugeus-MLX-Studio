from __future__ import annotations

from pathlib import Path


IGNORED_DIRS = {
    ".git",
    ".venv",
    "__pycache__",
    "benchmark/results",
}

TEXT_EXTENSIONS = {
    ".py",
    ".md",
    ".json",
    ".txt",
    ".toml",
    ".yaml",
    ".yml",
    ".js",
    ".ts",
    ".tsx",
    ".jsx",
    ".css",
    ".html",
    ".sh",
}


class WorkspaceStore:
    def __init__(self, root: Path) -> None:
        self.root = root

    def list_files(self, query: str = "", limit: int = 200) -> list[dict[str, object]]:
        files: list[dict[str, object]] = []
        query_lower = query.lower().strip()

        for path in self.root.rglob("*"):
            if not path.is_file():
                continue
            rel_path = path.relative_to(self.root).as_posix()
            if self._is_ignored(rel_path):
                continue
            if query_lower and query_lower not in rel_path.lower():
                continue
            files.append(
                {
                    "path": rel_path,
                    "size": path.stat().st_size,
                }
            )
            if len(files) >= limit:
                break
        return files

    def read_file(self, relative_path: str, max_chars: int = 12000) -> dict[str, object]:
        path = self._resolve(relative_path)
        if path.suffix.lower() not in TEXT_EXTENSIONS:
            raise ValueError("Only text-like files can be previewed in the MVP.")

        content = path.read_text(encoding="utf-8", errors="replace")
        truncated = len(content) > max_chars
        return {
            "path": relative_path,
            "content": content[:max_chars],
            "truncated": truncated,
            "size": path.stat().st_size,
        }

    def _resolve(self, relative_path: str) -> Path:
        candidate = (self.root / relative_path).resolve()
        if self.root not in candidate.parents and candidate != self.root:
            raise ValueError("Path is outside the workspace.")
        if not candidate.exists() or not candidate.is_file():
            raise ValueError("File not found.")
        return candidate

    def _is_ignored(self, relative_path: str) -> bool:
        for ignored in IGNORED_DIRS:
            if relative_path == ignored or relative_path.startswith(f"{ignored}/"):
                return True
        return False
