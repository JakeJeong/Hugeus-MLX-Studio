from __future__ import annotations

import copy
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any

from mlx_lm.models.cache import can_trim_prompt_cache, trim_prompt_cache


@dataclass
class PromptCacheMatch:
    prompt_cache: list[Any] | None
    remaining_tokens: list[int]
    cached_tokens: int
    cache_hit: bool
    cache_source: str


@dataclass
class PromptCacheEntry:
    tokens: tuple[int, ...]
    prompt_cache: list[Any]
    nbytes: int


def prompt_cache_nbytes(prompt_cache: list[Any]) -> int:
    return sum(getattr(cache, "nbytes", 0) for cache in prompt_cache)


class SharedPrefixCache:
    def __init__(self, max_entries: int = 8, max_bytes: int = 1 << 33) -> None:
        self.max_entries = max_entries
        self.max_bytes = max_bytes
        self._entries: OrderedDict[tuple[str, tuple[int, ...]], PromptCacheEntry] = OrderedDict()
        self._nbytes = 0

    def fetch(self, model_id: str, tokens: list[int]) -> PromptCacheMatch:
        token_tuple = tuple(tokens)
        best_shorter: PromptCacheEntry | None = None
        best_longer: PromptCacheEntry | None = None

        for (entry_model, _), entry in self._entries.items():
            if entry_model != model_id:
                continue
            if _starts_with(token_tuple, entry.tokens):
                if best_shorter is None or len(entry.tokens) > len(best_shorter.tokens):
                    best_shorter = entry
            elif _starts_with(entry.tokens, token_tuple) and can_trim_prompt_cache(entry.prompt_cache):
                if best_longer is None or len(entry.tokens) < len(best_longer.tokens):
                    best_longer = entry

        if best_shorter is not None:
            self._touch(model_id, best_shorter.tokens)
            return PromptCacheMatch(
                prompt_cache=copy.deepcopy(best_shorter.prompt_cache),
                remaining_tokens=tokens[len(best_shorter.tokens):],
                cached_tokens=len(best_shorter.tokens),
                cache_hit=True,
                cache_source="prefix",
            )

        if best_longer is not None:
            self._touch(model_id, best_longer.tokens)
            cache = copy.deepcopy(best_longer.prompt_cache)
            trim_prompt_cache(cache, len(best_longer.tokens) - len(token_tuple))
            return PromptCacheMatch(
                prompt_cache=cache,
                remaining_tokens=[],
                cached_tokens=len(token_tuple),
                cache_hit=True,
                cache_source="prefix",
            )

        return PromptCacheMatch(
            prompt_cache=None,
            remaining_tokens=tokens,
            cached_tokens=0,
            cache_hit=False,
            cache_source="none",
        )

    def insert(self, model_id: str, tokens: list[int], prompt_cache: list[Any]) -> None:
        token_tuple = tuple(tokens)
        if not token_tuple:
            return

        entry_key = (model_id, token_tuple)
        cache_copy = copy.deepcopy(prompt_cache)
        entry = PromptCacheEntry(
            tokens=token_tuple,
            prompt_cache=cache_copy,
            nbytes=prompt_cache_nbytes(cache_copy),
        )

        existing = self._entries.pop(entry_key, None)
        if existing is not None:
            self._nbytes -= existing.nbytes

        self._entries[entry_key] = entry
        self._nbytes += entry.nbytes
        self._trim()

    def clear(self) -> None:
        self._entries.clear()
        self._nbytes = 0

    def _touch(self, model_id: str, tokens: tuple[int, ...]) -> None:
        key = (model_id, tokens)
        entry = self._entries.pop(key)
        self._entries[key] = entry

    def _trim(self) -> None:
        while len(self._entries) > self.max_entries:
            _, entry = self._entries.popitem(last=False)
            self._nbytes -= entry.nbytes
        while self._nbytes > self.max_bytes and self._entries:
            _, entry = self._entries.popitem(last=False)
            self._nbytes -= entry.nbytes


@dataclass
class SessionEntry:
    model_id: str
    tokens: tuple[int, ...]
    prompt_cache: list[Any]


class SessionCache:
    def __init__(self, max_sessions: int = 32) -> None:
        self.max_sessions = max_sessions
        self._sessions: OrderedDict[str, SessionEntry] = OrderedDict()

    def fetch(self, session_id: str, model_id: str, tokens: list[int]) -> PromptCacheMatch:
        entry = self._sessions.get(session_id)
        token_tuple = tuple(tokens)
        if entry is None or entry.model_id != model_id:
            return PromptCacheMatch(
                prompt_cache=None,
                remaining_tokens=tokens,
                cached_tokens=0,
                cache_hit=False,
                cache_source="none",
            )

        self._sessions.move_to_end(session_id)
        if _starts_with(token_tuple, entry.tokens):
            return PromptCacheMatch(
                prompt_cache=copy.deepcopy(entry.prompt_cache),
                remaining_tokens=tokens[len(entry.tokens):],
                cached_tokens=len(entry.tokens),
                cache_hit=True,
                cache_source="session",
            )

        return PromptCacheMatch(
            prompt_cache=None,
            remaining_tokens=tokens,
            cached_tokens=0,
            cache_hit=False,
            cache_source="none",
        )

    def insert(self, session_id: str, model_id: str, tokens: list[int], prompt_cache: list[Any]) -> None:
        if not session_id or not tokens:
            return
        self._sessions[session_id] = SessionEntry(
            model_id=model_id,
            tokens=tuple(tokens),
            prompt_cache=copy.deepcopy(prompt_cache),
        )
        self._sessions.move_to_end(session_id)
        while len(self._sessions) > self.max_sessions:
            self._sessions.popitem(last=False)

    def reset(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)

    def clear(self) -> None:
        self._sessions.clear()


def _starts_with(full: tuple[int, ...], prefix: tuple[int, ...]) -> bool:
    if len(prefix) > len(full):
        return False
    return full[: len(prefix)] == prefix
