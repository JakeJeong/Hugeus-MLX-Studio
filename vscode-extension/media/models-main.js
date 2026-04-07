(function () {
  const vscode = acquireVsCodeApi();

  const state = {
    localModels: [],
    modelSearchResults: [],
    modelSearchQuery: "",
    modelActivity: null,
    serverStatus: null,
    switchingModelKey: null,
    switchingModelLabel: null,
    activeTab: "installed",
  };

  const el = {
    activity: document.querySelector("#model-activity"),
    tabInstalled: document.querySelector("#tab-installed"),
    tabSearch: document.querySelector("#tab-search"),
    installedPanel: document.querySelector("#installed-panel"),
    searchPanel: document.querySelector("#search-panel"),
    searchForm: document.querySelector("#model-search-form"),
    searchInput: document.querySelector("#model-search-input"),
    searchButton: document.querySelector("#model-search-button"),
    unloadButton: document.querySelector("#unload-model-button"),
    openChatButton: document.querySelector("#open-chat-button"),
    localModelsList: document.querySelector("#local-models-list"),
    searchResults: document.querySelector("#model-search-results"),
  };

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function splitModelId(modelId) {
    const raw = String(modelId || "").trim();
    if (!raw) {
      return { title: "Unknown model", subtitle: "" };
    }
    if (raw.startsWith("/") || raw.startsWith("\\")) {
      const normalized = raw.replace(/\\/g, "/").replace(/\/+$/, "");
      const parts = normalized.split("/").filter(Boolean);
      return {
        title: parts[parts.length - 1] || raw,
        subtitle: parts.slice(0, -1).join("/"),
      };
    }
    const slashIndex = raw.indexOf("/");
    if (slashIndex === -1) {
      return { title: raw, subtitle: "" };
    }
    return {
      title: raw.slice(slashIndex + 1),
      subtitle: raw.slice(0, slashIndex),
    };
  }

  function trimExtension(name) {
    return String(name || "").replace(/\.gguf$/i, "");
  }

  function describeInstalledModel(model) {
    const rawId = String(model.id || "").trim();
    const modelPath = String(model.path || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");

    if (rawId && !rawId.startsWith("/") && !rawId.startsWith("\\")) {
      return splitModelId(rawId);
    }

    if (!modelPath) {
      return {
        title: model.label || rawId || "Unknown model",
        subtitle: "",
      };
    }

    const parts = modelPath.split("/").filter(Boolean);
    const basename = parts[parts.length - 1] || model.label || "Unknown model";

    if (modelPath.includes("/.lmstudio/models/")) {
      const anchor = parts.indexOf("models");
      const owner = anchor >= 0 ? parts[anchor + 1] || "" : "";
      const modelName = anchor >= 0 ? parts[anchor + 2] || basename : basename;
      const title = model.runtime === "llama_cpp" ? trimExtension(basename) : modelName;
      const subtitle = [owner, "LM Studio"].filter(Boolean).join(" · ");
      return { title, subtitle };
    }

    if (modelPath.includes("/.cache/huggingface/hub/")) {
      const repoPart = parts.find((part) => part.startsWith("models--")) || "";
      const repoName = repoPart ? repoPart.replace(/^models--/, "").replace(/--/g, "/") : "";
      return {
        title: model.runtime === "llama_cpp" ? trimExtension(basename) : basename,
        subtitle: [repoName, "HF Cache"].filter(Boolean).join(" · "),
      };
    }

    return {
      title: model.runtime === "llama_cpp" ? trimExtension(basename) : basename,
      subtitle: "Local Path",
    };
  }

  function isSwitching(model) {
    return Boolean(state.switchingModelKey && state.switchingModelKey === model.key);
  }

  function renderActivity() {
    const activity = state.modelActivity;
    if (!activity?.active) {
      el.activity.hidden = true;
      el.activity.innerHTML = "";
      return;
    }

    const progress =
      typeof activity.progress === "number" ? `${Math.round(activity.progress * 100)}%` : "Working";

    el.activity.hidden = false;
    el.activity.innerHTML = `
      <div class="model-activity-text">
        <div class="model-activity-title">${escapeHtml(activity.message || "Downloading model...")}</div>
        <div class="model-activity-meta">${escapeHtml(progress)}</div>
      </div>
      <button type="button" class="manager-btn subtle" data-action="cancel-download">Cancel</button>
    `;
  }

  function setActiveTab(tab) {
    state.activeTab = tab === "search" ? "search" : "installed";
    renderAll();
  }

  function renderLocalModels() {
    const models = state.localModels || [];
    if (models.length === 0) {
      el.localModelsList.innerHTML = `<div class="model-list-empty">No local models found.</div>`;
      return;
    }

    el.localModelsList.innerHTML = models
      .map((model) => {
        const switching = isSwitching(model);
        const loaded = Boolean(model.loaded);
        const actionLabel = switching ? "Loading..." : loaded ? "Loaded" : "Use";
        const actionDisabled = switching ? "disabled" : "";
        const selectedClass = loaded ? " selected" : "";
        const parts = describeInstalledModel(model);
        const subtitle = parts.subtitle;
        const stateBits = [
          escapeHtml(model.format),
          model.detail ? escapeHtml(model.detail) : "",
          loaded ? "Active" : "",
        ].filter(Boolean);
        return `
          <div class="model-card${selectedClass}">
            <div class="model-card-main" title="${escapeHtml(model.tooltip || model.path || model.label)}">
              <div class="model-card-title">${escapeHtml(parts.title || model.label)}</div>
              ${subtitle ? `<div class="model-card-subtitle">${escapeHtml(subtitle)}</div>` : ""}
              <div class="model-card-meta">${stateBits.join(" · ")}</div>
            </div>
            <div class="model-card-actions">
              <button type="button" class="manager-btn" data-action="switch-local" data-key="${escapeHtml(model.key)}" ${actionDisabled}>${escapeHtml(actionLabel)}</button>
              <button type="button" class="manager-btn danger" data-action="delete-local" data-key="${escapeHtml(model.key)}">Delete</button>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function renderSearchResults() {
    const results = state.modelSearchResults || [];
    const query = (state.modelSearchQuery || "").trim();

    if (!query && results.length === 0) {
      el.searchResults.innerHTML = `<div class="model-list-empty">Search for MLX or GGUF models.</div>`;
      return;
    }

    if (query && results.length === 0) {
      el.searchResults.innerHTML = `<div class="model-list-empty">No models found for this query.</div>`;
      return;
    }

    el.searchResults.innerHTML = results
      .map((model) => {
        const parts = splitModelId(model.id);
        return `
        <div class="model-card">
          <div class="model-card-main" title="${escapeHtml(model.id)}">
            <div class="model-card-title">${escapeHtml(parts.title)}</div>
            <div class="model-card-subtitle">${escapeHtml(parts.subtitle)}</div>
            <div class="model-card-meta">${escapeHtml(String(model.format || "").toUpperCase())}${model.size_gb ? ` · ${escapeHtml(Number(model.size_gb).toFixed(2))} GB` : ""}${model.cached ? " · Cached" : ""}</div>
          </div>
          <div class="model-card-actions">
            <button
              type="button"
              class="manager-btn primary"
              data-action="download-model"
              data-model-id="${escapeHtml(model.id)}"
              data-format="${escapeHtml(model.format || "mlx")}"
            >${model.cached ? "Redownload" : "Download"}</button>
          </div>
        </div>
      `;
      })
      .join("");
  }

  function renderAll() {
    el.tabInstalled.classList.toggle("active", state.activeTab === "installed");
    el.tabSearch.classList.toggle("active", state.activeTab === "search");
    el.installedPanel.hidden = state.activeTab !== "installed";
    el.searchPanel.hidden = state.activeTab !== "search";
    el.searchInput.value = state.modelSearchQuery || "";
    renderActivity();
    renderLocalModels();
    renderSearchResults();
  }

  function submitSearch() {
    const query = el.searchInput.value.trim();
    setActiveTab("search");
    vscode.postMessage({ type: "search-models", query });
  }

  window.addEventListener("message", (event) => {
    const { type, payload } = event.data || {};
    if (type !== "state") {
      return;
    }
    state.localModels = payload.localModels || [];
    state.modelSearchResults = payload.modelSearchResults || [];
    state.modelSearchQuery = payload.modelSearchQuery || "";
    state.modelActivity = payload.modelActivity || null;
    state.serverStatus = payload.serverStatus || null;
    state.switchingModelKey = payload.switchingModelKey || null;
    state.switchingModelLabel = payload.switchingModelLabel || null;
    renderAll();
    vscode.setState(state);
  });

  el.searchButton.addEventListener("click", () => {
    submitSearch();
  });

  el.searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitSearch();
  });

  el.tabInstalled.addEventListener("click", () => {
    setActiveTab("installed");
  });

  el.tabSearch.addEventListener("click", () => {
    setActiveTab("search");
  });

  el.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitSearch();
    }
  });

  el.unloadButton.addEventListener("click", () => {
    vscode.postMessage({ type: "unload-model" });
  });

  el.openChatButton.addEventListener("click", () => {
    vscode.postMessage({ type: "open-chat" });
  });

  document.body.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]");
    if (!action) {
      return;
    }
    const type = action.getAttribute("data-action");
    if (type === "cancel-download") {
      vscode.postMessage({ type: "cancel-model-download" });
      return;
    }
    if (type === "switch-local") {
      vscode.postMessage({ type: "switch-model", key: action.getAttribute("data-key") || "" });
      return;
    }
    if (type === "delete-local") {
      vscode.postMessage({ type: "delete-local-model", key: action.getAttribute("data-key") || "" });
      return;
    }
    if (type === "download-model") {
      vscode.postMessage({
        type: "download-model",
        modelId: action.getAttribute("data-model-id") || "",
        format: action.getAttribute("data-format") || "mlx",
      });
    }
  });

  vscode.postMessage({ type: "ready" });
})();
