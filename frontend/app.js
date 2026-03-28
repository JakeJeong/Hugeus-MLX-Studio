import { elements, state } from "./js/state.js?v=20260328-2";
import {
  closeModelManager,
  openModelManager,
  renderActivity,
  renderContextFiles,
  renderLocalModelFilters,
  renderMessages,
  renderPreview,
  renderRemoteGgufFiles,
  renderStatus,
  updatePreviewAction,
  updateUiState,
} from "./js/render.js?v=20260328-2";
import {
  applyPreset,
  clearChat,
  clearPresetSelection,
  handleError,
  renderPresetSelection,
  restoreUiSettings,
  saveSettings,
  sendChat,
  stopGeneration,
} from "./js/controllers/chat.js?v=20260328-2";
import {
  cancelDownload,
  deleteModel,
  deleteGgufModel,
  downloadModel,
  fetchModelFiles,
  refreshActivity,
  refreshGgufModels,
  refreshLocalModels,
  searchModels,
  selectModel,
  switchRuntime,
  unloadModel,
  useGgufPath,
} from "./js/controllers/models.js?v=20260328-2";
import { handleContextRemove, openWorkspaceFile, refreshWorkspaceFiles, toggleSelectedFileContext } from "./js/controllers/workspace.js?v=20260328-2";
import { api } from "./js/api.js?v=20260328-2";

async function refreshStatus() {
  const payload = await api("/api/status");
  renderStatus(payload);
}

function bindEvents() {
  const buildDeleteMessage = (label, sizeGb) =>
    `Delete local model cache for ${label}${sizeGb ? ` (~${sizeGb} GB)` : ""}?`;
  const bind = (element, eventName, handler) => {
    if (!element) {
      return;
    }
    element.addEventListener(eventName, handler);
  };
  let closeModelManagerOnBackdropClick = false;

  bind(elements.userInput, "keydown", (event) => {
    if (state.isComposing || event.isComposing || event.keyCode === 229) {
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendChat(event);
    }
  });

  bind(elements.userInput, "compositionstart", () => {
    state.isComposing = true;
  });

  bind(elements.userInput, "compositionend", () => {
    state.isComposing = false;
  });

  bind(elements.chatForm, "submit", sendChat);
  bind(elements.clearChatButton, "click", clearChat);
  bind(elements.stopButton, "click", stopGeneration);
  bind(elements.openModelManagerButton, "click", openModelManager);
  bind(elements.headerModelManagerButton, "click", openModelManager);
  bind(elements.closeModelManagerButton, "click", closeModelManager);
  bind(elements.saveSettingsButton, "click", () => {
    saveSettings(renderStatus).catch(handleError);
  });
  bind(elements.presetGeneralButton, "click", () => {
    applyPreset("general", renderStatus).catch(handleError);
  });
  bind(elements.presetCodingButton, "click", () => {
    applyPreset("coding", renderStatus).catch(handleError);
  });
  bind(elements.presetStableButton, "click", () => {
    applyPreset("stable", renderStatus).catch(handleError);
  });
  bind(elements.refreshModelsButton, "click", () => {
    Promise.all([refreshStatus(), refreshLocalModels(), refreshGgufModels()]).catch(handleError);
  });
  bind(elements.unloadModelButton, "click", () => {
    unloadModel(renderStatus, refreshLocalModels, refreshGgufModels).catch(handleError);
  });
  bind(elements.runtimeSelect, "change", (event) => {
    const runtimeName = event.target.value;
    if (runtimeName === state.runtime) {
      return;
    }
    switchRuntime(runtimeName, null, renderStatus, searchModels, refreshLocalModels, refreshGgufModels).catch(handleError);
  });
  bind(elements.modelSearchButton, "click", () => {
    searchModels().catch(handleError);
  });
  bind(elements.refreshGgufButton, "click", () => {
    refreshGgufModels().catch(handleError);
  });
  bind(elements.ggufActivateButton, "click", () => {
    useGgufPath(null, renderStatus, searchModels, refreshLocalModels, refreshGgufModels).catch(handleError);
  });
  bind(elements.cancelDownloadButton, "click", () => {
    cancelDownload(refreshStatus, refreshLocalModels, refreshGgufModels, searchModels).catch(handleError);
  });
  bind(elements.ggufPathInput, "keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      useGgufPath(null, renderStatus, searchModels, refreshLocalModels, refreshGgufModels).catch(handleError);
    }
  });
  bind(elements.modelSearchInput, "keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchModels().catch(handleError);
    }
  });
  bind(elements.fileSearchButton, "click", () => {
    refreshWorkspaceFiles().catch(handleError);
  });
  bind(elements.fileSearchInput, "keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      refreshWorkspaceFiles().catch(handleError);
    }
  });
  bind(elements.refreshFilesButton, "click", () => {
    refreshWorkspaceFiles().catch(handleError);
  });
  bind(elements.toggleContextButton, "click", toggleSelectedFileContext);

  bind(elements.localModels, "click", (event) => {
    const target = event.target.closest("button[data-action]");
    if (!target) {
      return;
    }
    const action = target.dataset.action;
    const modelId = target.dataset.modelId;
    if (!modelId) {
      return;
    }
    if (action === "load") {
      selectModel(modelId, renderStatus, searchModels, refreshLocalModels, refreshGgufModels).catch(handleError);
    }
    if (action === "load-gguf") {
      const modelPath = target.dataset.modelPath;
      if (!modelPath) {
        return;
      }
      useGgufPath(modelPath, renderStatus, searchModels, refreshLocalModels, refreshGgufModels).catch(handleError);
    }
    if (action === "delete") {
      const sizeGb = target.dataset.sizeGb;
      if (!window.confirm(buildDeleteMessage(modelId, sizeGb))) {
        return;
      }
      deleteModel(modelId, renderStatus, searchModels, refreshLocalModels, refreshGgufModels).catch(handleError);
    }
    if (action === "delete-gguf") {
      const modelPath = target.dataset.modelPath;
      if (!modelPath) {
        return;
      }
      const sizeGb = target.dataset.sizeGb;
      if (!window.confirm(buildDeleteMessage(modelId, sizeGb))) {
        return;
      }
      deleteGgufModel(modelPath, modelId, renderStatus, searchModels, refreshLocalModels, refreshGgufModels).catch(handleError);
    }
  });

  bind(elements.filterLocalMlxButton, "click", () => {
    state.localModelFilters.mlx = !state.localModelFilters.mlx;
    renderLocalModelFilters();
    refreshLocalModels().catch(handleError);
  });

  bind(elements.filterLocalGgufButton, "click", () => {
    state.localModelFilters.gguf = !state.localModelFilters.gguf;
    renderLocalModelFilters();
    refreshLocalModels().catch(handleError);
  });

  bind(elements.ggufModels, "click", (event) => {
    const target = event.target.closest("button[data-action]");
    if (!target) {
      return;
    }
    const action = target.dataset.action;
    const modelPath = target.dataset.modelPath;
    if (!modelPath) {
      return;
    }
    if (action === "load-gguf") {
      useGgufPath(modelPath, renderStatus, searchModels, refreshLocalModels, refreshGgufModels).catch(handleError);
    }
    if (action === "delete-gguf") {
      const modelId = target.dataset.modelId || modelPath;
      const sizeGb = target.dataset.sizeGb;
      if (!window.confirm(buildDeleteMessage(modelId, sizeGb))) {
        return;
      }
      deleteGgufModel(modelPath, modelId, renderStatus, searchModels, refreshLocalModels, refreshGgufModels).catch(handleError);
    }
  });

  bind(elements.modelSearchResults, "click", (event) => {
    const target = event.target.closest("button[data-action]");
    if (!target) {
      return;
    }
    const action = target.dataset.action;
    const modelId = target.dataset.modelId;
    const modelPath = target.dataset.modelPath;
    const modelFormat = target.dataset.modelFormat || "mlx";
    if (!modelId) {
      return;
    }
    if (action === "download") {
      downloadModel(
        modelId,
        modelFormat,
        refreshLocalModels,
        refreshGgufModels,
        searchModels,
        () => refreshActivity(refreshStatus, refreshLocalModels, refreshGgufModels, searchModels)
      ).catch(handleError);
    }
    if (action === "choose-gguf-file") {
      fetchModelFiles(modelId, "gguf").catch(handleError);
    }
    if (action === "load") {
      selectModel(modelId, renderStatus, searchModels, refreshLocalModels, refreshGgufModels).catch(handleError);
    }
    if (action === "load-gguf-search" && modelPath) {
      useGgufPath(modelPath, renderStatus, searchModels, refreshLocalModels, refreshGgufModels).catch(handleError);
    }
    if (action === "show-gguf") {
      elements.ggufPathInput.scrollIntoView({ behavior: "smooth", block: "center" });
      elements.requestState.textContent = "This GGUF repo has multiple local files. Pick one below.";
    }
  });

  bind(elements.ggufRemoteFiles, "click", (event) => {
    const target = event.target.closest("button[data-action='download-gguf-file']");
    if (!target) {
      return;
    }
    const modelId = target.dataset.modelId;
    const filename = target.dataset.filename;
    if (!modelId || !filename) {
      return;
    }
    downloadModel(
      modelId,
      "gguf",
      refreshLocalModels,
      refreshGgufModels,
      searchModels,
      () => refreshActivity(refreshStatus, refreshLocalModels, refreshGgufModels, searchModels),
      filename
    ).catch(handleError);
  });

  bind(elements.workspaceFiles, "click", (event) => {
    const target = event.target.closest(".file-row");
    if (!target?.dataset.path) {
      return;
    }
    openWorkspaceFile(target.dataset.path).catch(handleError);
  });

  bind(elements.messages, "click", async (event) => {
    const button = event.target.closest(".code-copy-button");
    if (!button) {
      return;
    }

    const codeElement = button.closest(".code-block")?.querySelector("code");
    if (!codeElement) {
      return;
    }

    try {
      await navigator.clipboard.writeText(codeElement.textContent || "");
      const original = button.textContent;
      button.textContent = "Copied";
      window.setTimeout(() => {
        button.textContent = original;
      }, 1200);
    } catch {
      button.textContent = "Failed";
      window.setTimeout(() => {
        button.textContent = "Copy";
      }, 1200);
    }
  });

  bind(elements.modelManagerModal, "pointerdown", (event) => {
    closeModelManagerOnBackdropClick = event.target === elements.modelManagerModal;
  });

  bind(elements.modelManagerModal, "pointercancel", () => {
    closeModelManagerOnBackdropClick = false;
  });

  bind(elements.modelManagerModal, "click", (event) => {
    const shouldClose =
      closeModelManagerOnBackdropClick && event.target === elements.modelManagerModal;
    closeModelManagerOnBackdropClick = false;
    if (shouldClose) {
      closeModelManager();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.modelManagerModal.classList.contains("hidden")) {
      closeModelManager();
    }
  });

  [
    elements.systemPrompt,
    elements.maxTokens,
    elements.temperature,
    elements.topP,
    elements.topK,
    elements.minP,
    elements.repeatPenalty,
    elements.repeatContextSize,
    elements.stopStrings,
    elements.enableThinking,
  ].forEach((element) => {
    if (element) {
      element.addEventListener("input", clearPresetSelection);
    }
  });
}

async function bootstrap() {
  restoreUiSettings();
  renderPresetSelection();
  renderMessages();
  renderContextFiles(handleContextRemove);
  renderPreview(null);
  renderRemoteGgufFiles(null, []);
  renderLocalModelFilters();
  updatePreviewAction();
  updateUiState();
  renderActivity();
  bindEvents();
  await Promise.all([
    refreshStatus(),
    refreshLocalModels(),
    refreshGgufModels(),
    refreshWorkspaceFiles(),
    refreshActivity(refreshStatus, refreshLocalModels, refreshGgufModels, searchModels),
  ]);
}

bootstrap().catch(handleError);
