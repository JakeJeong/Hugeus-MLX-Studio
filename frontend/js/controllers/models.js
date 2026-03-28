import { api } from "../api.js?v=20260328-2";
import {
  closeModelManager,
  renderActivity,
  renderGgufModels,
  renderLocalModels,
  renderRemoteGgufFiles,
  renderSearchResults,
} from "../render.js?v=20260328-2";
import { elements, state } from "../state.js?v=20260328-2";

export async function refreshActivity(refreshStatus, refreshLocalModels, refreshGgufModels, searchModels) {
  const payload = await api("/api/activity");
  state.modelActivity = payload;
  renderActivity();

  if (payload.active) {
    if (!state.activityPollId) {
      state.activityPollId = window.setInterval(() => {
        refreshActivity(refreshStatus, refreshLocalModels, refreshGgufModels, searchModels).catch(() => {});
      }, 800);
    }
    return;
  }

  if (state.activityPollId) {
    window.clearInterval(state.activityPollId);
    state.activityPollId = null;
    await Promise.all([refreshStatus(), refreshLocalModels(), refreshGgufModels()]);
    if (state.modelSearchQuery) {
      await searchModels();
    }
  }
}

export async function refreshLocalModels() {
  const [mlxPayload, ggufPayload] = await Promise.all([
    api("/api/models/local"),
    api("/api/models/gguf"),
  ]);
  renderLocalModels(mlxPayload.models, ggufPayload.models);
}

export async function refreshGgufModels() {
  const payload = await api("/api/models/gguf");
  renderGgufModels(payload.models);
}

export async function fetchModelFiles(modelId, format = "gguf") {
  elements.requestState.textContent = `Loading ${modelId} files...`;
  const payload = await api(`/api/models/files?model_id=${encodeURIComponent(modelId)}&format=${encodeURIComponent(format)}`);
  renderRemoteGgufFiles(modelId, payload.files);
  elements.requestState.textContent = `Found ${payload.files.length} files in ${modelId}.`;
}

export async function loadModelInCurrentRuntime(modelId, renderStatus, searchModels, refreshLocalModels, refreshGgufModels) {
  state.uiActivity = {
    title: "Switching model",
    detail: `Loading and warming up ${modelId}`,
    progress: null,
    progressText: "Preparing runtime...",
  };
  renderActivity();
  elements.requestState.textContent = `Loading ${modelId}...`;
  elements.statusPill.textContent = "Loading";
  try {
    const payload = await api("/api/models/select", {
      method: "POST",
      body: JSON.stringify({ model_id: modelId }),
    });
    renderStatus(payload);
    await Promise.all([refreshLocalModels(), refreshGgufModels()]);
    if (state.modelSearchQuery) {
      await searchModels();
    }
    closeModelManager();
    elements.requestState.textContent = `${modelId} ready.`;
  } finally {
    state.uiActivity = null;
    renderActivity();
  }
}

export async function switchRuntime(runtimeName, modelId, renderStatus, searchModels, refreshLocalModels, refreshGgufModels) {
  state.uiActivity = {
    title: "Switching engine",
    detail: `Activating ${runtimeName}`,
    progress: null,
    progressText: "Updating runtime...",
  };
  renderActivity();
  elements.requestState.textContent = `Switching to ${runtimeName}...`;
  elements.statusPill.textContent = "Loading";
  try {
    const payload = await api("/api/runtime", {
      method: "POST",
      body: JSON.stringify({ runtime: runtimeName, model_id: modelId ?? null }),
    });
    renderStatus(payload);
    await Promise.all([refreshLocalModels(), refreshGgufModels()]);
    if (state.modelSearchQuery) {
      await searchModels();
    }
    elements.requestState.textContent = `${runtimeName} ready.`;
  } finally {
    state.uiActivity = null;
    renderActivity();
  }
}

export async function selectModel(modelId, renderStatus, searchModels, refreshLocalModels, refreshGgufModels) {
  if (state.runtime !== "mlx") {
    await switchRuntime("mlx", modelId, renderStatus, searchModels, refreshLocalModels, refreshGgufModels);
  }
  await loadModelInCurrentRuntime(modelId, renderStatus, searchModels, refreshLocalModels, refreshGgufModels);
}

export async function unloadModel(renderStatus, refreshLocalModels, refreshGgufModels) {
  elements.requestState.textContent = "Unloading model...";
  const payload = await api("/api/models/unload", {
    method: "POST",
    body: JSON.stringify({}),
  });
  renderStatus(payload);
  await Promise.all([refreshLocalModels(), refreshGgufModels()]);
  elements.requestState.textContent = "Model unloaded.";
}

export async function deleteModel(modelId, renderStatus, searchModels, refreshLocalModels, refreshGgufModels) {
  elements.requestState.textContent = `Deleting ${modelId}...`;
  const payload = await api("/api/models/delete", {
    method: "POST",
    body: JSON.stringify({ model_id: modelId }),
  });
  renderStatus(payload);
  await Promise.all([refreshLocalModels(), refreshGgufModels()]);
  if (state.modelSearchQuery) {
    await searchModels();
  }
  elements.requestState.textContent = `${modelId} deleted.`;
}

export async function deleteGgufModel(
  modelPath,
  modelId,
  renderStatus,
  searchModels,
  refreshLocalModels,
  refreshGgufModels
) {
  elements.requestState.textContent = `Deleting ${modelId || modelPath}...`;
  const payload = await api("/api/models/delete", {
    method: "POST",
    body: JSON.stringify({
      model_id: modelId ?? null,
      model_path: modelPath,
      format: "gguf",
    }),
  });
  renderStatus(payload);
  await Promise.all([refreshLocalModels(), refreshGgufModels()]);
  if (state.modelSearchQuery) {
    await searchModels();
  }
  elements.requestState.textContent = `${modelId || modelPath} deleted.`;
}

export async function searchModels() {
  const query = elements.modelSearchInput.value.trim();
  state.modelSearchQuery = query;
  if (!query) {
    elements.modelSearchResults.innerHTML = "";
    return;
  }
  elements.requestState.textContent = `Searching ${query}...`;
  const payload = await api("/api/models/search", {
    method: "POST",
    body: JSON.stringify({ query }),
  });
  renderSearchResults(payload.results);
  elements.requestState.textContent = `Found ${payload.results.length} model candidates.`;
}

export async function downloadModel(
  modelId,
  format,
  refreshLocalModels,
  refreshGgufModels,
  searchModels,
  refreshActivity,
  filename = null
) {
  elements.requestState.textContent = `Downloading ${modelId}...`;
  const payload = await api("/api/models/download", {
    method: "POST",
    body: JSON.stringify({ model_id: modelId, format, filename }),
  });
  state.modelActivity = payload;
  renderActivity();
  await Promise.all([refreshLocalModels(), refreshGgufModels()]);
  if (state.modelSearchQuery) {
    await searchModels();
  }
  refreshActivity().catch(() => {});
  elements.requestState.textContent = `${modelId} download started.`;
}

export async function cancelDownload(refreshStatus, refreshLocalModels, refreshGgufModels, searchModels) {
  elements.requestState.textContent = "Cancelling download...";
  const payload = await api("/api/models/download/cancel", {
    method: "POST",
    body: JSON.stringify({}),
  });
  state.modelActivity = payload;
  await Promise.all([refreshStatus(), refreshLocalModels(), refreshGgufModels()]);
  if (state.modelSearchQuery) {
    await searchModels();
  }
  renderActivity();
  elements.requestState.textContent = payload.message || "Download cancelled.";
}

export async function useGgufPath(
  pathValue,
  renderStatus,
  searchModels,
  refreshLocalModels,
  refreshGgufModels
) {
  const modelPath = (pathValue || elements.ggufPathInput.value).trim();
  if (!modelPath) {
    throw new Error("Enter a .gguf path or pick one from the GGUF list.");
  }
  if (!modelPath.endsWith(".gguf")) {
    throw new Error("llama.cpp runtime expects a .gguf file path.");
  }
  elements.ggufPathInput.value = modelPath;
  await switchRuntime("llama_cpp", modelPath, renderStatus, searchModels, refreshLocalModels, refreshGgufModels);
  await loadModelInCurrentRuntime(modelPath, renderStatus, searchModels, refreshLocalModels, refreshGgufModels);
}
