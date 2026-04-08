from __future__ import annotations

import re


_CHANNEL_MESSAGE_RE = re.compile(r"<\|channel\|>([^<\r\n]+?)<\|message\|>", re.IGNORECASE)
_THOUGHT_CHANNEL_RE = re.compile(r"<\|channel\>thought[\s\S]*?(?:<channel\|>|$)", re.IGNORECASE)
_THINK_TAG_RE = re.compile(r"<think>[\s\S]*?(?:</think>|$)", re.IGNORECASE)
_THINK_BLOCK_RE = re.compile(r"<\|think\|>[\s\S]*?(?:<\|/think\|>|</think>|$)", re.IGNORECASE)
_PATH_LINE_RE = re.compile(r"^[ \t]*(?:@@(?:path[ \t]+)?[^\n]+|path:\s*[^\n]+)[ \t]*\n?", re.IGNORECASE | re.MULTILINE)
_PROTOCOL_TOKENS = ("<|start|>", "<|end|>", "<|channel|>", "<|message|>")
_HIDDEN_CHANNELS = {"analysis", "thought", "commentary"}


def sanitize_visible_assistant_text(raw_text: str) -> str:
    normalized = str(raw_text or "").replace("\r\n", "\n")
    structured = _extract_structured_channel_text(normalized)
    if structured is not None:
        normalized = structured
    return _strip_auxiliary_markup(strip_hidden_reasoning_markup(normalized))


class VisibleAssistantStream:
    def __init__(self) -> None:
        self._raw = ""
        self._visible = ""

    def push(self, raw_delta: str) -> str:
        self._raw += str(raw_delta or "")
        current_visible = sanitize_visible_assistant_text(self._raw)
        if current_visible.startswith(self._visible):
            delta = current_visible[len(self._visible) :]
            self._visible = current_visible
            return delta

        # Fallback for unexpected non-monotonic sanitization: keep the newest clean state.
        self._visible = current_visible
        return ""


def _extract_structured_channel_text(text: str) -> str | None:
    if not any(token in text for token in _PROTOCOL_TOKENS):
        return None

    markers = list(_CHANNEL_MESSAGE_RE.finditer(text))
    if not markers:
        return ""

    preferred_segments: list[str] = []
    fallback_segments: list[str] = []
    for index, marker in enumerate(markers):
        channel = marker.group(1).strip().lower()
        start = marker.end()
        end = markers[index + 1].start() if index + 1 < len(markers) else len(text)
        segment = _truncate_at_protocol_boundary(text[start:end])
        if channel == "final":
            preferred_segments.append(segment)
        elif channel not in _HIDDEN_CHANNELS:
            fallback_segments.append(segment)

    if preferred_segments:
        return "".join(preferred_segments).lstrip("\n")
    if fallback_segments:
        return "".join(fallback_segments).lstrip("\n")
    return ""


def _truncate_at_protocol_boundary(text: str) -> str:
    earliest_index: int | None = None
    for token in _PROTOCOL_TOKENS:
        index = text.find(token)
        if index == -1:
            continue
        if earliest_index is None or index < earliest_index:
            earliest_index = index
    if earliest_index is None:
        return text
    return text[:earliest_index]


def _strip_auxiliary_markup(text: str) -> str:
    return (
        str(text or "")
        .replace("\r\n", "\n")
        .replace("\ufeff", "")
        .strip()
        .replace("\r", "\n")
    )


def strip_hidden_reasoning_markup(text: str) -> str:
    cleaned = str(text or "").replace("\r\n", "\n")
    cleaned = _THOUGHT_CHANNEL_RE.sub("", cleaned)
    cleaned = _THINK_TAG_RE.sub("", cleaned)
    cleaned = _THINK_BLOCK_RE.sub("", cleaned)
    cleaned = _PATH_LINE_RE.sub("", cleaned)
    cleaned = cleaned.lstrip("\n")
    return cleaned.lstrip()
