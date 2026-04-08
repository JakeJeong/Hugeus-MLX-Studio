(function () {
  const vscode = acquireVsCodeApi();
  const persistedState = vscode.getState() || {};

  const state = {
    localModels: [],
    modelSearchResults: [],
    modelSearchQuery: "",
    modelActivity: null,
    serverStatus: null,
    network: null,
    libraries: null,
    switchingModelKey: null,
    switchingModelLabel: null,
    activeTab: persistedState.activeTab === "search" ? "search" : "installed",
    errorMessage: "",
  };

  const ui = {
    tlsUploadPending: false,
    tlsDragOver: false,
  };

  const el = {
    activity: document.querySelector("#model-activity"),
    errorBanner: document.querySelector("#models-error-banner"),
    tabInstalled: document.querySelector("#tab-installed"),
    tabSearch: document.querySelector("#tab-search"),
    installedPanel: document.querySelector("#installed-panel"),
    searchPanel: document.querySelector("#search-panel"),
    searchForm: document.querySelector("#model-search-form"),
    searchInput: document.querySelector("#model-search-input"),
    searchButton: document.querySelector("#model-search-button"),
    unloadButton: document.querySelector("#unload-model-button"),
    openChatButton: document.querySelector("#open-chat-button"),
    addModelLibraryButton: document.querySelector("#add-model-library-button"),
    localModelsList: document.querySelector("#local-models-list"),
    modelLibraryList: document.querySelector("#model-library-list"),
    searchResults: document.querySelector("#model-search-results"),
    tlsCertStatus: document.querySelector("#tls-cert-status"),
    tlsCertTitle: document.querySelector("#tls-cert-title"),
    tlsCertDetail: document.querySelector("#tls-cert-detail"),
    tlsCertMeta: document.querySelector("#tls-cert-meta"),
    tlsCertDropzone: document.querySelector("#tls-cert-dropzone"),
    tlsCertInput: document.querySelector("#tls-cert-input"),
    tlsCertChooseButton: document.querySelector("#tls-cert-choose-button"),
    tlsCertClearButton: document.querySelector("#tls-cert-clear-button"),
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

  function basenameOfPath(value) {
    const normalized = String(value || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
    if (!normalized) {
      return "";
    }
    const parts = normalized.split("/").filter(Boolean);
    return parts[parts.length - 1] || normalized;
  }

  function setError(message) {
    state.errorMessage = String(message || "").trim();
    renderAll();
  }

  function handleTlsFile(file) {
    if (!file) {
      return;
    }

    const reader = new FileReader();
    ui.tlsUploadPending = true;
    state.errorMessage = "";
    renderAll();

    reader.onload = () => {
      const content = typeof reader.result === "string" ? reader.result : "";
      if (!content.trim()) {
        ui.tlsUploadPending = false;
        setError("Certificate file is empty.");
        return;
      }

      vscode.postMessage({
        type: "upload-tls-certificate",
        filename: file.name || "custom-root-ca.pem",
        content,
      });
    };

    reader.onerror = () => {
      ui.tlsUploadPending = false;
      setError("Failed to read the selected PEM file.");
    };

    reader.readAsText(file);
  }

  function renderBanner() {
    if (!state.errorMessage) {
      el.errorBanner.hidden = true;
      el.errorBanner.innerHTML = "";
      return;
    }

    el.errorBanner.hidden = false;
    el.errorBanner.innerHTML = `
      <div class="models-banner-text">${escapeHtml(state.errorMessage)}</div>
      <button type="button" class="manager-btn subtle" data-action="dismiss-error">Dismiss</button>
    `;
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

  function renderTlsStatus() {
    const serverAvailable = Boolean(state.serverStatus) && state.serverStatus.available !== false;
    const network = state.network || state.serverStatus?.network || null;
    const customConfigured = Boolean(network?.custom_ca_bundle_configured);

    let title = "Using default CA bundle";
    let detail = "Nothing extra is required on most networks. Import a company PEM only if HTTPS inspection breaks remote model search or download.";
    let meta = "";

    if (!serverAvailable) {
      title = "Server offline";
      detail = state.serverStatus?.error
        ? String(state.serverStatus.error)
        : "Start the MLX Studio server to configure network trust for model search.";
    } else if (ui.tlsUploadPending) {
      title = "Uploading PEM bundle";
      detail = "Applying the certificate and refreshing remote model access...";
    } else if (customConfigured) {
      title = network.custom_ca_bundle_name
        ? `Custom PEM: ${network.custom_ca_bundle_name}`
        : "Custom PEM configured";
      detail = "This bundle is merged with the default public CA roots, so normal HTTPS still works.";
      meta = [network.source ? `Source: ${network.source}` : "", network.effective_ca_bundle_path || ""]
        .filter(Boolean)
        .join(" · ");
    } else if (network?.source === "environment") {
      title = "Using shell CA bundle";
      detail = "The server inherited SSL_CERT_FILE or REQUESTS_CA_BUNDLE from the environment. You can still import a PEM here if that is easier.";
      meta = network.effective_ca_bundle_path || "";
    }

    el.tlsCertTitle.textContent = title;
    el.tlsCertDetail.textContent = detail;
    el.tlsCertMeta.textContent = meta;
    el.tlsCertMeta.hidden = !meta;

    el.tlsCertStatus.classList.toggle("configured", customConfigured);
    el.tlsCertStatus.classList.toggle("offline", !serverAvailable);
    el.tlsCertStatus.classList.toggle("pending", ui.tlsUploadPending);

    el.tlsCertDropzone.classList.toggle("drag-over", ui.tlsDragOver);
    el.tlsCertDropzone.classList.toggle("is-disabled", !serverAvailable || ui.tlsUploadPending);
    el.tlsCertDropzone.textContent = ui.tlsUploadPending
      ? "Uploading PEM bundle..."
      : "Drop a PEM bundle here or choose a file";

    el.tlsCertChooseButton.disabled = !serverAvailable || ui.tlsUploadPending;
    el.tlsCertClearButton.disabled = !customConfigured || ui.tlsUploadPending;
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

  function renderLibraries() {
    const libraries = Array.isArray(state.libraries?.custom_model_roots)
      ? state.libraries.custom_model_roots
      : [];

    if (libraries.length === 0) {
      el.modelLibraryList.innerHTML = `
        <div class="model-list-empty">
          Using only the default LM Studio and Hugging Face cache paths. Add a folder if your models live elsewhere.
        </div>
      `;
      return;
    }

    el.modelLibraryList.innerHTML = libraries
      .map((item) => {
        const libraryPath = String(item.path || "").trim();
        const title = String(item.label || "").trim() || basenameOfPath(libraryPath) || "Model library";
        return `
          <div class="model-card library-card">
            <div class="model-card-main" title="${escapeHtml(libraryPath)}">
              <div class="model-card-title">${escapeHtml(title)}</div>
              <div class="model-card-subtitle">${escapeHtml(libraryPath)}</div>
              <div class="model-card-meta">Custom model library</div>
            </div>
            <div class="model-card-actions">
              <button
                type="button"
                class="manager-btn danger"
                data-action="remove-model-library"
                data-path="${escapeHtml(libraryPath)}"
              >Remove</button>
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
    renderBanner();
    renderActivity();
    renderTlsStatus();
    renderLocalModels();
    renderLibraries();
    renderSearchResults();
    vscode.setState({
      activeTab: state.activeTab,
      network: state.network,
      libraries: state.libraries,
      errorMessage: state.errorMessage,
    });
  }

  function submitSearch() {
    const query = el.searchInput.value.trim();
    state.errorMessage = "";
    setActiveTab("search");
    vscode.postMessage({ type: "search-models", query });
  }

  window.addEventListener("message", (event) => {
    const { type, payload, message } = event.data || {};
    if (type === "state") {
      state.localModels = payload.localModels || [];
      state.modelSearchResults = payload.modelSearchResults || [];
      state.modelSearchQuery = payload.modelSearchQuery || "";
      state.modelActivity = payload.modelActivity || null;
      state.serverStatus = payload.serverStatus || null;
      state.network = payload.network || payload.serverStatus?.network || null;
      state.libraries = payload.libraries || payload.serverStatus?.libraries || null;
      state.switchingModelKey = payload.switchingModelKey || null;
      state.switchingModelLabel = payload.switchingModelLabel || null;
      state.errorMessage = "";
      ui.tlsUploadPending = false;
      ui.tlsDragOver = false;
      renderAll();
      return;
    }

    if (type === "error") {
      ui.tlsUploadPending = false;
      ui.tlsDragOver = false;
      setError(message || "Something went wrong.");
    }
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

  el.addModelLibraryButton.addEventListener("click", () => {
    state.errorMessage = "";
    renderAll();
    vscode.postMessage({ type: "choose-model-library-folder" });
  });

  el.tlsCertChooseButton.addEventListener("click", () => {
    if (el.tlsCertChooseButton.disabled) {
      return;
    }
    el.tlsCertInput.value = "";
    el.tlsCertInput.click();
  });

  el.tlsCertInput.addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    handleTlsFile(file);
    event.target.value = "";
  });

  el.tlsCertDropzone.addEventListener("click", () => {
    if (el.tlsCertChooseButton.disabled) {
      return;
    }
    el.tlsCertInput.value = "";
    el.tlsCertInput.click();
  });

  el.tlsCertDropzone.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    if (el.tlsCertChooseButton.disabled) {
      return;
    }
    el.tlsCertInput.value = "";
    el.tlsCertInput.click();
  });

  for (const eventName of ["dragenter", "dragover"]) {
    el.tlsCertDropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      if (el.tlsCertChooseButton.disabled) {
        return;
      }
      ui.tlsDragOver = true;
      renderTlsStatus();
    });
  }

  el.tlsCertDropzone.addEventListener("dragleave", (event) => {
    event.preventDefault();
    ui.tlsDragOver = false;
    renderTlsStatus();
  });

  el.tlsCertDropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    ui.tlsDragOver = false;
    renderTlsStatus();
    if (el.tlsCertChooseButton.disabled) {
      return;
    }
    const file = event.dataTransfer?.files && event.dataTransfer.files[0];
    handleTlsFile(file);
  });

  el.tlsCertClearButton.addEventListener("click", () => {
    if (el.tlsCertClearButton.disabled) {
      return;
    }
    ui.tlsUploadPending = true;
    state.errorMessage = "";
    renderAll();
    vscode.postMessage({ type: "clear-tls-certificate" });
  });

  document.body.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]");
    if (!action) {
      return;
    }
    const type = action.getAttribute("data-action");
    if (type === "dismiss-error") {
      state.errorMessage = "";
      renderAll();
      return;
    }
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
    if (type === "remove-model-library") {
      vscode.postMessage({
        type: "remove-model-library-folder",
        path: action.getAttribute("data-path") || "",
      });
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

  renderAll();
  vscode.postMessage({ type: "ready" });
})();
