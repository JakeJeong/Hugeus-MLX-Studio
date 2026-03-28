import { elements, state } from "./state.js?v=20260328-2";
import { escapeHtml, renderMarkdown } from "./markdown.js?v=20260328-2";

export function formatMs(value) {
  if (!value && value !== 0) {
    return "-";
  }
  return `${value.toFixed(1)} ms`;
}

export function formatSize(bytes) {
  if (!bytes && bytes !== 0) {
    return "-";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) {
    return "-";
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function renderMessages() {
  elements.messages.innerHTML = "";
  if (state.messages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML =
      "<strong>Ready for a real local session.</strong>" +
      "<p class='subtle'>Load a model, add files if you want workspace context, and use this surface to judge latency and quality.</p>";
    elements.messages.appendChild(empty);
    scrollMessagesToBottom();
    return;
  }

  for (const message of state.messages) {
    const row = document.createElement("div");
    row.className = `message-row ${message.role}`;

    const stack = document.createElement("div");
    stack.className = "message-stack";

    const bubble = document.createElement("article");
    bubble.className = `message ${message.role}`;

    const label = document.createElement("div");
    label.className = "message-label";
    label.textContent = message.role === "user" ? "You" : "Assistant";

    const content = document.createElement("div");
    content.className = "message-content";
    content.innerHTML = renderMarkdown(message.content);

    bubble.append(label, content);
    stack.appendChild(bubble);

    if (message.phase && !message.metrics) {
      const phase = document.createElement("div");
      phase.className = `message-phase ${message.role}`;
      phase.textContent = message.phase.label || message.phase.phase || "Thinking...";
      stack.appendChild(phase);
    }

    if (message.metrics) {
      const metrics = document.createElement("div");
      metrics.className = `message-metrics ${message.role}`;
      metrics.textContent = formatMessageMetrics(message.metrics);
      stack.appendChild(metrics);
    }

    row.appendChild(stack);
    elements.messages.appendChild(row);
  }

  scrollMessagesToBottom();
}

export function scrollMessagesToBottom() {
  elements.messages.scrollTop = elements.messages.scrollHeight;
  const lastMessage = elements.messages.lastElementChild;
  if (!lastMessage) {
    return;
  }
  window.requestAnimationFrame(() => {
    elements.messages.scrollTop = elements.messages.scrollHeight;
    lastMessage.scrollIntoView({ block: "end" });
  });
}

export function updateUiState() {
  const busy = state.isGenerating;
  elements.sendButton.disabled = busy;
  elements.stopButton.disabled = !busy;
  elements.userInput.disabled = busy;
  elements.clearChatButton.disabled = busy;
  elements.openModelManagerButton.disabled = busy;
  elements.headerModelManagerButton.disabled = busy;
  elements.refreshModelsButton.disabled = busy;
  elements.unloadModelButton.disabled = busy;
  elements.modelSearchButton.disabled = busy;
  elements.refreshFilesButton.disabled = busy;
  elements.fileSearchButton.disabled = busy;
  elements.toggleContextButton.disabled = busy || !state.selectedFile;
}

export function renderActivity() {
  const activity = state.modelActivity;
  const uiActivity = state.uiActivity;
  const active = Boolean(uiActivity || activity?.active);
  elements.activityOverlay.classList.toggle("hidden", !active);
  elements.cancelDownloadButton.classList.add("hidden");
  if (!active) {
    return;
  }

  if (uiActivity) {
    elements.activityTitle.textContent = uiActivity.title;
    elements.activityDetail.textContent = uiActivity.detail;
    elements.activityProgressBar.classList.toggle("indeterminate", uiActivity.progress == null);
    elements.activityProgressBar.style.width =
      uiActivity.progress != null ? `${Math.round(uiActivity.progress * 100)}%` : "38%";
    elements.activityProgressText.textContent = uiActivity.progressText || "Working...";
    return;
  }

  const progress = activity.progress;
  elements.activityTitle.textContent = activity.phase === "error" ? "Model task failed" : "Downloading model";
  elements.activityDetail.textContent = activity.message || "Working...";
  elements.activityProgressBar.classList.toggle("indeterminate", progress == null);
  elements.activityProgressBar.style.width = progress != null ? `${Math.round(progress * 100)}%` : "42%";
  if (activity.active) {
    elements.cancelDownloadButton.classList.remove("hidden");
  }
  if (progress != null && activity.total_bytes) {
    elements.activityProgressText.textContent = `${Math.round(progress * 100)}% · ${formatBytes(activity.downloaded_bytes)} / ${formatBytes(activity.total_bytes)}`;
  } else if (activity.downloaded_bytes) {
    elements.activityProgressText.textContent = `${formatBytes(activity.downloaded_bytes)} downloaded`;
  } else {
    elements.activityProgressText.textContent = "Preparing files...";
  }
}

export function renderContextFiles(onRemove) {
  elements.contextFiles.innerHTML = "";
  if (state.contextFiles.size === 0) {
    const empty = document.createElement("div");
    empty.className = "context-empty subtle";
    empty.textContent = "No files attached to the chat yet.";
    elements.contextFiles.appendChild(empty);
    return;
  }

  for (const [path] of state.contextFiles.entries()) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "context-chip";
    chip.innerHTML = `<span>${escapeHtml(path)}</span><strong>&times;</strong>`;
    chip.addEventListener("click", () => onRemove(path));
    elements.contextFiles.appendChild(chip);
  }
}

export function renderMetrics(metrics) {
  elements.metricTtft.textContent = formatMs(metrics.ttft_ms);
  const prefill = metrics.prefill_tps ? `${metrics.prefill_tps.toFixed(1)} tok/s` : "-";
  const decode = metrics.decode_tps ? `${metrics.decode_tps.toFixed(1)} tok/s` : "-";
  const memory = metrics.peak_memory_gb ? `${metrics.peak_memory_gb.toFixed(2)} GB` : "-";
  elements.metricPrefill.textContent = metrics.cached_tokens ? `${prefill} • cache ${metrics.cached_tokens}` : prefill;
  elements.metricDecode.textContent = metrics.cache_hit ? `${decode} • ${metrics.cache_source}` : decode;
  elements.metricMemory.textContent = memory;
}

export function formatMessageMetrics(metrics) {
  const parts = [];
  if (metrics.ttft_ms || metrics.ttft_ms === 0) {
    parts.push(`TTFT ${formatMs(metrics.ttft_ms)}`);
  }
  if (metrics.decode_tps) {
    parts.push(`${metrics.decode_tps.toFixed(1)} tok/s`);
  }
  if (metrics.peak_memory_gb) {
    parts.push(`${metrics.peak_memory_gb.toFixed(2)} GB`);
  }
  if (metrics.completion_tokens) {
    parts.push(`${metrics.completion_tokens} tokens`);
  }
  if (metrics.cache_hit) {
    parts.push(`cache ${metrics.cache_source}`);
  }
  return parts.join(" · ");
}

export function renderStatus(payload) {
  state.runtime = payload.runtime;
  state.runtimes = Array.isArray(payload.runtimes) ? payload.runtimes : [];
  const activeModel = payload.model_id || (payload.runtime === "llama_cpp" ? "No GGUF selected" : "-");
  if (elements.activeModel) {
    elements.activeModel.textContent = activeModel;
  }
  if (elements.sidebarActiveModel) {
    elements.sidebarActiveModel.textContent = activeModel;
  }
  if (elements.statusText) {
    elements.statusText.textContent =
      `${payload.loaded ? "Loaded" : "Idle"} on ${payload.runtime} · ` +
      `${payload.max_tokens} max tokens · temp ${payload.temperature} · top-p ${payload.top_p}`;
  }
  if (elements.statusPill) {
    elements.statusPill.textContent = payload.loaded ? "Loaded" : "Idle";
  }
  if (elements.maxTokens) {
    elements.maxTokens.value = payload.max_tokens;
  }
  if (elements.temperature) {
    elements.temperature.value = payload.temperature;
  }
  if (elements.topP) {
    elements.topP.value = payload.top_p ?? 0;
  }
  if (elements.topK) {
    elements.topK.value = payload.top_k ?? 0;
  }
  if (elements.minP) {
    elements.minP.value = payload.min_p ?? 0;
  }
  if (elements.repeatPenalty) {
    elements.repeatPenalty.value = payload.repeat_penalty ?? 1;
  }
  if (elements.repeatContextSize) {
    elements.repeatContextSize.value = payload.repeat_context_size ?? 0;
  }
  if (elements.stopStrings) {
    elements.stopStrings.value = Array.isArray(payload.stop_strings) ? payload.stop_strings.join(", ") : "";
  }
  if (elements.enableThinking) {
    elements.enableThinking.checked = Boolean(payload.enable_thinking);
  }
  renderRuntimeSelector(payload.runtimes || [], payload.runtime);
}

export function renderGenerationPhase(phase) {
  state.generationPhase = phase;
  if (!elements.requestState || !elements.statusPill) {
    return;
  }
  if (!phase) {
    return;
  }
  elements.requestState.textContent = phase.label || "Thinking...";
  elements.statusPill.textContent = phase.badge || "Running";
}

export function renderRuntimeSelector(runtimes, currentRuntime) {
  elements.runtimeSelect.innerHTML = "";
  for (const runtime of runtimes) {
    const option = document.createElement("option");
    option.value = runtime.id;
    option.textContent = runtime.available ? runtime.label : `${runtime.label} (install needed)`;
    option.disabled = !runtime.available;
    option.selected = runtime.id === currentRuntime;
    elements.runtimeSelect.appendChild(option);
  }
}

export function renderLocalModels(models, ggufModels = []) {
  elements.localModels.innerHTML = "";
  const downloadModelId = state.modelActivity?.active ? state.modelActivity.model_id : null;
  const allModels = [
    ...models.map((model) => ({ ...model, format: "mlx" })),
    ...ggufModels.map((model) => ({ ...model, format: "gguf" })),
  ];
  const combined = allModels.filter((model) => state.localModelFilters[model.format] !== false);

  renderLocalModelSummary(allModels, combined);

  if (combined.length === 0) {
    const empty = document.createElement("div");
    empty.className = "info-card muted-card";
    empty.innerHTML = "<strong>No local models for the current filter.</strong><p>Turn MLX or GGUF back on, or download a model below.</p>";
    elements.localModels.appendChild(empty);
    return;
  }

  for (const model of combined) {
    const isGguf = model.format === "gguf";
    const isReady = model.ready !== false;
    const disabled = downloadModelId === model.id || !isReady;
    const card = document.createElement("article");
    card.className = `info-card model-card ${model.loaded ? "loaded" : ""}`;
    card.innerHTML = `
      <div class="card-top">
        <div>
          <strong>${escapeHtml(model.id)}</strong>
          <p>${[
            isGguf ? "GGUF" : "MLX",
            model.size_gb ? `${model.size_gb.toFixed(2)} GB cached` : "Cached locally",
            isGguf && model.path ? model.path : null,
            !isReady && model.error ? model.error : null,
          ].filter(Boolean).join(" · ")}</p>
        </div>
        <span class="tag ${!isReady ? "warning" : model.loaded ? "success" : model.selected ? "active" : ""}">
          ${!isReady ? "Invalid" : model.loaded ? "Loaded" : model.selected ? "Selected" : "Local"}
        </span>
      </div>
      <div class="card-actions">
        <span class="tag ${isGguf ? "" : "active"}">${isGguf ? "GGUF" : "MLX"}</span>
        <button class="button compact" data-action="${isGguf ? "load-gguf" : "load"}" data-model-id="${escapeHtml(model.id)}" ${isGguf ? `data-model-path="${escapeHtml(model.path)}"` : ""} type="button" ${disabled ? "disabled" : ""}>
          ${!isReady ? "Unsupported" : model.loaded ? "Reload" : "Use"}
        </button>
        <button class="button ghost compact" data-action="${isGguf ? "delete-gguf" : "delete"}" data-model-id="${escapeHtml(model.id)}" ${isGguf ? `data-model-path="${escapeHtml(model.path)}"` : ""} ${model.size_gb != null ? `data-size-gb="${escapeHtml(String(model.size_gb))}"` : ""} type="button" ${downloadModelId === model.id ? "disabled" : ""}>
          Delete
        </button>
      </div>
    `;
    elements.localModels.appendChild(card);
  }
}

export function renderLocalModelSummary(allModels, visibleModels) {
  const totals = {
    allCount: allModels.length,
    allSizeGb: allModels.reduce((sum, model) => sum + (Number(model.size_gb) || 0), 0),
    mlxCount: allModels.filter((model) => model.format === "mlx").length,
    ggufCount: allModels.filter((model) => model.format === "gguf").length,
    visibleCount: visibleModels.length,
    visibleSizeGb: visibleModels.reduce((sum, model) => sum + (Number(model.size_gb) || 0), 0),
  };

  if (!elements.localModelSummary) {
    return;
  }

  elements.localModelSummary.textContent =
    `Showing ${totals.visibleCount} of ${totals.allCount} local models · ${totals.visibleSizeGb.toFixed(2)} GB visible · ` +
    `MLX ${totals.mlxCount} / GGUF ${totals.ggufCount} · ${totals.allSizeGb.toFixed(2)} GB total`;
}

export function renderLocalModelFilters() {
  const entries = [
    [elements.filterLocalMlxButton, state.localModelFilters.mlx],
    [elements.filterLocalGgufButton, state.localModelFilters.gguf],
  ];
  for (const [button, active] of entries) {
    if (!button) {
      continue;
    }
    button.classList.toggle("active", Boolean(active));
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

export function openModelManager() {
  elements.modelManagerModal.classList.remove("hidden");
  elements.modelManagerModal.setAttribute("aria-hidden", "false");
}

export function closeModelManager() {
  elements.modelManagerModal.classList.add("hidden");
  elements.modelManagerModal.setAttribute("aria-hidden", "true");
}

export function renderSearchResults(results) {
  elements.modelSearchResults.innerHTML = "";
  const activity = state.modelActivity;
  if (results.length === 0) {
    const empty = document.createElement("div");
    empty.className = "info-card muted-card";
    empty.innerHTML = "<strong>No results.</strong><p>Try a shorter keyword like qwen, gemma, coder, or 7b.</p>";
    elements.modelSearchResults.appendChild(empty);
    return;
  }

  for (const model of results) {
    const isMlx = model.format === "mlx";
    const localGgufSinglePath = model.format === "gguf" ? model.local_path : null;
    const action = model.cached
      ? isMlx
        ? "load"
        : localGgufSinglePath
          ? "load-gguf-search"
          : "show-gguf"
      : model.downloadable
        ? isMlx
          ? "download"
          : "choose-gguf-file"
        : "noop";
    const actionLabel = model.cached
      ? isMlx
        ? "Use"
        : localGgufSinglePath
          ? "Use"
          : "See GGUF Files"
      : model.downloadable
        ? isMlx
          ? "Download"
          : "Choose File"
        : "Unavailable";
    const card = document.createElement("article");
    card.className = "info-card search-card";
    card.innerHTML = `
      <div class="card-top">
        <div>
          <strong>${escapeHtml(model.id)}</strong>
          <p>${[
            model.format ? model.format.toUpperCase() : null,
            model.downloads ? `${model.downloads.toLocaleString()} downloads` : null,
            model.likes ? `${model.likes} likes` : null,
            model.size_gb ? `~${model.size_gb.toFixed(2)} GB` : null,
            model.local_count && model.local_count > 1 ? `${model.local_count} local GGUFs` : null,
          ].filter(Boolean).join(" · ")}</p>
        </div>
        <span class="tag ${activity?.active && activity.model_id === model.id ? "active" : model.cached ? "success" : ""}">
          ${activity?.active && activity.model_id === model.id ? "Working" : model.cached ? "Local" : "Remote"}
        </span>
      </div>
      <div class="card-actions">
        <span class="tag ${isMlx ? "active" : ""}">${isMlx ? "MLX" : "GGUF"}</span>
        <button class="button compact" data-action="${action}" data-model-id="${escapeHtml(model.id)}" ${localGgufSinglePath ? `data-model-path="${escapeHtml(localGgufSinglePath)}"` : ""} data-model-format="${escapeHtml(model.format || "")}" type="button" ${activity?.active && activity.model_id === model.id || action === "noop" ? "disabled" : ""}>
          ${activity?.active && activity.model_id === model.id ? "Downloading..." : actionLabel}
        </button>
      </div>
    `;
    elements.modelSearchResults.appendChild(card);
  }
}

export function renderGgufModels(models) {
  elements.ggufModels.innerHTML = "";
  if (models.length === 0) {
    const empty = document.createElement("div");
    empty.className = "info-card muted-card";
    empty.innerHTML = "<strong>No GGUF files found.</strong><p>LM Studio or llama.cpp downloaded models usually appear here automatically, or you can paste a full path.</p>";
    elements.ggufModels.appendChild(empty);
    return;
  }

  for (const model of models) {
    const card = document.createElement("article");
    card.className = `info-card model-card ${model.loaded ? "loaded" : ""}`;
    card.innerHTML = `
      <div class="card-top">
        <div>
          <strong>${escapeHtml(model.id)}</strong>
          <p>${escapeHtml(model.path)}${model.size_gb ? ` · ${model.size_gb.toFixed(2)} GB` : ""}</p>
        </div>
        <span class="tag ${model.loaded ? "success" : model.selected ? "active" : ""}">
          ${model.loaded ? "Loaded" : model.selected ? "Selected" : "Local"}
        </span>
      </div>
      <div class="card-actions">
        <button class="button compact" data-action="load-gguf" data-model-path="${escapeHtml(model.path)}" type="button">
          ${model.loaded ? "Reload" : "Use"}
        </button>
        <button class="button ghost compact" data-action="delete-gguf" data-model-id="${escapeHtml(model.id)}" data-model-path="${escapeHtml(model.path)}" ${model.size_gb != null ? `data-size-gb="${escapeHtml(String(model.size_gb))}"` : ""} type="button">
          Delete
        </button>
      </div>
    `;
    elements.ggufModels.appendChild(card);
  }
}

export function renderRemoteGgufFiles(repoId, files) {
  elements.ggufRemoteFiles.innerHTML = "";
  if (!repoId) {
    const empty = document.createElement("div");
    empty.className = "info-card muted-card";
    empty.innerHTML = "<strong>Select a GGUF repo.</strong><p>Choose a GGUF result above to list individual quant files like Q4_K_M.</p>";
    elements.ggufRemoteFiles.appendChild(empty);
    return;
  }

  if (files.length === 0) {
    const empty = document.createElement("div");
    empty.className = "info-card muted-card";
    empty.innerHTML = `<strong>No GGUF files found for ${escapeHtml(repoId)}.</strong><p>Try another repo.</p>`;
    elements.ggufRemoteFiles.appendChild(empty);
    return;
  }

  for (const file of files) {
    const card = document.createElement("article");
    card.className = "info-card search-card";
    card.innerHTML = `
      <div class="card-top">
        <div>
          <strong>${escapeHtml(file.name)}</strong>
          <p>${file.size_gb ? `${file.size_gb.toFixed(2)} GB` : "Size unavailable"}</p>
        </div>
        <span class="tag">GGUF</span>
      </div>
      <div class="card-actions">
        <button class="button compact" data-action="download-gguf-file" data-model-id="${escapeHtml(repoId)}" data-filename="${escapeHtml(file.name)}" type="button">
          Download File
        </button>
      </div>
    `;
    elements.ggufRemoteFiles.appendChild(card);
  }
}

export function renderWorkspaceFiles(files) {
  elements.workspaceFiles.innerHTML = "";
  if (files.length === 0) {
    const empty = document.createElement("div");
    empty.className = "info-card muted-card";
    empty.innerHTML = "<strong>No matching files.</strong><p>Try a filename, extension, or folder name.</p>";
    elements.workspaceFiles.appendChild(empty);
    return;
  }

  for (const file of files) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `file-row ${state.selectedFile?.path === file.path ? "selected" : ""}`;
    button.dataset.path = file.path;
    button.innerHTML = `
      <span class="file-path">${escapeHtml(file.path)}</span>
      <span class="file-size">${formatSize(file.size)}</span>
    `;
    elements.workspaceFiles.appendChild(button);
  }
}

export function renderPreview(file) {
  if (!file) {
    elements.previewTitle.textContent = "No file selected";
    elements.previewMeta.textContent = "Pick a file to inspect it and use it as chat context.";
    elements.filePreview.textContent = "Select a file from the list to preview its contents.";
    return;
  }

  elements.previewTitle.textContent = file.path;
  elements.previewMeta.textContent = `${formatSize(file.size)}${file.truncated ? " · preview truncated" : ""}`;
  elements.filePreview.textContent = file.content;
}

export function updatePreviewAction() {
  const file = state.selectedFile;
  if (!file) {
    elements.toggleContextButton.disabled = true;
    elements.toggleContextButton.textContent = "Add to Chat";
    return;
  }

  const attached = state.contextFiles.has(file.path);
  elements.toggleContextButton.disabled = false;
  elements.toggleContextButton.textContent = attached ? "Remove from Chat" : "Add to Chat";
}
