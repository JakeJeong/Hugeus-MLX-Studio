"use strict";

const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { TextDecoder } = require("node:util");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const vscode = require("vscode");

const VIEW_ID = "mlxStudio.chatView";
const MODELS_VIEW_ID = "mlxStudio.modelsView";
const PANEL_ID = "mlxStudio.chatPanel";
const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful local assistant. Answer clearly, stay concise, and match the user's language.";
const SERVER_PORT = "8010";
const DEFAULT_GENERATION_SETTINGS = Object.freeze({
  maxTokens: 512,
  temperature: 0.0,
  topP: 0.95,
  minP: 0.0,
  topK: 40,
  repeatPenalty: 1.05,
  repeatContextSize: 64,
  enableThinking: false,
});

let managedServerProcess = null;
let managedServerStopTimer = null;
let serverOutputChannel = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isManagedServerRunning() {
  return Boolean(managedServerProcess && managedServerProcess.exitCode === null && !managedServerProcess.killed);
}

function compactModelLabel(rawLabel, fallbackPath) {
  const label = String(rawLabel || "").trim();
  if (label && !label.startsWith("/") && !label.startsWith("\\")) {
    return label;
  }
  const source = String(fallbackPath || rawLabel || "").trim();
  return source ? path.basename(source) : "Unknown model";
}

function buildModelTooltip(parts) {
  return parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join("\n");
}

function toBoundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return fallback;
  }
  return parsed;
}

function toBoundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return fallback;
  }
  return parsed;
}

class MlxStudioViewProvider {
  constructor(context) {
    this.context = context;
    this.view = null;
    this.serverStatus = null;
    this.sessionId = randomUUID();
    this.systemPrompt = DEFAULT_SYSTEM_PROMPT;
    this.messages = [];
    this.contextItems = [];
    this.targetContextId = null;
    this.targetFolder = null;
    this.localModels = [];
    this.modelSearchResults = [];
    this.modelSearchQuery = "";
    this.modelActivity = null;
    this.modelManagerOpen = false;
    this.isGenerating = false;
    this.activePhase = null;
    this.vibeMode = false;
    this.switchingModelKey = null;
    this.switchingModelLabel = null;
    this.currentRequestMode = "chat";
    this.currentRequestTargetFolder = null;
    this.currentRequestFileSpec = null;
    this.currentRequestLanguage = "en";
    this.pendingConfirmation = null;
    this.pendingConfirmationResolver = null;
    this.workspaceFileSearchIndex = [];
    this.workspaceFileSearchIndexedAt = 0;
    this.editProposals = new Map();
    this.modelsViewProvider = null;
  }

  setModelsViewProvider(provider) {
    this.modelsViewProvider = provider;
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;
    this.configureWebview(webviewView.webview);

    webviewView.onDidDispose(() => {
      this.view = null;
    });
  }

  async revealView() {
    await vscode.commands.executeCommand("workbench.view.extension.mlxStudio");
    await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    this.postState();
  }

  configureWebview(webview) {
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
    };
    webview.html = this.getHtml(webview);

    webview.onDidReceiveMessage((message) => {
      this.handleMessage(message).catch((error) => {
        this.postToWebview({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      });
    });
  }

  async handleMessage(message) {
    switch (message.type) {
      case "ready":
        await this.refreshStatus();
        this.postState();
        return;
      case "send-chat":
        await this.sendChat(String(message.content || ""));
        return;
      case "clear-chat":
        await this.clearChat();
        return;
      case "refresh-status":
        await this.refreshStatus();
        this.postState();
        return;
      case "switch-model":
        await this.switchModel(String(message.key || ""));
        return;
      case "toggle-model-manager":
        await vscode.commands.executeCommand("mlxStudio.openModels");
        return;
      case "search-models":
        await this.searchModels(String(message.query || ""));
        return;
      case "download-model":
        await this.downloadModelFromManager(String(message.modelId || ""), String(message.format || "mlx"));
        return;
      case "delete-local-model":
        await this.deleteLocalModel(String(message.key || ""));
        return;
      case "unload-model":
        await this.unloadCurrentModel();
        return;
      case "cancel-model-download":
        await this.cancelModelDownload();
        return;
      case "start-server":
        await startLocalServer(this.context, this);
        return;
      case "stop-server":
        await stopLocalServer(this);
        return;
      case "add-active-file":
        await this.addActiveFile();
        return;
      case "add-selection":
        await this.addSelection();
        return;
      case "search-files":
        await this.postFileSearchResults(String(message.query || ""), Number(message.requestId || 0));
        return;
      case "attach-file":
        await this.attachFileByUri(String(message.uri || ""));
        return;
      case "remove-context":
        this.removeContext(String(message.id || ""));
        return;
      case "set-target-context":
        this.setTargetContext(String(message.id || ""));
        return;
      case "choose-target-folder":
        await this.chooseTargetFolder();
        return;
      case "clear-target-folder":
        this.clearTargetFolder();
        return;
      case "set-system-prompt":
        this.systemPrompt = String(message.value || "").trim() || DEFAULT_SYSTEM_PROMPT;
        this.postState();
        return;
      case "toggle-vibe-mode":
        this.vibeMode = !this.vibeMode;
        this.postState();
        return;
      case "save-settings":
        await this.saveGenerationSettings(message.payload || {});
        return;
      case "apply-code":
        await this.applyCode(String(message.code || ""), String(message.contextItemId || ""));
        return;
      case "preview-proposal":
        await this.previewEditProposal(String(message.proposalId || ""));
        return;
      case "apply-proposal":
        await this.applyEditProposal(String(message.proposalId || ""));
        return;
      case "reject-proposal":
        this.rejectEditProposal(String(message.proposalId || ""));
        return;
      case "create-file":
        await this.createFileFromCode(String(message.code || ""), String(message.language || ""));
        return;
      case "copy-text":
        await vscode.env.clipboard.writeText(String(message.content || ""));
        return;
      case "confirm-pending-action":
        this.resolvePendingConfirmation(true);
        return;
      case "cancel-pending-action":
        this.resolvePendingConfirmation(false);
        return;
      default:
        return;
    }
  }

  getServerUrl() {
    const configuration = vscode.workspace.getConfiguration("mlxStudio");
    return configuration.get("serverUrl", "http://127.0.0.1:8010").replace(/\/+$/, "");
  }

  getMaxContextChars() {
    const configuration = vscode.workspace.getConfiguration("mlxStudio");
    return Number(configuration.get("maxContextChars", 12000));
  }

  async refreshStatus() {
    try {
      this.serverStatus = await this.fetchJson("/api/status");
      this.serverStatus.available = true;
    } catch (error) {
      this.serverStatus = {
        available: false,
        error: error instanceof Error ? error.message : String(error),
        model_id: "-",
        runtime: "-",
      };
    }
    await this.refreshModelOptions();
  }

  async refreshActivity() {
    try {
      this.modelActivity = await this.fetchJson("/api/activity");
    } catch {
      this.modelActivity = null;
    }
  }

  async refreshModelOptions() {
    try {
      const [mlxPayload, ggufPayload] = await Promise.all([
        this.fetchJson("/api/models/local"),
        this.fetchJson("/api/models/gguf"),
      ]);
      const mlxModels = Array.isArray(mlxPayload.models) ? mlxPayload.models : [];
      const ggufModels = Array.isArray(ggufPayload.models) ? ggufPayload.models : [];
      this.localModels = [
        ...mlxModels
          .filter((model) => model.ready !== false)
          .map((model) => {
            const label = compactModelLabel(
              model.display_name || model.repo_id || model.id,
              model.path || model.id,
            );
            return {
              key: `mlx:${model.id}`,
              id: model.id,
              label,
              runtime: "mlx",
              format: "MLX",
              detail: model.size_gb ? `${Number(model.size_gb).toFixed(2)} GB` : "Local",
              tooltip: buildModelTooltip([
                label,
                model.repo_id || model.id,
                model.path,
              ]),
              path: model.path || model.id,
              selected: Boolean(model.selected),
              loaded: Boolean(model.loaded),
            };
          }),
        ...ggufModels
          .filter((model) => model.ready !== false)
          .map((model) => {
            const label = compactModelLabel(model.id || path.basename(model.path || ""), model.path);
            return {
              key: `gguf:${model.path}`,
              id: model.id,
              modelId: model.path,
              label,
              runtime: "llama_cpp",
              format: "GGUF",
              detail: model.size_gb ? `${Number(model.size_gb).toFixed(2)} GB` : "Local",
              tooltip: buildModelTooltip([
                label,
                model.id,
                model.path,
              ]),
              path: model.path,
              selected: Boolean(model.selected),
              loaded: Boolean(model.loaded),
            };
          }),
      ];
    } catch {
      this.localModels = [];
    }
  }

  async searchModels(query) {
    const trimmed = String(query || "").trim();
    this.modelSearchQuery = trimmed;
    if (!trimmed) {
      this.modelSearchResults = [];
      this.postState();
      return;
    }
    this.activePhase = "Searching models...";
    this.postState();
    try {
      const payload = await this.fetchJson("/api/models/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: trimmed }),
      });
      this.modelSearchResults = Array.isArray(payload.results) ? payload.results : [];
      await this.refreshActivity();
    } finally {
      this.activePhase = null;
      this.postState();
    }
  }

  async uploadTlsCertificate(filename, content) {
    const normalizedFilename = String(filename || "").trim() || "custom-root-ca.pem";
    const normalizedContent = String(content || "");
    if (!normalizedContent.trim()) {
      throw new Error("Certificate file is empty.");
    }

    await this.fetchJson("/api/network/certificate/text", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filename: normalizedFilename,
        content: normalizedContent,
      }),
    });

    await this.refreshStatus();
    if (this.modelSearchQuery) {
      await this.searchModels(this.modelSearchQuery);
      return;
    }
    this.postState();
  }

  async clearTlsCertificate() {
    await this.fetchJson("/api/network/certificate/clear", {
      method: "POST",
    });

    await this.refreshStatus();
    if (this.modelSearchQuery) {
      await this.searchModels(this.modelSearchQuery);
      return;
    }
    this.postState();
  }

  getDefaultModelLibraryUri() {
    const home = os.homedir();
    const candidates = [
      path.join(home, "Library", "Application Support", "LM Studio", "models"),
      path.join(home, ".cache", "lm-studio", "models"),
      path.join(home, ".cache", "lmstudio", "models"),
      path.join(home, ".lmstudio", "models"),
    ];
    const existing = candidates.find((candidate) => {
      try {
        return fs.existsSync(candidate);
      } catch {
        return false;
      }
    });
    return vscode.Uri.file(existing || home);
  }

  async chooseModelLibraryFolder() {
    const selection = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      defaultUri: this.getDefaultModelLibraryUri(),
      openLabel: "Add Model Folder",
    });

    const picked = selection?.[0];
    if (!picked) {
      return;
    }

    await this.addModelLibraryPath(picked.fsPath);
  }

  async addModelLibraryPath(directory) {
    const target = String(directory || "").trim();
    if (!target) {
      return;
    }
    await this.fetchJson("/api/model-libraries/add", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: target }),
    });
    await this.refreshStatus();
    this.postState();
  }

  async removeModelLibraryPath(directory) {
    const target = String(directory || "").trim();
    if (!target) {
      return;
    }
    await this.fetchJson("/api/model-libraries/remove", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: target }),
    });
    await this.refreshStatus();
    this.postState();
  }

  async pickGgufFilename(modelId) {
    const payload = await this.fetchJson(`/api/models/files?model_id=${encodeURIComponent(modelId)}&format=gguf`);
    const files = Array.isArray(payload.files) ? payload.files : [];
    if (files.length === 0) {
      throw new Error("No GGUF files found in this repository.");
    }
    if (files.length === 1) {
      return files[0].name;
    }
    const picked = await vscode.window.showQuickPick(
      files.map((file) => ({
        label: file.name,
        description: file.size_gb ? `${Number(file.size_gb).toFixed(2)} GB` : "",
      })),
      {
        title: "Choose GGUF file to download",
        placeHolder: "Select a GGUF quantization file",
      }
    );
    return picked?.label || null;
  }

  async downloadModelFromManager(modelId, format) {
    if (!modelId) {
      return;
    }
    let filename = null;
    if (format === "gguf") {
      filename = await this.pickGgufFilename(modelId);
      if (!filename) {
        return;
      }
    }
    this.activePhase = "Starting download...";
    await this.refreshActivity();
    this.postState();
    try {
      await this.fetchJson("/api/models/download", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model_id: modelId,
          format,
          filename,
        }),
      });
      await this.monitorDownloadActivity();
      await this.refreshStatus();
      if (this.modelSearchQuery) {
        await this.searchModels(this.modelSearchQuery);
      }
    } finally {
      this.activePhase = null;
      this.postState();
    }
  }

  async monitorDownloadActivity() {
    for (let attempt = 0; attempt < 240; attempt += 1) {
      await this.refreshActivity();
      this.postState();
      if (!this.modelActivity?.active) {
        return;
      }
      await sleep(500);
    }
  }

  async cancelModelDownload() {
    await this.fetchJson("/api/models/download/cancel", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    await this.refreshActivity();
    this.postState();
  }

  async unloadCurrentModel() {
    await this.fetchJson("/api/models/unload", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    await this.refreshStatus();
    this.postState();
  }

  async deleteLocalModel(key) {
    const target = this.localModels.find((item) => item.key === key);
    if (!target) {
      throw new Error("Selected local model was not found.");
    }
    const confirmed = await vscode.window.showWarningMessage(
      `Delete ${target.label}?`,
      { modal: true },
      "Delete"
    );
    if (confirmed !== "Delete") {
      return;
    }
    await this.fetchJson("/api/models/delete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        target.runtime === "llama_cpp"
          ? { model_path: target.path, format: "gguf" }
          : { model_id: target.id, format: "mlx" }
      ),
    });
    await this.refreshStatus();
    if (this.modelSearchQuery) {
      await this.searchModels(this.modelSearchQuery);
    } else {
      this.postState();
    }
  }

  async fetchJson(pathname, init) {
    const response = await fetch(`${this.getServerUrl()}${pathname}`, init);
    if (!response.ok) {
      let detail = `${response.status} ${response.statusText}`;
      try {
        const payload = await response.json();
        if (payload?.detail) {
          detail = payload.detail;
        }
      } catch {
        // Ignore malformed error responses.
      }
      throw new Error(detail);
    }
    return response.json();
  }

  getGenerationSettingsSnapshot(source = this.serverStatus) {
    const payload = source || {};
    return {
      maxTokens: toBoundedInteger(
        payload.maxTokens ?? payload.max_tokens,
        DEFAULT_GENERATION_SETTINGS.maxTokens,
        1,
        4096
      ),
      temperature: toBoundedNumber(
        payload.temperature,
        DEFAULT_GENERATION_SETTINGS.temperature,
        0,
        2
      ),
      topP: toBoundedNumber(payload.topP ?? payload.top_p, DEFAULT_GENERATION_SETTINGS.topP, 0, 1),
      minP: toBoundedNumber(payload.minP ?? payload.min_p, DEFAULT_GENERATION_SETTINGS.minP, 0, 1),
      topK: toBoundedInteger(payload.topK ?? payload.top_k, DEFAULT_GENERATION_SETTINGS.topK, 0, 500),
      repeatPenalty: toBoundedNumber(
        payload.repeatPenalty ?? payload.repeat_penalty,
        DEFAULT_GENERATION_SETTINGS.repeatPenalty,
        0,
        3
      ),
      repeatContextSize: toBoundedInteger(
        payload.repeatContextSize ?? payload.repeat_context_size,
        DEFAULT_GENERATION_SETTINGS.repeatContextSize,
        0,
        4096
      ),
      enableThinking: Boolean(payload.enableThinking ?? payload.enable_thinking),
    };
  }

  normalizeGenerationSettingsPayload(payload) {
    const maxTokens = Number(payload.maxTokens ?? payload.max_tokens);
    const temperature = Number(payload.temperature);
    const topP = Number(payload.topP ?? payload.top_p);
    const minP = Number(payload.minP ?? payload.min_p);
    const topK = Number(payload.topK ?? payload.top_k);
    const repeatPenalty = Number(payload.repeatPenalty ?? payload.repeat_penalty);
    const repeatContextSize = Number(payload.repeatContextSize ?? payload.repeat_context_size);
    const enableThinking = Boolean(payload.enableThinking ?? payload.enable_thinking);

    if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 4096) {
      throw new Error("Max Tokens must be an integer between 1 and 4096.");
    }
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
      throw new Error("Temperature must be between 0.0 and 2.0.");
    }
    if (!Number.isFinite(topP) || topP < 0 || topP > 1) {
      throw new Error("Top P must be between 0.0 and 1.0.");
    }
    if (!Number.isFinite(minP) || minP < 0 || minP > 1) {
      throw new Error("Min P must be between 0.0 and 1.0.");
    }
    if (!Number.isInteger(topK) || topK < 0 || topK > 500) {
      throw new Error("Top K must be an integer between 0 and 500.");
    }
    if (!Number.isFinite(repeatPenalty) || repeatPenalty < 0 || repeatPenalty > 3) {
      throw new Error("Repeat Penalty must be between 0.0 and 3.0.");
    }
    if (!Number.isInteger(repeatContextSize) || repeatContextSize < 0 || repeatContextSize > 4096) {
      throw new Error("Repeat Window must be an integer between 0 and 4096.");
    }

    return {
      maxTokens,
      temperature,
      topP,
      minP,
      topK,
      repeatPenalty,
      repeatContextSize,
      enableThinking,
    };
  }

  async saveGenerationSettings(payload) {
    const settings = this.normalizeGenerationSettingsPayload(payload);
    await this.fetchJson("/api/settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        max_tokens: settings.maxTokens,
        temperature: settings.temperature,
        top_p: settings.topP,
        min_p: settings.minP,
        top_k: settings.topK,
        repeat_penalty: settings.repeatPenalty,
        repeat_context_size: settings.repeatContextSize,
        enable_thinking: settings.enableThinking,
      }),
    });
    await this.refreshStatus();
    this.postState();
    this.postToWebview({ type: "settings-saved" });
  }

  buildRequestMessages() {
    const requestMessages = [];
    const systemParts = [];
    const targetItem = this.getTargetContextItem();
    const targetFolder = this.currentRequestTargetFolder;
    const requestedFileSpec = this.currentRequestFileSpec;
    const isKorean = this.currentRequestLanguage === "ko";
    const languageInstruction =
      isKorean
        ? "사용자에게 보이는 자연어와 문서 본문은 최신 사용자 요청과 같은 언어로 작성하세요. 사용자가 한국어로 요청하면 한국어로 답하세요. 사용자가 다른 언어를 명시하면 그 언어를 따르세요."
        : "Use the same language as the latest user request for any user-visible text and document contents. If the user writes in Korean, respond in Korean unless they explicitly ask for another language.";

    if (this.currentRequestMode === "edit-file") {
        systemParts.push(
          (isKorean
            ? [
                "지금은 vibe coding 모드입니다. 사용자는 코드 또는 문서 수정을 요청합니다.",
                targetItem
                  ? targetItem.kind === "selection"
                    ? `수정 대상: ${targetItem.label}. 선택된 범위만 교체할 수 있도록 그 범위의 전체 대체 내용을 반환하세요.`
                    : `수정 대상: ${targetItem.label}. 이 파일의 전체 수정본을 반환하세요.`
                  : "명시적인 수정 대상이 없으면 제공된 컨텍스트를 가장 적절한 대상으로 사용하세요.",
                "반드시 바로 적용 가능한 단일 fenced code block만 반환하세요.",
                "설명, 머리말, 불릿, 추가 문장은 코드블록 밖에 넣지 마세요.",
                "언어 식별자는 알 수 있으면 정확히 붙이세요.",
                "사용자가 넓은 리팩터링을 요청하지 않는 한, 관련 없는 부분은 유지하세요.",
              ]
            : [
                "You are in vibe coding mode. The user will describe a code change to make.",
                targetItem
                  ? targetItem.kind === "selection"
                    ? `Edit target: ${targetItem.label}. This is a selected range, so return ONLY the replacement code for that selection.`
                    : `Edit target: ${targetItem.label}. Return the COMPLETE updated file contents for this file.`
                  : "If no explicit edit target is attached, use the available code context as the best target.",
                "Respond with ONLY a single fenced code block containing ready-to-apply code.",
                "Do not add any explanation, preamble, bullets, or text outside the code block.",
                "Use the correct language identifier when it is obvious.",
                "Preserve unrelated code and existing style unless the user asks for a broader refactor.",
              ]
          ).join("\n")
        );
    } else if (this.currentRequestMode === "auto") {
      systemParts.push(
        (isKorean
          ? [
              "지금은 자동 액션 모드입니다.",
              targetFolder
                ? `새 파일을 만들 때 사용할 기본 폴더: ${targetFolder.label}.`
                : "새 파일 생성이 필요하면 현재 워크스페이스 내부 경로를 사용하세요.",
              requestedFileSpec?.relativePath
                ? `사용자가 경로를 명시하면 ${requestedFileSpec.relativePath} 를 우선해서 사용하세요.`
                : "사용자가 새 파일을 원하면 적절한 상대 경로를 직접 정할 수 있습니다.",
              requestedFileSpec?.language
                ? `사용자가 요청한 파일 형식은 ${requestedFileSpec.language} 입니다.`
                : "사용자가 파일 형식을 지정했다면 그대로 따르세요.",
              targetItem
                ? targetItem.kind === "selection"
                  ? `편집 타깃: ${targetItem.label}. 사용자가 이 선택 범위를 수정하길 원하면 그 범위를 대체할 전체 코드만 단일 fenced code block으로 반환하세요.`
                  : `편집 타깃: ${targetItem.label}. 사용자가 이 파일 수정을 원하면 전체 수정본만 단일 fenced code block으로 반환하세요.`
                : "편집 타깃이 명시적으로 연결되지 않았다면 일반 답변으로 처리하세요.",
              targetItem
                ? `사용자가 방금 명시적으로 붙인 타깃이 ${targetItem.label} 이라면, 먼저 이 파일/선택 범위를 읽고 그 내용에 근거해서 답하세요.`
                : null,
              "사용자가 새 파일 생성을 원할 때만 아래 형식으로만 응답하세요:",
              "@@path relative/path/from/workspace",
              "```language",
              "<full file contents>",
              "```",
              "사용자가 타깃 수정만 원할 때만 standalone fenced code block 하나로 응답하세요.",
              "그 외에는 일반 답변으로 답하세요.",
            ]
          : [
              "You are in automatic action mode.",
              targetFolder
                ? `Default folder for any new file: ${targetFolder.label}.`
                : "If you create a file, choose a path inside the current workspace.",
              requestedFileSpec?.relativePath
                ? `If the user implied a path, prefer this path: ${requestedFileSpec.relativePath}.`
                : "If the user wants a new file, you may choose a concise relative path.",
              requestedFileSpec?.language
                ? `The requested file type is ${requestedFileSpec.language}.`
                : "Respect any file type the user explicitly requested.",
              targetItem
                ? targetItem.kind === "selection"
                  ? `Edit target: ${targetItem.label}. If the user wants this selection changed, return ONLY a standalone fenced code block containing the full replacement for that selection.`
                  : `Edit target: ${targetItem.label}. If the user wants this file changed, return ONLY a standalone fenced code block containing the complete updated file contents.`
                : "If there is no explicit edit target, treat the request as normal chat unless the user clearly wants a new file.",
              targetItem
                ? `If the user explicitly attached ${targetItem.label}, read that target first and ground your answer in it instead of replying generically.`
                : null,
              "Return this exact structure only when creating a new file:",
              "@@path relative/path/from/workspace",
              "```language",
              "<full file contents>",
              "```",
              "Return a standalone fenced code block only when directly editing the attached target.",
              "Otherwise answer normally.",
            ]
        )
          .filter(Boolean)
          .join("\n")
      );
    }

    systemParts.push(languageInstruction);

    const prompt = this.systemPrompt.trim();
    if (prompt) {
      systemParts.push(prompt);
    }

    if (this.contextItems.length > 0) {
      if ((this.currentRequestMode === "edit-file" || this.currentRequestMode === "auto") && targetItem) {
        const referenceItems = this.contextItems.filter((item) => item.id !== targetItem.id);
        const parts = [
          this.formatContextBlock(
            targetItem,
            targetItem.kind === "selection" ? "Edit Target (Selected Range)" : "Edit Target (Whole File)"
          ),
        ];
        if (referenceItems.length > 0) {
          parts.push(
            "Additional reference context:\n\n" +
              referenceItems.map((item) => this.formatContextBlock(item, "Reference File")).join("\n\n")
          );
        }
        systemParts.push(parts.join("\n\n"));
      } else {
        const fileBlocks = this.contextItems.map((item) => {
          return this.formatContextBlock(item, "File");
        });
        systemParts.push(
          "Use the following workspace context when it is relevant. Cite filenames when useful and stay grounded.\n\n" +
            fileBlocks.join("\n\n")
        );
      }
    }

    if (systemParts.length > 0) {
      requestMessages.push({ role: "system", content: systemParts.join("\n\n") });
    }

    for (const message of this.messages) {
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

  getPreferredEditor() {
    return (
      vscode.window.activeTextEditor ??
      vscode.window.visibleTextEditors.find((editor) => editor.document.uri.scheme !== "output") ??
      vscode.window.visibleTextEditors[0] ??
      null
    );
  }

  invalidateWorkspaceFileSearchIndex() {
    this.workspaceFileSearchIndex = [];
    this.workspaceFileSearchIndexedAt = 0;
  }

  async getWorkspaceFileSearchIndex() {
    const now = Date.now();
    if (this.workspaceFileSearchIndex.length > 0 && now - this.workspaceFileSearchIndexedAt < 1500) {
      return this.workspaceFileSearchIndex;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders || [];
    if (workspaceFolders.length === 0) {
      this.invalidateWorkspaceFileSearchIndex();
      return [];
    }

    const files = await vscode.workspace.findFiles(
      "**/*",
      "**/{node_modules,.git,.next,dist,build,out,coverage,.turbo,.cache}/**",
      4000
    );

    this.workspaceFileSearchIndex = files
      .filter((uri) => uri.scheme === "file")
      .map((uri) => {
        const relativePath = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, "/");
        const basename = path.posix.basename(relativePath);
        const directory = path.posix.dirname(relativePath);
        return {
          uri: uri.toString(),
          relativePath,
          relativePathLower: relativePath.toLowerCase(),
          basename,
          basenameLower: basename.toLowerCase(),
          description: directory === "." ? "" : directory,
        };
      });
    this.workspaceFileSearchIndexedAt = now;
    return this.workspaceFileSearchIndex;
  }

  scoreFileSearchCandidate(candidate, query, attachedUris, activeUri) {
    let score = 0;

    if (!query) {
      if (candidate.uri === activeUri) {
        score += 220;
      }
      if (attachedUris.has(candidate.uri)) {
        score += 140;
      }
      if (!candidate.description) {
        score += 20;
      }
      return score - candidate.relativePath.length * 0.01;
    }

    const basename = candidate.basenameLower;
    const relativePath = candidate.relativePathLower;

    if (basename === query) {
      score += 1100;
    } else if (basename.startsWith(query)) {
      score += 850;
    } else if (basename.includes(query)) {
      score += 620;
    }

    if (relativePath === query) {
      score += 980;
    } else if (relativePath.startsWith(query)) {
      score += 760;
    } else if (relativePath.includes(`/${query}`)) {
      score += 520;
    } else if (relativePath.includes(query)) {
      score += 380;
    }

    if (score === 0) {
      return Number.NEGATIVE_INFINITY;
    }

    if (candidate.uri === activeUri) {
      score += 40;
    }
    if (attachedUris.has(candidate.uri)) {
      score += 35;
    }

    return score - candidate.relativePath.length * 0.01;
  }

  async searchWorkspaceFiles(query, limit = 8) {
    const normalizedQuery = String(query || "").trim().toLowerCase();
    const index = await this.getWorkspaceFileSearchIndex();
    const attachedUris = new Set(this.contextItems.map((item) => item?.uri).filter(Boolean));
    const activeUri = this.getPreferredEditor()?.document?.uri?.toString() || "";

    return index
      .map((candidate) => ({
        ...candidate,
        score: this.scoreFileSearchCandidate(candidate, normalizedQuery, attachedUris, activeUri),
      }))
      .filter((candidate) => Number.isFinite(candidate.score))
      .sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath))
      .slice(0, Math.max(1, limit))
      .map((candidate) => ({
        uri: candidate.uri,
        label: candidate.basename,
        description: candidate.description,
        relativePath: candidate.relativePath,
        attached: attachedUris.has(candidate.uri),
      }));
  }

  async postFileSearchResults(query, requestId = 0) {
    const results = await this.searchWorkspaceFiles(query, 8);
    this.postToWebview({
      type: "file-search-results",
      payload: {
        query: String(query || ""),
        requestId,
        results,
      },
    });
  }

  getWorkspaceFolderForUri(uri) {
    return uri ? vscode.workspace.getWorkspaceFolder(uri) : null;
  }

  describeFolderUri(uri) {
    const workspaceFolder = this.getWorkspaceFolderForUri(uri);
    if (!workspaceFolder || !uri) {
      return null;
    }

    const relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath).replace(/\\/g, "/");
    return {
      uri: uri.toString(),
      label: relativePath || workspaceFolder.name,
      relativePath,
      workspaceFolderUri: workspaceFolder.uri.toString(),
      workspaceFolderName: workspaceFolder.name,
    };
  }

  getFolderUriForDocument(document) {
    if (!document?.uri || document.uri.scheme !== "file") {
      return null;
    }
    return vscode.Uri.file(path.dirname(document.uri.fsPath));
  }

  getDefaultCreationFolder() {
    if (this.targetFolder?.uri) {
      return this.targetFolder;
    }

    const editor = this.getPreferredEditor();
    const editorFolder = editor ? this.describeFolderUri(this.getFolderUriForDocument(editor.document)) : null;
    if (editorFolder) {
      return editorFolder;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return null;
    }

    return this.describeFolderUri(workspaceFolder.uri);
  }

  getTargetContextItem() {
    const target = this.targetContextId
      ? this.contextItems.find((item) => item.id === this.targetContextId)
      : null;

    if (target) {
      return target;
    }

    if (this.contextItems.length === 0) {
      return null;
    }

    this.targetContextId = this.contextItems[0].id;
    return this.contextItems[0];
  }

  setTargetContext(id) {
    if (!id || !this.contextItems.some((item) => item.id === id)) {
      return;
    }
    this.targetContextId = id;
    this.postState();
  }

  async chooseTargetFolder() {
    const defaultFolder =
      (this.targetFolder?.uri && vscode.Uri.parse(this.targetFolder.uri)) ||
      this.getFolderUriForDocument(this.getPreferredEditor()?.document) ||
      vscode.workspace.workspaceFolders?.[0]?.uri;

    const selection = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      defaultUri: defaultFolder,
      openLabel: "Set Target Folder",
    });

    const picked = selection?.[0];
    if (!picked) {
      return;
    }

    const described = this.describeFolderUri(picked);
    if (!described) {
      vscode.window.showWarningMessage("Choose a folder inside the current workspace.");
      return;
    }

    this.targetFolder = described;
    this.postState();
  }

  clearTargetFolder() {
    this.targetFolder = null;
    this.postState();
  }

  async attachFileByUri(uriString) {
    if (!uriString) {
      return;
    }

    try {
      const uri = vscode.Uri.parse(uriString);
      const document = await vscode.workspace.openTextDocument(uri);
      this.upsertContext(this.buildFileContextItem(document), {
        makeTarget: true,
      });
    } catch (error) {
      vscode.window.showWarningMessage(
        `Could not attach file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  resolvePendingConfirmation(approved) {
    const resolver = this.pendingConfirmationResolver;
    this.pendingConfirmationResolver = null;
    this.pendingConfirmation = null;
    this.postState();
    if (resolver) {
      resolver(Boolean(approved));
    }
  }

  normalizeTargetContext() {
    if (this.contextItems.length === 0) {
      this.targetContextId = null;
      return;
    }
    if (!this.targetContextId || !this.contextItems.some((item) => item.id === this.targetContextId)) {
      this.targetContextId = this.contextItems[0].id;
    }
  }

  buildFileContextItem(document, options = {}) {
    const uri = document.uri.toString();
    return {
      id: options.id || `file:${uri}`,
      kind: "file",
      uri,
      label: vscode.workspace.asRelativePath(document.uri, false),
      content: this.truncateText(document.getText()),
      meta: `${document.lineCount} lines`,
      documentVersion: document.version,
    };
  }

  buildSelectionContextItem(document, selection, options = {}) {
    const uri = document.uri.toString();
    const startLine = selection.start.line + 1;
    const endLine = selection.end.line + 1;
    const startCharacter = selection.start.character + 1;
    const endCharacter = selection.end.character + 1;
    const labelSuffix = startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;

    return {
      id: options.id || `selection:${uri}#${startLine}:${startCharacter}-${endLine}:${endCharacter}`,
      kind: "selection",
      uri,
      label: `${vscode.workspace.asRelativePath(document.uri, false)}:${labelSuffix}`,
      content: this.truncateText(document.getText(selection)),
      meta: `Selection ${this.formatSelectionLabel({
        start: { line: selection.start.line, character: selection.start.character },
        end: { line: selection.end.line, character: selection.end.character },
      })}`,
      documentVersion: document.version,
      selection: {
        start: { line: selection.start.line, character: selection.start.character },
        end: { line: selection.end.line, character: selection.end.character },
      },
    };
  }

  formatSelectionLabel(selection) {
    return `L${selection.start.line + 1}:C${selection.start.character + 1} - L${selection.end.line + 1}:C${selection.end.character + 1}`;
  }

  formatContextBlock(item, heading) {
    const parts = [heading, `Path: ${item.label}`];

    if (item.kind === "selection" && item.selection) {
      parts.push(`Range: ${this.formatSelectionLabel(item.selection)}`);
    } else if (item.meta) {
      parts.push(`Info: ${item.meta}`);
    }

    parts.push("```");
    parts.push(item.content);
    parts.push("```");
    return parts.join("\n");
  }

  parseContextLocation(item) {
    if (item?.kind === "file" && item.uri) {
      return {
        kind: "file",
        uri: item.uri,
      };
    }

    if (item?.kind === "selection" && item.uri && item.selection) {
      return {
        kind: "selection",
        uri: item.uri,
        selection: item.selection,
      };
    }

    const rawId = typeof item?.id === "string" ? item.id : "";
    if (!rawId) {
      return null;
    }

    if (rawId.startsWith("file:")) {
      return {
        kind: "file",
        uri: rawId.slice("file:".length),
      };
    }

    const selectionId = rawId.startsWith("selection:") ? rawId.slice("selection:".length) : rawId;
    const hashIndex = selectionId.lastIndexOf("#");

    if (hashIndex >= 0) {
      const uri = selectionId.slice(0, hashIndex);
      const rangeText = selectionId.slice(hashIndex + 1);
      const exactMatch = rangeText.match(/^(\d+):(\d+)-(\d+):(\d+)$/);
      if (exactMatch) {
        return {
          kind: "selection",
          uri,
          selection: {
            start: {
              line: Math.max(Number(exactMatch[1]) - 1, 0),
              character: Math.max(Number(exactMatch[2]) - 1, 0),
            },
            end: {
              line: Math.max(Number(exactMatch[3]) - 1, 0),
              character: Math.max(Number(exactMatch[4]) - 1, 0),
            },
          },
        };
      }

      const lineMatch = rangeText.match(/^(\d+)-(\d+)$/);
      if (lineMatch) {
        return {
          kind: "selection",
          uri,
          selection: {
            start: {
              line: Math.max(Number(lineMatch[1]) - 1, 0),
              character: 0,
            },
            end: {
              line: Math.max(Number(lineMatch[2]) - 1, 0),
              character: Number.MAX_SAFE_INTEGER,
            },
          },
        };
      }
    }

    return {
      kind: "file",
      uri: selectionId,
    };
  }

  clampPosition(document, position) {
    const safeLine = Math.max(0, Math.min(position.line, document.lineCount - 1));
    const lineLength = document.lineAt(safeLine).text.length;
    const safeCharacter = Math.max(0, Math.min(position.character, lineLength));
    return new vscode.Position(safeLine, safeCharacter);
  }

  createRange(document, selection) {
    const start = this.clampPosition(document, selection.start);
    const end = this.clampPosition(document, selection.end);
    if (end.isBefore(start)) {
      return new vscode.Range(start, start);
    }
    return new vscode.Range(start, end);
  }

  createFullDocumentRange(document) {
    const lastLine = Math.max(document.lineCount - 1, 0);
    return new vscode.Range(0, 0, lastLine, document.lineAt(lastLine).text.length);
  }

  async resolveContextDocument(item) {
    const location = this.parseContextLocation(item);
    if (!location?.uri) {
      return null;
    }

    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(location.uri));
    if (location.kind !== "selection" || !location.selection) {
      return {
        document,
        kind: "file",
        range: null,
      };
    }

    const range = this.createRange(document, location.selection);
    return {
      document,
      kind: "selection",
      range,
      selection: {
        start: { line: range.start.line, character: range.start.character },
        end: { line: range.end.line, character: range.end.character },
      },
    };
  }

  async refreshContextItems() {
    if (this.contextItems.length === 0) {
      return;
    }

    const refreshedItems = await Promise.all(
      this.contextItems.map(async (item) => {
        try {
          const resolved = await this.resolveContextDocument(item);
          if (!resolved) {
            return item;
          }

          if (resolved.kind === "selection" && resolved.range) {
            return this.buildSelectionContextItem(
              resolved.document,
              new vscode.Selection(resolved.range.start, resolved.range.end),
              { id: item.id }
            );
          }

          return this.buildFileContextItem(resolved.document, { id: item.id });
        } catch {
          return item;
        }
      })
    );

    this.contextItems = refreshedItems;
    this.normalizeTargetContext();
  }

  async ensureVibeTarget() {
    const existingTarget = this.getTargetContextItem();
    if (existingTarget) {
      return existingTarget;
    }

    const editor = this.getPreferredEditor();
    if (!editor) {
      return null;
    }

    if (!editor.selection.isEmpty) {
      this.upsertContext(this.buildSelectionContextItem(editor.document, editor.selection), {
        makeTarget: true,
        post: false,
      });
    } else {
      this.upsertContext(this.buildFileContextItem(editor.document), {
        makeTarget: true,
        post: false,
      });
    }

    return this.getTargetContextItem();
  }

  looksLikeFileCreationRequest(text) {
    return this.extractRequestedFileSpec(text).canCreate;
  }

  looksLikeEditRequest(text) {
    const value = String(text || "").trim();
    if (!value) {
      return false;
    }

    return (
      /\b(edit|update|modify|change|fix|rewrite|refactor|patch|replace|cleanup|improve|apply)\b/i.test(value) ||
      /(수정|바꿔|변경|고쳐|리팩터링|패치|적용|개선|정리|업데이트)/.test(value)
    );
  }

  extractRequestedFileSpec(text) {
    const value = String(text || "").trim();
    if (!value) {
      return {
        relativePath: null,
        language: null,
        canCreate: false,
      };
    }

    const explicitPathMatch = value.match(
      /(?:^|[\s"'`])([\w./-]+\.(md|txt|js|ts|tsx|jsx|py|json|html|css|yml|yaml|sh|swift))(?=$|[\s"'`])/i
    );
    const createVerb =
      /\b(create|make|new|generate|write|save|scaffold)\b/i.test(value) ||
      /(만들어|생성|작성|저장)/.test(value);
    const fileNoun =
      /\b(file|files|page|component|module|document|doc|readme)\b/i.test(value) ||
      /(파일|문서|페이지|컴포넌트|모듈|리드미)/.test(value);

    let language = null;
    if (explicitPathMatch?.[2]) {
      language = this.languageFromExtension(explicitPathMatch[2]);
    }

    if (!language) {
      const typeMap = [
        { pattern: /\bmarkdown\b|\bmd\b|마크다운|md파일/i, language: "markdown" },
        { pattern: /\btext\b|\btxt\b|텍스트|txt파일/i, language: "text" },
        { pattern: /\bpython\b|\bpy\b|파이썬/i, language: "python" },
        { pattern: /\btsx\b/i, language: "tsx" },
        { pattern: /\btypescript\b|\bts\b|타입스크립트/i, language: "typescript" },
        { pattern: /\bjavascript\b|\bjs\b|자바스크립트/i, language: "javascript" },
        { pattern: /\bjson\b/i, language: "json" },
        { pattern: /\bhtml\b/i, language: "html" },
        { pattern: /\bcss\b/i, language: "css" },
        { pattern: /\byaml\b|\byml\b/i, language: "yaml" },
        { pattern: /\bshell\b|\bbash\b|\bsh\b/i, language: "shell" },
        { pattern: /\bswiftui\b|\bswift\b|스위프트/ui, language: "swift" },
      ];

      for (const candidate of typeMap) {
        if (candidate.pattern.test(value)) {
          language = candidate.language;
          break;
        }
      }
    }

    return {
      relativePath: explicitPathMatch ? explicitPathMatch[1] : null,
      language,
      canCreate: Boolean(explicitPathMatch || (createVerb && (fileNoun || language))),
    };
  }

  languageFromExtension(extension) {
    const normalized = String(extension || "").replace(/^\./, "").toLowerCase();
    const mapping = {
      md: "markdown",
      txt: "text",
      js: "javascript",
      ts: "typescript",
      tsx: "tsx",
      jsx: "jsx",
      py: "python",
      json: "json",
      html: "html",
      css: "css",
      yml: "yaml",
      yaml: "yaml",
      sh: "shell",
      swift: "swift",
    };
    return mapping[normalized] || normalized || null;
  }

  extractGeneratedPathMarker(text) {
    const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const markerMatch = trimmed.match(/^@@(?:path\s+)?(.+)$/i);
      if (markerMatch?.[1]) {
        return markerMatch[1].trim();
      }

      const labeledMatch = trimmed.match(/^path:\s*(.+)$/i);
      if (labeledMatch?.[1]) {
        return labeledMatch[1].trim();
      }
    }

    return null;
  }

  extractGeneratedBareCodePayload(text) {
    const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
    let markerIndex = -1;
    let relativePath = null;

    for (let index = 0; index < lines.length; index += 1) {
      const trimmed = lines[index].trim();
      if (!trimmed) {
        continue;
      }

      const markerMatch = trimmed.match(/^@@(?:path\s+)?(.+)$/i);
      if (markerMatch?.[1]) {
        markerIndex = index;
        relativePath = markerMatch[1].trim();
        break;
      }

      const labeledMatch = trimmed.match(/^path:\s*(.+)$/i);
      if (labeledMatch?.[1]) {
        markerIndex = index;
        relativePath = labeledMatch[1].trim();
        break;
      }
    }

    if (markerIndex < 0 || !relativePath) {
      return null;
    }

    const remainingLines = lines.slice(markerIndex + 1);
    while (remainingLines.length > 0 && !remainingLines[0].trim()) {
      remainingLines.shift();
    }

    if (remainingLines.length === 0) {
      return null;
    }

    let language = "";
    if (/^[a-z][\w+-]*$/i.test(remainingLines[0].trim()) && remainingLines.length > 1) {
      language = remainingLines.shift().trim().toLowerCase();
      while (remainingLines.length > 0 && !remainingLines[0].trim()) {
        remainingLines.shift();
      }
    }

    const code = remainingLines.join("\n").trimEnd();
    if (!code) {
      return null;
    }

    return {
      relativePath,
      language,
      code,
    };
  }

  extractLastCodeBlockInfo(text) {
    const matches = [...String(text || "").matchAll(/```(\w*)\n?([\s\S]*?)```/g)];
    if (matches.length === 0) {
      return null;
    }

    const last = matches[matches.length - 1];
    return {
      language: String(last[1] || "").trim().toLowerCase(),
      code: String(last[2] || "").trimEnd(),
    };
  }

  extractStandaloneCodeBlockInfo(text) {
    const match = String(text || "").trim().match(/^```(\w*)\n?([\s\S]*?)```$/);
    if (!match?.[2]) {
      return null;
    }

    return {
      language: String(match[1] || "").trim().toLowerCase(),
      code: String(match[2] || "").trimEnd(),
    };
  }

  stripProtocolMarkup(text) {
    return String(text || "")
      .replace(/\r\n/g, "\n")
      .replace(/<\|channel\>thought[\s\S]*?(?:<channel\|>|$)\s*/gi, "")
      .replace(/<think>[\s\S]*?(?:<\/think>|$)\s*/gi, "")
      .replace(/<\|think\|>[\s\S]*?(?:<\|\/think\|>|<\/think>|$)\s*/gi, "")
      .replace(/^[ \t]*(?:@@(?:path[ \t]+)?[^\n]+|path:\s*[^\n]+)[ \t]*\n?/gim, "")
      .replace(/^\s*\n/g, "")
      .trim();
  }

  isLooseTextTarget(target) {
    const label = String(target?.label || "").toLowerCase();
    return [".md", ".markdown", ".mdx", ".txt"].some((extension) => label.endsWith(extension));
  }

  extractEditableResponsePayload(assistant, target) {
    const codeBlock = this.extractStandaloneCodeBlockInfo(assistant.content);
    if (codeBlock?.code) {
      return codeBlock.code;
    }
    if (target.kind === "file" && this.isLooseTextTarget(target)) {
      return this.stripProtocolMarkup(assistant.content);
    }
    return "";
  }

  getPreviewStorageUri() {
    return vscode.Uri.joinPath(this.context.globalStorageUri, "diff-previews");
  }

  async createEditProposal(target, content) {
    const resolved = await this.resolveContextDocument(target);
    if (!resolved) {
      return null;
    }

    const proposalId = randomUUID();
    const extension = path.extname(resolved.document.uri.fsPath || target.label || "") || ".txt";
    const previewDir = this.getPreviewStorageUri();
    const previewUri = vscode.Uri.joinPath(previewDir, `${proposalId}${extension}`);
    await vscode.workspace.fs.createDirectory(previewDir);
    await vscode.workspace.fs.writeFile(previewUri, Buffer.from(content, "utf8"));

    return {
      id: proposalId,
      targetContextId: target.id,
      targetLabel: target.label,
      targetDocumentVersion: resolved.document.version,
      originalUri: resolved.document.uri.toString(),
      previewUri: previewUri.toString(),
      content,
      status: "pending",
    };
  }

  async previewEditProposal(proposalId) {
    const proposal = this.editProposals.get(proposalId);
    if (!proposal) {
      return;
    }

    await vscode.commands.executeCommand(
      "vscode.diff",
      vscode.Uri.parse(proposal.originalUri),
      vscode.Uri.parse(proposal.previewUri),
      `Proposed Changes: ${proposal.targetLabel}`,
      { preview: true }
    );
  }

  async applyEditProposal(proposalId) {
    const proposal = this.editProposals.get(proposalId);
    if (!proposal) {
      return;
    }

    const assistant = this.getMessageById(proposal.messageId);
    const target = this.contextItems.find((item) => item.id === proposal.targetContextId) || this.getTargetContextItem();
    if (!assistant || !target) {
      return;
    }

    const resolved = await this.resolveContextDocument(target);
    if (!resolved) {
      vscode.window.showWarningMessage("The selected target is no longer available.");
      return;
    }

    if (
      typeof proposal.targetDocumentVersion === "number" &&
      resolved.document.version !== proposal.targetDocumentVersion
    ) {
      assistant.proposalStatus = "stale";
      assistant.proposalMessage = "File changed after the proposal was generated.";
      this.postState();
      vscode.window.showWarningMessage("The file changed after the proposal was generated. Ask again to refresh the diff.");
      return;
    }

    await this.applyCodeToTarget(proposal.content, target, { showMessage: false });
    const refreshedDocument = await vscode.workspace.openTextDocument(resolved.document.uri);
    const refreshedTarget =
      target.kind === "selection" && target.selection
        ? this.buildSelectionContextItem(
            refreshedDocument,
            new vscode.Selection(
              new vscode.Position(target.selection.start.line, target.selection.start.character),
              new vscode.Position(target.selection.end.line, target.selection.end.character)
            ),
            { id: target.id }
          )
        : this.buildFileContextItem(refreshedDocument, { id: target.id });

    this.upsertContext(refreshedTarget, { makeTarget: true, post: false });
    assistant.proposalStatus = "applied";
    assistant.proposalMessage = `Applied to ${refreshedTarget.label}`;
    proposal.status = "applied";
    this.postState();
    vscode.window.showInformationMessage(`Applied to ${refreshedTarget.label}`);
  }

  rejectEditProposal(proposalId) {
    const proposal = this.editProposals.get(proposalId);
    if (!proposal) {
      return;
    }

    const assistant = this.getMessageById(proposal.messageId);
    if (assistant) {
      assistant.proposalStatus = "rejected";
      assistant.proposalMessage = "Proposal dismissed.";
    }
    proposal.status = "rejected";
    this.postState();
  }

  extractGeneratedFilePayload(text) {
    const relativePath = this.extractGeneratedPathMarker(text);
    const codeBlock = this.extractLastCodeBlockInfo(text);
    if (relativePath && codeBlock?.code) {
      return {
        relativePath,
        language: codeBlock.language,
        code: codeBlock.code,
      };
    }

    return this.extractGeneratedBareCodePayload(text);
  }

  detectRequestLanguage(text) {
    return /[가-힣]/.test(String(text || "")) ? "ko" : "en";
  }

  getMessageById(messageId) {
    return this.messages.find((message) => message.id === messageId) || null;
  }

  isPlaceholderPath(relativePath) {
    const normalized = String(relativePath || "").trim().toLowerCase();
    if (!normalized) {
      return true;
    }

    return (
      normalized === "relative/path/from/workspace" ||
      normalized.includes("relative/path") ||
      normalized.includes("from/workspace") ||
      normalized.startsWith("path/") ||
      normalized.includes("<") ||
      normalized.includes("your-file") ||
      normalized.includes("example/")
    );
  }

  async getMissingDirectoryPaths(targetUri, workspaceRootUri) {
    const relativeParentPath = path.posix.dirname(path.posix.relative(workspaceRootUri.path, targetUri.path));
    if (!relativeParentPath || relativeParentPath === ".") {
      return [];
    }

    const segments = relativeParentPath.split("/").filter(Boolean);
    const missing = [];
    let currentUri = workspaceRootUri;

    for (const segment of segments) {
      currentUri = vscode.Uri.joinPath(currentUri, segment);
      try {
        await vscode.workspace.fs.stat(currentUri);
      } catch {
        missing.push(path.posix.relative(workspaceRootUri.path, currentUri.path));
      }
    }

    return missing;
  }

  async confirmMissingDirectories(targetUri, workspaceRootUri) {
    const missingDirectories = await this.getMissingDirectoryPaths(targetUri, workspaceRootUri);
    if (missingDirectories.length === 0) {
      return true;
    }

    const isKorean = this.currentRequestLanguage === "ko";
    this.pendingConfirmation = {
      type: "create-directories",
      title: isKorean ? "새 폴더를 만들까요?" : "Create new folders?",
      detail: isKorean
        ? "파일을 저장하기 전에 아래 폴더를 먼저 생성해야 합니다."
        : "These folders need to be created before the file can be saved.",
      items: missingDirectories,
      confirmLabel: isKorean ? "만들기" : "Create",
      cancelLabel: isKorean ? "취소" : "Cancel",
    };
    this.postState();

    return new Promise((resolve) => {
      this.pendingConfirmationResolver = resolve;
    });
  }

  async reformatCreateFileResponse(assistant) {
    const targetFolder = this.currentRequestTargetFolder || this.getDefaultCreationFolder();
    const requestedFileSpec = this.currentRequestFileSpec;
    const systemPrompt = (
      this.currentRequestLanguage === "ko"
        ? [
            "VS Code 확장이 파싱할 수 있도록 파일 생성 응답 형식을 다시 맞추는 중입니다.",
            "반드시 아래 형식으로만 응답하세요:",
            "@@path relative/path/from/workspace",
            "```language",
            "<full file contents>",
            "```",
            targetFolder ? `경로는 반드시 ${targetFolder.label} 내부여야 합니다.` : "경로는 현재 워크스페이스 내부여야 합니다.",
            requestedFileSpec?.relativePath
              ? `요청된 경로 ${requestedFileSpec.relativePath} 를 반드시 그대로 사용하세요.`
              : "사용자 요청에 맞는 단일 상대 경로를 정하세요.",
            requestedFileSpec?.language
              ? `요청된 파일 형식은 ${requestedFileSpec.language} 입니다.`
              : "사용자가 명시한 파일 형식이 있다면 그대로 따르세요.",
            "설명이나 추가 문장은 절대 넣지 마세요.",
          ]
        : [
            "You are repairing a file-creation response so a VS Code extension can parse it.",
            "Return ONLY this exact structure:",
            "@@path relative/path/from/workspace",
            "```language",
            "<full file contents>",
            "```",
            targetFolder ? `The path must stay inside ${targetFolder.label}.` : "The path must stay inside the current workspace.",
            requestedFileSpec?.relativePath
              ? `Use this exact requested path: ${requestedFileSpec.relativePath}.`
              : "Choose a single concise relative path that matches the user's request.",
            requestedFileSpec?.language
              ? `Use this requested file type: ${requestedFileSpec.language}.`
              : "Use the file type requested by the user if one was specified.",
            "Do not include explanations or any other text.",
          ]
    ).join("\n");

    const payload = await this.fetchJson("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              `Original user request:\n${assistant.sourcePrompt || ""}`,
              `Original assistant response:\n${assistant.content || ""}`,
              "Reformat the assistant response now.",
            ].join("\n\n"),
          },
        ],
        temperature: 0,
        max_tokens: 1200,
      }),
    });

    return String(payload?.reply || "").trim();
  }

  resolveGeneratedFileUri(relativePath, targetFolder) {
    if (!relativePath || !targetFolder?.workspaceFolderUri) {
      return null;
    }

    const workspaceRoot = vscode.Uri.parse(targetFolder.workspaceFolderUri);
    const normalizedInput = String(relativePath).trim().replace(/^["'`]+|["'`]+$/g, "").replace(/\\/g, "/");
    const baseFolder = String(targetFolder.relativePath || "").replace(/\\/g, "/");

    let candidateRelativePath = normalizedInput.replace(/^\/+/, "");
    if (baseFolder && !(candidateRelativePath === baseFolder || candidateRelativePath.startsWith(`${baseFolder}/`))) {
      candidateRelativePath = path.posix.join(baseFolder, candidateRelativePath);
    }

    const normalizedRelativePath = path.posix.normalize(candidateRelativePath);
    if (
      !normalizedRelativePath ||
      normalizedRelativePath === "." ||
      normalizedRelativePath === ".." ||
      normalizedRelativePath.startsWith("../")
    ) {
      return null;
    }

    const segments = normalizedRelativePath.split("/").filter(Boolean);
    const uri = vscode.Uri.joinPath(workspaceRoot, ...segments);
    const finalRelativePath = path.relative(workspaceRoot.fsPath, uri.fsPath).replace(/\\/g, "/");
    if (finalRelativePath === ".." || finalRelativePath.startsWith("../")) {
      return null;
    }

    return {
      uri,
      relativePath: finalRelativePath,
    };
  }

  async writeFileAtUri(targetUri, code) {
    const parentPath = path.posix.dirname(targetUri.path);
    if (parentPath && parentPath !== ".") {
      await vscode.workspace.fs.createDirectory(targetUri.with({ path: parentPath }));
    }
    await vscode.workspace.fs.writeFile(targetUri, Buffer.from(code, "utf8"));
    this.invalidateWorkspaceFileSearchIndex();
  }

  async maybeAutoCreateFile(assistant) {
    if (!assistant || assistant.role !== "assistant" || assistant.requestMode === "edit-file") {
      return false;
    }

    const targetFolder = this.currentRequestTargetFolder || this.getDefaultCreationFolder();
    if (!targetFolder) {
      return false;
    }

    const hasPathMarker = Boolean(this.extractGeneratedPathMarker(assistant.content));
    let generated = this.extractGeneratedFilePayload(assistant.content);
    if (!generated) {
      if (!hasPathMarker) {
        return false;
      }
      try {
        const repaired = await this.reformatCreateFileResponse(assistant);
        if (repaired) {
          assistant.content = repaired;
          generated = this.extractGeneratedFilePayload(repaired);
        }
      } catch {
        assistant.autoCreateSkipped = true;
        assistant.autoCreateReason = "Could not reformat the model output for file creation.";
        return false;
      }
    }
    if (!generated) {
      assistant.autoCreateSkipped = true;
      assistant.autoCreateReason = "Model did not return the required file format.";
      return false;
    }

    if (this.currentRequestFileSpec?.relativePath) {
      generated.relativePath = this.currentRequestFileSpec.relativePath;
    }
    if (!generated.language && this.currentRequestFileSpec?.language) {
      generated.language = this.currentRequestFileSpec.language;
    }
    if (!this.currentRequestFileSpec?.relativePath && this.isPlaceholderPath(generated.relativePath)) {
      assistant.autoCreateSkipped = true;
      assistant.autoCreateReason =
        this.currentRequestLanguage === "ko"
          ? "모델이 예시용 경로를 반환해서 자동 생성을 중단했습니다."
          : "Automatic creation stopped because the model returned a placeholder path.";
      return false;
    }

    const resolved = this.resolveGeneratedFileUri(generated.relativePath, targetFolder);
    if (!resolved) {
      vscode.window.showWarningMessage(
        this.currentRequestLanguage === "ko"
          ? "생성된 경로가 올바르지 않거나 선택한 폴더 밖입니다."
          : "The generated file path is invalid or outside the selected folder."
      );
      assistant.autoCreateSkipped = true;
      assistant.autoCreateReason =
        this.currentRequestLanguage === "ko"
          ? "생성된 경로가 올바르지 않거나 선택한 폴더 밖입니다."
          : "Generated path was invalid or outside the selected folder.";
      return false;
    }

    const workspaceRootUri = vscode.Uri.parse(targetFolder.workspaceFolderUri);
    const approved = await this.confirmMissingDirectories(resolved.uri, workspaceRootUri);
    if (!approved) {
      assistant.autoCreateSkipped = true;
      assistant.autoCreateReason =
        this.currentRequestLanguage === "ko"
          ? "새 폴더 생성이 취소되었습니다."
          : "Folder creation was cancelled.";
      return false;
    }

    await this.writeFileAtUri(resolved.uri, generated.code);
    const document = await vscode.workspace.openTextDocument(resolved.uri);
    const createdItem = this.buildFileContextItem(document, { id: `file:${document.uri.toString()}` });
    this.upsertContext(createdItem, { makeTarget: true, post: false });
    assistant.targetContextId = createdItem.id;
    assistant.targetLabel = createdItem.label;
    assistant.autoCreated = true;
    assistant.autoCreateSkipped = false;
    assistant.autoCreateReason = null;
    assistant.autoCreatedPath = resolved.relativePath;
    await vscode.window.showTextDocument(document, { preview: false, preserveFocus: true });
    vscode.window.showInformationMessage(`Created ${resolved.relativePath}`);
    return true;
  }

  async applyCodeToTarget(code, target, options = {}) {
    const { showMessage = true } = options;
    if (!target) {
      throw new Error("No target found.");
    }

    const resolved = await this.resolveContextDocument(target);
    if (!resolved) {
      throw new Error("The selected target is no longer available.");
    }

    const uri = resolved.document.uri;
    const document = resolved.document;
    const range = resolved.range || this.createFullDocumentRange(document);

    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, range, code);
    await vscode.workspace.applyEdit(edit);
    await vscode.window.showTextDocument(document, { preserveFocus: true });

    if (showMessage) {
      vscode.window.showInformationMessage(`Applied to ${target.label}`);
    }

    return document;
  }

  async maybeAutoApplyEdit(assistant) {
    if (!assistant || assistant.role !== "assistant" || !["edit-file", "auto"].includes(assistant.requestMode)) {
      return false;
    }

    const target = assistant.targetContextId
      ? this.contextItems.find((item) => item.id === assistant.targetContextId)
      : this.getTargetContextItem();

    if (!target) {
      return false;
    }

    const nextContent = this.extractEditableResponsePayload(assistant, target);
    if (!nextContent) {
      return false;
    }

    const resolved = await this.resolveContextDocument(target);
    if (!resolved) {
      return false;
    }

    if (
      typeof assistant.targetDocumentVersion === "number" &&
      resolved.document.version !== assistant.targetDocumentVersion
    ) {
      assistant.autoApplySkipped = true;
      assistant.autoApplyReason = "File changed during generation.";
      return false;
    }

    const proposal = await this.createEditProposal(target, nextContent);
    if (!proposal) {
      return false;
    }

    proposal.messageId = assistant.id;
    this.editProposals.set(proposal.id, proposal);
    assistant.proposalId = proposal.id;
    assistant.proposalStatus = "pending";
    assistant.proposalMessage = `Diff ready for ${target.label}`;
    assistant.targetLabel = target.label;
    await this.previewEditProposal(proposal.id);
    return true;
  }

  async sendChat(content) {
    const userText = content.trim();
    if (!userText || this.isGenerating) {
      return;
    }

    this.currentRequestLanguage = this.detectRequestLanguage(userText);
    this.currentRequestFileSpec = this.extractRequestedFileSpec(userText);
    if (this.vibeMode) {
      await this.ensureVibeTarget();
    }
    await this.refreshContextItems();
    const targetItem = this.getTargetContextItem();
    const shouldUseEditMode =
      this.vibeMode ||
      (Boolean(targetItem) && this.looksLikeEditRequest(userText) && !this.looksLikeFileCreationRequest(userText));
    this.currentRequestTargetFolder = this.getDefaultCreationFolder();
    const requestTargetItem = targetItem;
    this.currentRequestMode = shouldUseEditMode ? "edit-file" : "auto";

    this.messages.push({ id: randomUUID(), role: "user", content: userText });
    this.messages.push({
      id: randomUUID(),
      role: "assistant",
      content: "",
      targetContextId: requestTargetItem ? requestTargetItem.id : null,
      targetLabel: requestTargetItem ? requestTargetItem.label : "",
      targetDocumentVersion: requestTargetItem?.documentVersion ?? null,
      targetFolderLabel: this.currentRequestTargetFolder ? this.currentRequestTargetFolder.label : "",
      sourcePrompt: userText,
      requestMode: this.currentRequestMode,
      vibeMode: this.vibeMode,
      metrics: null,
      phase: {
        phase: "prefill",
        label: "Thinking...",
        badge: "Thinking",
      },
    });
    this.isGenerating = true;
    this.activePhase = "Thinking...";
    this.postState();

    const generationSettings = this.getGenerationSettingsSnapshot();
    const requestBody = {
      messages: this.buildRequestMessages(),
      session_id: this.sessionId,
      max_tokens: generationSettings.maxTokens,
      temperature: generationSettings.temperature,
      top_p: generationSettings.topP,
      min_p: generationSettings.minP,
      top_k: generationSettings.topK,
      repeat_penalty: generationSettings.repeatPenalty,
      repeat_context_size: generationSettings.repeatContextSize,
      enable_thinking: generationSettings.enableThinking,
    };

    try {
      const response = await fetch(`${this.getServerUrl()}/api/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok || !response.body) {
        let detail = "Streaming request failed";
        try {
          const payload = await response.json();
          if (payload?.detail) {
            detail = payload.detail;
          }
        } catch {
          // Ignore invalid JSON error payloads.
        }
        throw new Error(detail);
      }

      const decoder = new TextDecoder();
      const reader = response.body.getReader();
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
          const assistant = this.messages[this.messages.length - 1];
          if (!assistant || assistant.role !== "assistant") {
            continue;
          }

          if (payload.type === "status") {
            assistant.phase = payload;
            this.activePhase = payload.label || payload.phase || "Thinking...";
            this.postState();
            continue;
          }

          if (payload.type === "delta") {
            assistant.content += payload.text;
            if (assistant.content.includes("<think>") && !assistant.content.includes("</think>")) {
              assistant.phase = {
                phase: "reasoning",
                label: "Reasoning...",
                badge: "Thinking",
              };
              this.activePhase = "Reasoning...";
            } else {
              assistant.phase = {
                phase: "responding",
                label: "Responding...",
                badge: "Responding",
              };
              this.activePhase = "Responding...";
            }
            this.postState();
            continue;
          }

          if (payload.type === "done") {
            assistant.metrics = payload.metrics || null;
            assistant.phase = null;
            this.activePhase = null;
            this.isGenerating = false;
            if (payload.model_id) {
              this.serverStatus = {
                ...(this.serverStatus || {}),
                available: true,
                model_id: payload.model_id,
              };
            }
            if (assistant.requestMode === "edit-file") {
              await this.maybeAutoApplyEdit(assistant);
            } else if (assistant.requestMode === "auto") {
              const created = await this.maybeAutoCreateFile(assistant);
              if (!created) {
                await this.maybeAutoApplyEdit(assistant);
              }
            }
            this.postState();
            continue;
          }

          if (payload.type === "error") {
            throw new Error(payload.message || "Streaming request failed");
          }
        }
      }
    } catch (error) {
      const assistant = this.messages[this.messages.length - 1];
      if (assistant && assistant.role === "assistant") {
        assistant.content = `Error: ${error instanceof Error ? error.message : String(error)}`;
        assistant.phase = null;
      }
      this.activePhase = null;
      this.isGenerating = false;
      await this.refreshStatus();
      this.postState();
    }
  }

  async clearChat() {
    this.messages = [];
    this.activePhase = null;
    this.sessionId = randomUUID();
    try {
      await this.fetchJson("/api/session/reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ session_id: this.sessionId }),
      });
    } catch {
      // Ignore reset failures; a new session id is enough for the extension.
    }
    this.postState();
  }

  async switchModel(key) {
    const target = this.localModels.find((item) => item.key === key);
    if (!target) {
      throw new Error("Selected model is no longer available locally.");
    }

    this.switchingModelKey = target.key;
    this.switchingModelLabel = target.label;
    this.activePhase = "Switching model...";
    this.serverStatus = {
      ...(this.serverStatus || {}),
      available: true,
      runtime: target.runtime,
      model_id: target.runtime === "llama_cpp" ? (target.modelId || target.path || target.id) : target.id,
      loaded: false,
    };
    this.localModels = this.localModels.map((item) => ({
      ...item,
      selected: item.key === target.key,
      loaded: false,
    }));
    this.postState();
    try {
      await this.fetchJson("/api/runtime", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          runtime: target.runtime,
          model_id: target.runtime === "llama_cpp" ? (target.modelId || target.path || target.id) : target.id,
        }),
      });

      await this.fetchJson("/api/models/select", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model_id: target.runtime === "llama_cpp" ? (target.modelId || target.path || target.id) : target.id,
        }),
      });

      await this.waitForModelActivation(target);
    } finally {
      this.switchingModelKey = null;
      this.switchingModelLabel = null;
      this.activePhase = null;
      this.postState();
    }
  }

  async waitForModelActivation(target) {
    const expectedModelId = target.runtime === "llama_cpp" ? (target.modelId || target.path || target.id) : target.id;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await this.refreshStatus();
      const matches =
        this.serverStatus?.available === true &&
        this.serverStatus.runtime === target.runtime &&
        this.serverStatus.model_id === expectedModelId &&
        this.serverStatus.loaded === true;
      this.postState();
      if (matches) {
        return;
      }
      await sleep(350);
    }
    await this.refreshStatus();
  }

  async addActiveFile() {
    const editor = this.getPreferredEditor();
    if (!editor) {
      vscode.window.showInformationMessage("No active editor to attach.");
      return;
    }
    this.upsertContext(this.buildFileContextItem(editor.document), { makeTarget: true });
  }

  async addSelection() {
    const editor = this.getPreferredEditor();
    if (!editor) {
      vscode.window.showInformationMessage("No active editor to attach a selection from.");
      return;
    }
    const selection = editor.selection;
    if (selection.isEmpty) {
      vscode.window.showInformationMessage("Select some text first, then try again.");
      return;
    }
    this.upsertContext(this.buildSelectionContextItem(editor.document, selection), { makeTarget: true });
  }

  truncateText(text) {
    const limit = this.getMaxContextChars();
    if (text.length <= limit) {
      return text;
    }
    return `${text.slice(0, limit)}\n\n...[truncated for extension context]`;
  }

  upsertContext(item, options = {}) {
    const { makeTarget = false, post = true } = options;
    const existingIndex = this.contextItems.findIndex((entry) => entry.id === item.id);
    if (existingIndex >= 0) {
      this.contextItems[existingIndex] = item;
    } else {
      this.contextItems.unshift(item);
    }
    if (makeTarget || !this.targetContextId || !this.contextItems.some((entry) => entry.id === this.targetContextId)) {
      this.targetContextId = item.id;
    }
    if (post) {
      this.postState();
    }
  }

  removeContext(id) {
    this.contextItems = this.contextItems.filter((item) => item.id !== id);
    this.normalizeTargetContext();
    this.postState();
  }

  postState() {
    this.postToWebview({
      type: "state",
      payload: {
        serverStatus: this.serverStatus,
        localModels: this.localModels,
        modelSearchResults: this.modelSearchResults,
        modelSearchQuery: this.modelSearchQuery,
        modelActivity: this.modelActivity,
        modelManagerOpen: this.modelManagerOpen,
        managedServerRunning: isManagedServerRunning(),
        messages: this.messages,
        contextItems: this.contextItems,
        targetContextId: this.targetContextId,
        targetFolder: this.targetFolder,
        pendingConfirmation: this.pendingConfirmation,
        isGenerating: this.isGenerating,
        activePhase: this.activePhase,
        switchingModelKey: this.switchingModelKey,
        switchingModelLabel: this.switchingModelLabel,
        systemPrompt: this.systemPrompt,
        vibeMode: this.vibeMode,
        generationSettings: this.getGenerationSettingsSnapshot(),
      },
    });
    this.modelsViewProvider?.postState();
  }

  async applyCode(code, contextItemId) {
    if (!code.trim()) {
      vscode.window.showWarningMessage("No code to apply.");
      return;
    }

    const target = contextItemId
      ? this.contextItems.find((item) => item.id === contextItemId)
      : this.getTargetContextItem();

    try {
      if (target) {
        await this.applyCodeToTarget(code, target, { showMessage: true });
        return;
      }

      // No context item — fall back to last active editor, then any visible editor.
      // Note: activeTextEditor is null when the webview panel has focus, so we
      // also check visibleTextEditors as a fallback.
      const editor =
        this.getPreferredEditor() ??
        vscode.window.visibleTextEditors.find((e) => e.viewColumn === vscode.ViewColumn.One) ??
        vscode.window.visibleTextEditors[0];

      if (!editor) {
        vscode.window.showWarningMessage(
          "No target found. Open the file you want to edit, use + File, or attach one with @ Files."
        );
        return;
      }

      const edit = new vscode.WorkspaceEdit();
      if (!editor.selection.isEmpty) {
        edit.replace(editor.document.uri, editor.selection, code);
      } else {
        const fullRange = this.createFullDocumentRange(editor.document);
        edit.replace(editor.document.uri, fullRange, code);
      }
      await vscode.workspace.applyEdit(edit);
      vscode.window.showInformationMessage("Applied to active editor.");
    } catch (error) {
      vscode.window.showErrorMessage(
        `Apply failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  guessDefaultFilename(language) {
    const normalized = String(language || "").trim().toLowerCase();
    const extensionByLanguage = {
      markdown: "md",
      md: "md",
      javascript: "js",
      js: "js",
      typescript: "ts",
      ts: "ts",
      tsx: "tsx",
      jsx: "jsx",
      python: "py",
      py: "py",
      html: "html",
      css: "css",
      scss: "scss",
      json: "json",
      yaml: "yml",
      yml: "yml",
      shell: "sh",
      bash: "sh",
      zsh: "sh",
      swift: "swift",
      text: "txt",
    };
    const extension = extensionByLanguage[normalized] || "txt";
    return `untitled.${extension}`;
  }

  async createFileFromCode(code, language) {
    if (!code.trim()) {
      vscode.window.showWarningMessage("No code to save.");
      return;
    }

    try {
      const creationFolder = this.getDefaultCreationFolder();
      const defaultUri = creationFolder
        ? vscode.Uri.joinPath(vscode.Uri.parse(creationFolder.uri), this.guessDefaultFilename(language))
        : undefined;

      const targetUri = await vscode.window.showSaveDialog({
        saveLabel: "Create File",
        defaultUri,
      });

      if (!targetUri) {
        return;
      }

      await this.writeFileAtUri(targetUri, code);
      const document = await vscode.workspace.openTextDocument(targetUri);
      this.upsertContext(this.buildFileContextItem(document), { makeTarget: true, post: false });
      await vscode.window.showTextDocument(document, { preview: false, preserveFocus: true });
      vscode.window.showInformationMessage(`Created ${vscode.workspace.asRelativePath(targetUri, false)}`);
      this.postState();
    } catch (error) {
      vscode.window.showErrorMessage(
        `Create file failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  postToWebview(message) {
    if (this.view) {
      this.view.webview.postMessage(message);
    }
  }

  getHtml(webview) {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "main.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "main.css"));
    const nonce = String(Date.now());

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="${styleUri}">
    <title>MLX Studio</title>
  </head>
  <body>
    <div class="app">

      <!-- Compact top bar -->
      <div class="topbar">
        <div class="topbar-brand">
          <span class="status-dot" id="status-dot"></span>
          <span class="brand-name">MLX Studio</span>
        </div>
        <div class="topbar-model">
          <div class="model-picker" id="model-picker">
            <button id="model-picker-button" type="button" class="picker-btn" title="Switch model">
              <span id="model-picker-label">Select model</span>
              <span class="picker-chevron">⌄</span>
            </button>
            <div id="model-picker-menu" class="picker-menu" hidden></div>
          </div>
          <span class="runtime-badge" id="runtime-badge" style="display:none">—</span>
        </div>
      <div class="topbar-actions">
        <div class="settings-anchor">
          <button id="toggle-settings" class="settings-btn" type="button" title="Generation settings">
            <span class="settings-btn-icon">⚙</span>
            <span id="settings-button-label">512 tok</span>
          </button>
          <div id="settings-panel" class="settings-panel" hidden>
            <div class="settings-panel-header">
              <div>
                <div class="settings-panel-title">Generation</div>
                <div class="settings-panel-subtitle">Applies to future messages.</div>
              </div>
              <div id="settings-panel-status" class="settings-panel-status">Saved</div>
            </div>
            <div class="settings-grid">
              <label class="settings-field">
                <span>Max Tokens</span>
                <input id="settings-max-tokens" type="number" min="1" max="4096" step="1" value="512">
              </label>
              <label class="settings-field">
                <span>Temperature</span>
                <input id="settings-temperature" type="number" min="0" max="2" step="0.05" value="0">
              </label>
              <label class="settings-field">
                <span>Top P</span>
                <input id="settings-top-p" type="number" min="0" max="1" step="0.01" value="0.95">
              </label>
              <label class="settings-field">
                <span>Min P</span>
                <input id="settings-min-p" type="number" min="0" max="1" step="0.01" value="0">
              </label>
              <label class="settings-field">
                <span>Top K</span>
                <input id="settings-top-k" type="number" min="0" max="500" step="1" value="40">
              </label>
              <label class="settings-field">
                <span>Repeat Penalty</span>
                <input id="settings-repeat-penalty" type="number" min="0" max="3" step="0.01" value="1.05">
              </label>
              <label class="settings-field">
                <span>Repeat Window</span>
                <input id="settings-repeat-context-size" type="number" min="0" max="4096" step="1" value="64">
              </label>
            </div>
            <label class="settings-toggle-row" for="settings-enable-thinking">
              <span>Enable Thinking</span>
              <input id="settings-enable-thinking" type="checkbox">
            </label>
            <div id="settings-panel-note" class="settings-panel-note">
              Longer answers usually need a higher max token limit.
            </div>
            <div class="settings-panel-actions">
              <button id="reset-settings" class="settings-secondary-btn" type="button">Discard</button>
              <button id="save-settings" class="settings-primary-btn" type="button">Save</button>
            </div>
          </div>
        </div>
        <button id="toggle-model-manager" class="icon-btn" type="button" title="Manage models">◫</button>
        <button id="refresh-status" class="icon-btn" type="button" title="Refresh status">↻</button>
        <button id="server-toggle" class="icon-btn" type="button" title="Start server">▶</button>
        </div>
      </div>

      <!-- Thin status strip -->
      <div class="status-strip">
        <span class="status-text" id="status-text">Checking server…</span>
        <span class="status-progress" id="status-progress" hidden>
          <span class="status-progress-bar" id="status-progress-bar"></span>
        </span>
        <span class="status-phase" id="status-phase">Idle</span>
      </div>

      <!-- Messages -->
      <div class="messages-area">
        <div id="messages" class="messages"></div>
      </div>

      <!-- Composer card -->
      <div class="composer-card">
        <!-- Context chips (hidden when empty via CSS :empty) -->
        <div id="context-chips" class="context-chips-row"></div>
        <div id="target-focus" class="target-focus-row" hidden></div>

        <div id="pending-confirmation" class="pending-confirmation" hidden></div>

        <!-- Input + toolbar -->
        <div class="input-wrapper">
          <form id="composer-form">
            <textarea
              id="user-input"
              rows="3"
              placeholder="Message MLX Studio…"
              autocomplete="off"
              spellcheck="false"
            ></textarea>
            <div id="mention-picker" class="mention-picker" hidden></div>
            <div class="composer-toolbar">
              <div class="toolbar-left">
                <button id="add-active-file" type="button" class="tool-btn" title="Attach active file">+ File</button>
                <button id="mention-files" type="button" class="tool-btn" title="Search and attach files with @">@ Files</button>
                <button id="choose-target-folder" type="button" class="tool-btn" title="Choose folder for new files">+ Folder</button>
              </div>
              <div class="toolbar-right">
                <button id="vibe-toggle" type="button" class="tool-btn vibe-toggle-btn" title="Toggle edit mode — AI focuses on changing the selected target">Edit</button>
                <button id="clear-chat" type="button" class="tool-btn">Clear</button>
                <button id="send-btn" type="submit" class="send-btn" title="Send (Enter)">↑</button>
              </div>
            </div>
          </form>
        </div>
      </div>

    </div>

    <!-- Hidden system prompt (managed by JS) -->
    <textarea id="system-prompt" class="sr-only">${escapeHtml(DEFAULT_SYSTEM_PROMPT)}</textarea>

    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}

class MlxStudioModelsViewProvider {
  constructor(context, host) {
    this.context = context;
    this.host = host;
    this.view = null;
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;
    this.configureWebview(webviewView.webview);
    webviewView.onDidDispose(() => {
      this.view = null;
    });
  }

  async revealView() {
    await vscode.commands.executeCommand("workbench.view.extension.mlxStudioManager");
    await vscode.commands.executeCommand(`${MODELS_VIEW_ID}.focus`);
    await this.host.refreshActivity();
    this.postState();
  }

  configureWebview(webview) {
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
    };
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "models-main.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "models.css"));
    const nonce = String(Date.now());
    webview.html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="${styleUri}">
    <title>MLX Models</title>
  </head>
  <body>
    <div class="models-app">
      <div class="models-shell">
        <div class="models-header">
          <div class="models-title">MLX Studio</div>
          <div class="models-subtitle">Manage local models</div>
        </div>

        <div id="model-activity" class="model-activity" hidden></div>
        <div id="models-error-banner" class="models-banner error" hidden></div>

        <div class="models-tabs">
          <button id="tab-installed" type="button" class="models-tab active">Installed</button>
          <button id="tab-search" type="button" class="models-tab">Search</button>
        </div>
      </div>

      <div class="models-content">
        <div id="installed-panel" class="models-panel">
          <div class="models-section">
            <div class="section-title">Installed</div>
            <div class="models-row">
              <button id="unload-model-button" type="button" class="manager-btn">Unload Current</button>
              <button id="open-chat-button" type="button" class="manager-btn">Open Chat</button>
            </div>
            <div id="local-models-list" class="model-list"></div>
          </div>
          <div class="models-section">
            <div class="section-title">Model Libraries</div>
            <div class="section-note">Default LM Studio folders are auto-scanned. Add a folder here when your GGUF library lives on another disk or custom path.</div>
            <div class="models-row">
              <button id="add-model-library-button" type="button" class="manager-btn">Add Folder</button>
            </div>
            <div id="model-library-list" class="model-list"></div>
          </div>
        </div>

        <div id="search-panel" class="models-panel" hidden>
          <div class="models-section">
            <div class="section-title">Network Trust</div>
            <div id="tls-cert-status" class="cert-status-card">
              <div id="tls-cert-title" class="cert-status-title">Using default CA bundle</div>
              <div id="tls-cert-detail" class="cert-status-detail">Import a company PEM only if your network intercepts HTTPS.</div>
              <div id="tls-cert-meta" class="cert-status-meta"></div>
            </div>
            <div class="cert-status-note">Default public CA trust stays active. A custom PEM is only merged in when you import one.</div>
            <input
              id="tls-cert-input"
              type="file"
              accept=".pem,.crt,.cer,.bundle,text/plain,application/x-pem-file"
              hidden
            />
            <div id="tls-cert-dropzone" class="cert-dropzone" tabindex="0" role="button" aria-label="Import TLS certificate bundle">
              Drop a PEM bundle here or choose a file
            </div>
            <div class="models-row">
              <button id="tls-cert-choose-button" type="button" class="manager-btn">Choose PEM</button>
              <button id="tls-cert-clear-button" type="button" class="manager-btn subtle">Clear</button>
            </div>
          </div>

          <div class="models-section">
            <form id="model-search-form" class="models-row">
              <input id="model-search-input" class="model-search-input" type="text" placeholder="Search MLX or GGUF models..." />
              <button id="model-search-button" type="submit" class="manager-btn primary">Search</button>
            </form>
            <div class="section-title">Search Results</div>
            <div id="model-search-results" class="model-list"></div>
          </div>
        </div>
      </div>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;

    webview.onDidReceiveMessage((message) => {
      this.handleMessage(message).catch((error) => {
        this.postToWebview({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      });
    });
  }

  async handleMessage(message) {
    switch (message.type) {
      case "ready":
        await this.host.refreshStatus();
        await this.host.refreshActivity();
        this.postState();
        return;
      case "search-models":
        await this.host.searchModels(String(message.query || ""));
        return;
      case "download-model":
        await this.host.downloadModelFromManager(String(message.modelId || ""), String(message.format || "mlx"));
        return;
      case "delete-local-model":
        await this.host.deleteLocalModel(String(message.key || ""));
        return;
      case "switch-model":
        await this.host.switchModel(String(message.key || ""));
        return;
      case "unload-model":
        await this.host.unloadCurrentModel();
        return;
      case "cancel-model-download":
        await this.host.cancelModelDownload();
        return;
      case "upload-tls-certificate":
        await this.host.uploadTlsCertificate(String(message.filename || ""), String(message.content || ""));
        return;
      case "clear-tls-certificate":
        await this.host.clearTlsCertificate();
        return;
      case "choose-model-library-folder":
        await this.host.chooseModelLibraryFolder();
        return;
      case "remove-model-library-folder":
        await this.host.removeModelLibraryPath(String(message.path || ""));
        return;
      case "open-chat":
        await vscode.commands.executeCommand("mlxStudio.openChat");
        return;
      default:
        return;
    }
  }

  postToWebview(message) {
    if (this.view) {
      this.view.webview.postMessage(message);
    }
  }

  postState() {
    this.postToWebview({
      type: "state",
      payload: {
        localModels: this.host.localModels,
        modelSearchResults: this.host.modelSearchResults,
        modelSearchQuery: this.host.modelSearchQuery,
        modelActivity: this.host.modelActivity,
        serverStatus: this.host.serverStatus,
        network: this.host.serverStatus?.network || null,
        libraries: this.host.serverStatus?.libraries || null,
        switchingModelKey: this.host.switchingModelKey,
        switchingModelLabel: this.host.switchingModelLabel,
      },
    });
  }
}

async function startLocalServer(context) {
  const provider = arguments[1];
  const projectRoot = path.dirname(context.extensionUri.fsPath);

  if (isManagedServerRunning()) {
    ensureServerOutputChannel().show(true);
    return;
  }

  const output = ensureServerOutputChannel();
  output.show(true);
  output.appendLine(`[MLX Studio] Starting local server on http://127.0.0.1:${SERVER_PORT}`);

  const pythonPath = path.join(projectRoot, ".venv", "bin", "python");
  managedServerProcess = spawn(
    pythonPath,
    ["-m", "uvicorn", "backend.server:app", "--host", "127.0.0.1", "--port", SERVER_PORT],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        PYTHONPATH: projectRoot,
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  managedServerProcess.stdout?.on("data", (chunk) => {
    output.append(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  });
  managedServerProcess.stderr?.on("data", (chunk) => {
    output.append(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  });
  managedServerProcess.on("error", (error) => {
    output.appendLine(`[MLX Studio] Server failed to start: ${error.message}`);
  });
  managedServerProcess.on("exit", (code, signal) => {
    if (managedServerStopTimer) {
      clearTimeout(managedServerStopTimer);
      managedServerStopTimer = null;
    }
    output.appendLine(`[MLX Studio] Server stopped (${signal || code || 0}).`);
    managedServerProcess = null;
    if (provider) {
      provider.refreshStatus().then(() => provider.postState()).catch(() => {});
    }
  });

  if (provider) {
    provider.refreshStatus().then(() => provider.postState()).catch(() => {});
  }
}

function getOrCreateTerminal(cwd) {
  const existing = vscode.window.terminals.find((terminal) => terminal.name === "MLX Studio Server");
  if (existing) {
    return existing;
  }
  return vscode.window.createTerminal({
    name: "MLX Studio Server",
    cwd,
  });
}

async function stopLocalServer(provider) {
  if (!isManagedServerRunning()) {
    vscode.window.showInformationMessage("MLX Studio server is not running from this extension.");
    if (provider) {
      await provider.refreshStatus();
      provider.postState();
    }
    return;
  }

  const output = ensureServerOutputChannel();
  output.appendLine("[MLX Studio] Stopping local server...");
  const processRef = managedServerProcess;
  processRef.kill("SIGTERM");

  managedServerStopTimer = setTimeout(() => {
    if (managedServerProcess === processRef && isManagedServerRunning()) {
      output.appendLine("[MLX Studio] Force killing local server...");
      processRef.kill("SIGKILL");
    }
  }, 2500);

  if (provider) {
    await provider.refreshStatus().catch(() => {});
    provider.postState();
  }
}

function ensureServerOutputChannel() {
  if (!serverOutputChannel) {
    serverOutputChannel = vscode.window.createOutputChannel("MLX Studio Server");
  }
  return serverOutputChannel;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function activate(context) {
  const provider = new MlxStudioViewProvider(context);
  const modelsProvider = new MlxStudioModelsViewProvider(context, provider);
  provider.setModelsViewProvider(modelsProvider);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    })
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(MODELS_VIEW_ID, modelsProvider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("mlxStudio.openChat", async () => {
      await provider.revealView();
      await provider.refreshStatus();
      provider.postState();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("mlxStudio.openChatPanel", async () => {
      await provider.revealView();
      await provider.refreshStatus();
      provider.postState();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("mlxStudio.openModels", async () => {
      await modelsProvider.revealView();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("mlxStudio.startLocalServer", async () => {
      await startLocalServer(context, provider);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("mlxStudio.stopLocalServer", async () => {
      await stopLocalServer(provider);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("mlxStudio.addActiveFileToChat", async () => {
      await provider.addActiveFile();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("mlxStudio.addSelectionToChat", async () => {
      await provider.addSelection();
    })
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
