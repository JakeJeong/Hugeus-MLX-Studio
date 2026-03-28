import { api, readError } from "../api.js?v=20260328-2";
import { elements, state } from "../state.js?v=20260328-2";
import { renderActivity, renderGenerationPhase, renderMessages, renderMetrics, updateUiState } from "../render.js?v=20260328-2";

const UI_SETTINGS_STORAGE_KEY = "mlx-studio-ui-settings";
const PRESETS = {
  general: {
    label: "General",
    description: "Balanced everyday chat with moderate creativity and clean stopping.",
    systemPrompt: "You are a helpful local assistant. Answer clearly and stay concise.",
    maxTokens: 320,
    temperature: 0.7,
    topP: 0.9,
    topK: 40,
    minP: 0,
    repeatPenalty: 1.08,
    repeatContextSize: 96,
    stopStrings: ["<|im_end|>", "<|endoftext|>"],
    enableThinking: false,
  },
  coding: {
    label: "Coding",
    description: "Grounded coding mode with lower temperature and anti-hallucination guardrails.",
    systemPrompt:
      "You are a careful coding assistant. If you are unsure about an API, framework, or acronym, say you are unsure instead of guessing. Keep answers factual and practical.",
    maxTokens: 384,
    temperature: 0.35,
    topP: 0.9,
    topK: 32,
    minP: 0,
    repeatPenalty: 1.1,
    repeatContextSize: 128,
    stopStrings: ["<|im_end|>", "<|endoftext|>"],
    enableThinking: false,
  },
  stable: {
    label: "Stable",
    description: "Low-variance mode for shorter, safer answers and more repeat control.",
    systemPrompt:
      "You are a careful local assistant. Prefer short factual answers. If you are unsure, say so briefly.",
    maxTokens: 220,
    temperature: 0.15,
    topP: 0.85,
    topK: 24,
    minP: 0,
    repeatPenalty: 1.12,
    repeatContextSize: 160,
    stopStrings: ["<|im_end|>", "<|endoftext|>"],
    enableThinking: false,
  },
};

export function restoreUiSettings() {
  try {
    const raw = window.localStorage.getItem(UI_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return;
    }
    const payload = JSON.parse(raw);
    if (typeof payload.systemPrompt === "string") {
      elements.systemPrompt.value = payload.systemPrompt;
    }
    if (typeof payload.selectedPreset === "string" && PRESETS[payload.selectedPreset]) {
      state.selectedPreset = payload.selectedPreset;
    }
  } catch {
    // Ignore malformed local settings and keep defaults.
  }
  renderPresetSelection();
}

function persistUiSettings() {
  try {
    window.localStorage.setItem(
      UI_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        systemPrompt: elements.systemPrompt.value,
        selectedPreset: state.selectedPreset,
      })
    );
  } catch {
    // Ignore storage failures.
  }
}

export function renderPresetSelection() {
  const presets = [
    [elements.presetGeneralButton, "general"],
    [elements.presetCodingButton, "coding"],
    [elements.presetStableButton, "stable"],
  ];
  for (const [button, presetId] of presets) {
    if (!button) {
      continue;
    }
    const active = state.selectedPreset === presetId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
  const description = state.selectedPreset ? PRESETS[state.selectedPreset]?.description : "Choose a preset to load recommended settings.";
  if (elements.presetDescription) {
    elements.presetDescription.textContent = description;
  }
}

function setFormSettings(preset) {
  elements.systemPrompt.value = preset.systemPrompt;
  elements.maxTokens.value = String(preset.maxTokens);
  elements.temperature.value = String(preset.temperature);
  elements.topP.value = String(preset.topP);
  elements.topK.value = String(preset.topK);
  elements.minP.value = String(preset.minP);
  elements.repeatPenalty.value = String(preset.repeatPenalty);
  elements.repeatContextSize.value = String(preset.repeatContextSize);
  elements.stopStrings.value = preset.stopStrings.join(", ");
  if (elements.enableThinking) {
    elements.enableThinking.checked = Boolean(preset.enableThinking);
  }
}

export async function applyPreset(presetId, renderStatus) {
  const preset = PRESETS[presetId];
  if (!preset) {
    throw new Error(`Unknown preset: ${presetId}`);
  }
  state.selectedPreset = presetId;
  setFormSettings(preset);
  renderPresetSelection();
  persistUiSettings();
  await saveSettings(renderStatus);
  elements.requestState.textContent = `${preset.label} preset applied.`;
}

export function clearPresetSelection() {
  if (!state.selectedPreset) {
    return;
  }
  state.selectedPreset = null;
  renderPresetSelection();
  persistUiSettings();
}

export function buildRequestMessages() {
  const requestMessages = [];
  const systemParts = [];
  const prompt = elements.systemPrompt.value.trim();

  if (prompt) {
    systemParts.push(prompt);
  }

  if (state.contextFiles.size > 0) {
    const fileBlocks = Array.from(state.contextFiles.entries()).map(([path, file]) => {
      return `File: ${path}\n\`\`\`\n${file.content}\n\`\`\``;
    });
    systemParts.push(
      "Use the following workspace files as additional context. Prefer grounded answers that cite filenames when relevant.\n\n" +
        fileBlocks.join("\n\n")
    );
  }

  if (systemParts.length > 0) {
    requestMessages.push({ role: "system", content: systemParts.join("\n\n") });
  }

  for (const message of state.messages) {
    if (message.role === "assistant" && !message.content) {
      continue;
    }
    requestMessages.push({
      role: message.role,
      content: message.content,
    });
  }
  return requestMessages;
}

export function getGenerationSettings() {
  const maxTokens = Number(elements.maxTokens.value);
  const temperature = Number(elements.temperature.value);
  const topP = Number(elements.topP.value);
  const topK = Number(elements.topK.value);
  const minP = Number(elements.minP.value);
  const repeatPenalty = Number(elements.repeatPenalty.value);
  const repeatContextSize = Number(elements.repeatContextSize.value);
  const enableThinking = elements.enableThinking ? elements.enableThinking.checked : false;
  const stopStrings = elements.stopStrings.value
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 4096) {
    throw new Error("Max Tokens must be an integer between 1 and 4096.");
  }
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    throw new Error("Temperature must be between 0.0 and 2.0.");
  }
  if (!Number.isFinite(topP) || topP < 0 || topP > 1) {
    throw new Error("Top P must be between 0.0 and 1.0.");
  }
  if (!Number.isInteger(topK) || topK < 0 || topK > 500) {
    throw new Error("Top K must be an integer between 0 and 500.");
  }
  if (!Number.isFinite(minP) || minP < 0 || minP > 1) {
    throw new Error("Min P must be between 0.0 and 1.0.");
  }
  if (!Number.isFinite(repeatPenalty) || repeatPenalty < 0 || repeatPenalty > 3) {
    throw new Error("Repeat Penalty must be between 0.0 and 3.0.");
  }
  if (!Number.isInteger(repeatContextSize) || repeatContextSize < 0 || repeatContextSize > 4096) {
    throw new Error("Repeat Window must be an integer between 0 and 4096.");
  }
  if (stopStrings.length > 8) {
    throw new Error("Stop Strings can include up to 8 comma-separated values.");
  }

  return {
    maxTokens,
    temperature,
    topP,
    topK,
    minP,
    repeatPenalty,
    repeatContextSize,
    stopStrings,
    enableThinking,
  };
}

export async function saveSettings(renderStatus) {
  elements.requestState.textContent = "Saving settings...";
  const { maxTokens, temperature, topP, topK, minP, repeatPenalty, repeatContextSize, stopStrings, enableThinking } =
    getGenerationSettings();
  const payload = await api("/api/settings", {
    method: "POST",
    body: JSON.stringify({
      max_tokens: maxTokens,
      temperature,
      top_p: topP,
      top_k: topK,
      min_p: minP,
      repeat_penalty: repeatPenalty,
      repeat_context_size: repeatContextSize,
      stop_strings: stopStrings,
      enable_thinking: enableThinking,
    }),
  });
  renderStatus(payload);
  persistUiSettings();
  elements.requestState.textContent = "Settings saved.";
}

export async function clearChat() {
  if (state.isGenerating) {
    return;
  }
  state.messages = [];
  state.generationPhase = null;
  renderMessages();
  elements.requestState.textContent = "Conversation cleared.";
  try {
    await api("/api/session/reset", {
      method: "POST",
      body: JSON.stringify({ session_id: state.sessionId }),
    });
  } catch (error) {
    elements.requestState.textContent = `Reset warning: ${error.message}`;
  }
  state.sessionId = crypto.randomUUID();
}

export async function sendChat(event) {
  event.preventDefault();
  if (state.isGenerating) {
    return;
  }
  const userText = elements.userInput.value.trim();
  if (!userText) {
    return;
  }

  state.systemPrompt = elements.systemPrompt.value.trim();
  state.messages.push({ role: "user", content: userText });
  state.messages.push({
    role: "assistant",
    content: "",
    metrics: null,
    phase: {
      phase: "prefill",
      label: "Thinking...",
      badge: "Thinking",
    },
  });
  renderMessages();
  elements.userInput.value = "";
  renderGenerationPhase({
    phase: "prefill",
    label: "Thinking...",
    badge: "Thinking",
  });
  state.isGenerating = true;
  state.streamController = new AbortController();
  updateUiState();

  const requestMessages = buildRequestMessages();
  const { maxTokens, temperature, topP, topK, minP, repeatPenalty, repeatContextSize, stopStrings, enableThinking } =
    getGenerationSettings();

  try {
    const response = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: state.streamController.signal,
      body: JSON.stringify({
        messages: requestMessages,
        session_id: state.sessionId,
        max_tokens: maxTokens,
        temperature,
        top_p: topP,
        top_k: topK,
        min_p: minP,
        repeat_penalty: repeatPenalty,
        repeat_context_size: repeatContextSize,
        stop_strings: stopStrings,
        enable_thinking: enableThinking,
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(await readError(response, "Streaming request failed"));
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        const payload = JSON.parse(trimmed);
        if (payload.type === "delta") {
          const lastMessage = state.messages[state.messages.length - 1];
          if (lastMessage && lastMessage.role === "assistant") {
            lastMessage.content += payload.text;
            if (lastMessage.content.includes("<think>") && !lastMessage.content.includes("</think>")) {
              lastMessage.phase = {
                phase: "reasoning",
                label: "Reasoning...",
                badge: "Thinking",
              };
              renderGenerationPhase(lastMessage.phase);
            } else {
              lastMessage.phase = {
                phase: "responding",
                label: "Responding...",
                badge: "Responding",
              };
              renderGenerationPhase(lastMessage.phase);
            }
            renderMessages();
          }
        }
        if (payload.type === "status") {
          const lastMessage = state.messages[state.messages.length - 1];
          if (lastMessage && lastMessage.role === "assistant") {
            lastMessage.phase = payload;
            renderMessages();
          }
          renderGenerationPhase(payload);
        }
        if (payload.type === "done") {
          const lastMessage = state.messages[state.messages.length - 1];
          if (lastMessage && lastMessage.role === "assistant") {
            lastMessage.metrics = payload.metrics;
            lastMessage.phase = null;
            renderMessages();
          }
          renderMetrics(payload.metrics);
          elements.activeModel.textContent = payload.model_id;
          elements.requestState.textContent = "Done.";
          elements.statusPill.textContent = "Loaded";
          state.generationPhase = null;
        }
        if (payload.type === "error") {
          throw new Error(payload.message || "Streaming request failed");
        }
      }
    }
  } catch (error) {
    if (error.name === "AbortError") {
      elements.requestState.textContent = "Stopped.";
      elements.statusPill.textContent = "Loaded";
      state.generationPhase = null;
    } else {
      state.messages[state.messages.length - 1] = { role: "assistant", content: `Error: ${error.message}` };
      renderMessages();
      elements.requestState.textContent = "Request failed.";
      elements.statusPill.textContent = "Error";
      state.generationPhase = null;
    }
  } finally {
    state.isGenerating = false;
    state.streamController = null;
    updateUiState();
  }
}

export function stopGeneration() {
  if (!state.streamController) {
    return;
  }
  state.streamController.abort();
}

export function handleError(error) {
  elements.requestState.textContent = error.message;
  elements.statusPill.textContent = "Error";
  state.isGenerating = false;
  state.streamController = null;
  state.uiActivity = null;
  renderActivity();
  updateUiState();
}
