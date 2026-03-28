(function () {
  const vscode = acquireVsCodeApi();

  const state = {
    messages: [],
    contextItems: [],
    targetContextId: null,
    targetFolder: null,
    pendingConfirmation: null,
    localModels: [],
    systemPrompt: "",
    serverStatus: null,
    isGenerating: false,
    activePhase: null,
    vibeMode: false,
  };

  const ui = {
    stickToBottom: true,
    copyPayloads: new Map(),
    nextCopyId: 1,
    mentionResults: [],
    mentionQuery: "",
    mentionRange: null,
    mentionSelectedIndex: 0,
    mentionRequestId: 0,
    mentionSearchTimer: null,
  };

  const el = {
    statusDot: document.querySelector("#status-dot"),
    modelNameText: document.querySelector("#model-name-text"),
    runtimeBadge: document.querySelector("#runtime-badge"),
    statusText: document.querySelector("#status-text"),
    statusPhase: document.querySelector("#status-phase"),
    messages: document.querySelector("#messages"),
    contextChips: document.querySelector("#context-chips"),
    pendingConfirmation: document.querySelector("#pending-confirmation"),
    modelSelect: document.querySelector("#model-select"),
    userInput: document.querySelector("#user-input"),
    mentionPicker: document.querySelector("#mention-picker"),
    inputWrapper: document.querySelector(".input-wrapper"),
    composerForm: document.querySelector("#composer-form"),
    clearChat: document.querySelector("#clear-chat"),
    sendBtn: document.querySelector("#send-btn"),
    vibeToggle: document.querySelector("#vibe-toggle"),
    refreshStatus: document.querySelector("#refresh-status"),
    startServer: document.querySelector("#start-server"),
    addActiveFile: document.querySelector("#add-active-file"),
    mentionFiles: document.querySelector("#mention-files"),
    chooseTargetFolder: document.querySelector("#choose-target-folder"),
    systemPrompt: document.querySelector("#system-prompt"),
    systemPromptPreset: document.querySelector("#system-prompt-preset"),
  };

  /* ── Utilities ────────────────────────────────────────────────────────── */

  function escapeHtml(value) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function renderInline(text) {
    return escapeHtml(text)
      .replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
      .replace(/\n/g, "<br>");
  }

  function renderInlineText(text) {
    return escapeHtml(text)
      .replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  }

  function stripLeadingProtocolMarkup(rawText) {
    return String(rawText || "")
      .replace(/\r\n/g, "\n")
      .replace(/^(?:[ \t]*\n)*(?:@@(?:path[ \t]+)?[^\n]+|path:\s*[^\n]+)\n*/i, "");
  }

  function registerCopyPayload(content) {
    const id = `copy-${ui.nextCopyId++}`;
    ui.copyPayloads.set(id, String(content || ""));
    return id;
  }

  function renderCopyableBlock(innerHtml, copyContent, label, variant = "") {
    const copyId = registerCopyPayload(copyContent);
    const labelHtml = label ? `<span class="block-copy-label">${escapeHtml(label)}</span>` : "";
    const variantClass = variant ? ` ${variant}` : "";
    return `
      <div class="copyable-block${variantClass}">
        <div class="copyable-block-toolbar">
          ${labelHtml}
          <button type="button" class="block-copy-btn" data-copy-id="${copyId}">Copy</button>
        </div>
        ${innerHtml}
      </div>`;
  }

  function withProvisionalClosingFence(rawText) {
    const text = String(rawText || "");
    const fenceCount = (text.match(/```/g) || []).length;
    if (fenceCount % 2 === 1) {
      return `${text}\n\`\`\``;
    }
    return text;
  }

  function renderBlockMarkdown(rawText) {
    const lines = String(rawText || "").replace(/\r\n/g, "\n").split("\n");
    const blocks = [];
    let paragraphLines = [];
    let unorderedItems = [];
    let orderedItems = [];

    function flushParagraph() {
      if (paragraphLines.length === 0) return;
      blocks.push(`<p>${paragraphLines.map((line) => renderInlineText(line)).join("<br>")}</p>`);
      paragraphLines = [];
    }

    function flushUnorderedList() {
      if (unorderedItems.length === 0) return;
      blocks.push(`<ul>${unorderedItems.map((item) => `<li>${renderInlineText(item)}</li>`).join("")}</ul>`);
      unorderedItems = [];
    }

    function flushOrderedList() {
      if (orderedItems.length === 0) return;
      blocks.push(`<ol>${orderedItems.map((item) => `<li>${renderInlineText(item)}</li>`).join("")}</ol>`);
      orderedItems = [];
    }

    function flushAll() {
      flushParagraph();
      flushUnorderedList();
      flushOrderedList();
    }

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed) {
        flushAll();
        continue;
      }

      const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        flushAll();
        const level = heading[1].length;
        blocks.push(`<h${level}>${renderInlineText(heading[2])}</h${level}>`);
        continue;
      }

      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        flushAll();
        blocks.push("<hr>");
        continue;
      }

      const unordered = trimmed.match(/^[-*]\s+(.+)$/);
      if (unordered) {
        flushParagraph();
        flushOrderedList();
        unorderedItems.push(unordered[1]);
        continue;
      }

      const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
      if (ordered) {
        flushParagraph();
        flushUnorderedList();
        orderedItems.push(ordered[1]);
        continue;
      }

      flushUnorderedList();
      flushOrderedList();
      paragraphLines.push(line);
    }

    flushAll();
    return blocks.join("");
  }

  function renderMarkdown(rawText) {
    if (!rawText) return "";
    const normalizedText = withProvisionalClosingFence(rawText);
    const result = [];
    // Match fenced code blocks (``` or ~~~)
    const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(normalizedText)) !== null) {
      if (match.index > lastIndex) {
        result.push(renderBlockMarkdown(normalizedText.slice(lastIndex, match.index)));
      }
      const lang = match[1] ? escapeHtml(match[1]) : "";
      const languageLabel = (match[1] || "").trim();
      const rawCode = match[2].trimEnd();
      const code = escapeHtml(rawCode);
      if (/^(md|markdown|mdx)$/i.test(match[1] || "")) {
        result.push(
          renderCopyableBlock(
            `<div class="markdown-preview">${renderBlockMarkdown(rawCode)}</div>`,
            rawCode,
            languageLabel || "Markdown",
            "markdown"
          )
        );
      } else {
        result.push(
          renderCopyableBlock(
            `<pre><code${lang ? ` class="language-${lang}"` : ""}>${code}</code></pre>`,
            rawCode,
            languageLabel || "Code",
            "code"
          )
        );
      }
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < normalizedText.length) {
      result.push(renderBlockMarkdown(normalizedText.slice(lastIndex)));
    }

    return result.join("");
  }

  function thinkingDots() {
    return `<span class="thinking-dots"><span></span><span></span><span></span></span>`;
  }

  function distanceFromBottom() {
    return el.messages.scrollHeight - el.messages.scrollTop - el.messages.clientHeight;
  }

  function isNearBottom() {
    return distanceFromBottom() <= 32;
  }

  function scrollMessagesToBottom() {
    el.messages.scrollTop = el.messages.scrollHeight;
  }

  function resizeUserInput() {
    el.userInput.style.height = "auto";
    el.userInput.style.height = Math.min(el.userInput.scrollHeight, 200) + "px";
  }

  function hideMentionPicker() {
    ui.mentionResults = [];
    ui.mentionQuery = "";
    ui.mentionRange = null;
    ui.mentionSelectedIndex = 0;
    el.mentionPicker.hidden = true;
    el.mentionPicker.innerHTML = "";
  }

  function getActiveMention() {
    if (el.userInput.disabled) {
      return null;
    }

    const selectionStart = el.userInput.selectionStart ?? 0;
    const selectionEnd = el.userInput.selectionEnd ?? 0;
    if (selectionStart !== selectionEnd) {
      return null;
    }

    const text = el.userInput.value;
    const prefix = text.slice(0, selectionStart);
    const atIndex = prefix.lastIndexOf("@");
    if (atIndex < 0) {
      return null;
    }

    const beforeChar = atIndex > 0 ? prefix[atIndex - 1] : "";
    if (beforeChar && !/[\s([{,'"“”‘’`]/.test(beforeChar)) {
      return null;
    }

    const query = prefix.slice(atIndex + 1);
    if (/[\s\r\n\t]/.test(query) || /[^0-9A-Za-z._/\-가-힣]/.test(query)) {
      return null;
    }

    return {
      start: atIndex,
      end: selectionStart,
      query,
    };
  }

  function renderMentionPicker() {
    const mention = getActiveMention();
    if (!mention) {
      hideMentionPicker();
      return;
    }

    const results = ui.mentionResults || [];
    el.mentionPicker.hidden = false;

    if (results.length === 0) {
      const emptyLabel = mention.query
        ? `No files found for @${mention.query}`
        : "Type a file name after @ to search the workspace";
      el.mentionPicker.innerHTML = `<div class="mention-picker-empty">${escapeHtml(emptyLabel)}</div>`;
      return;
    }

    const normalizedIndex = Math.max(0, Math.min(ui.mentionSelectedIndex, results.length - 1));
    ui.mentionSelectedIndex = normalizedIndex;
    el.mentionPicker.innerHTML = results
      .map((result, index) => {
        const activeClass = index === normalizedIndex ? " active" : "";
        const attachedBadge = result.attached ? '<span class="mention-result-badge">Attached</span>' : "";
        const description = result.description || result.relativePath || "";
        return `
          <button
            type="button"
            class="mention-result${activeClass}"
            data-index="${index}"
            title="${escapeHtml(result.relativePath || result.label || "")}"
          >
            <span class="mention-result-main">
              <span class="mention-result-label">${escapeHtml(result.label || result.relativePath || "")}</span>
              <span class="mention-result-description">${escapeHtml(description)}</span>
            </span>
            ${attachedBadge}
          </button>`;
      })
      .join("");
  }

  function scheduleMentionSearch(options = {}) {
    const mention = getActiveMention();
    if (!mention) {
      hideMentionPicker();
      return;
    }

    ui.mentionRange = mention;
    ui.mentionQuery = mention.query;
    ui.mentionSelectedIndex = 0;
    ui.mentionResults = [];
    renderMentionPicker();

    if (ui.mentionSearchTimer) {
      window.clearTimeout(ui.mentionSearchTimer);
    }

    const requestId = ++ui.mentionRequestId;
    const runSearch = () => {
      vscode.postMessage({
        type: "search-files",
        query: mention.query,
        requestId,
      });
    };

    if (options.immediate) {
      runSearch();
      return;
    }

    ui.mentionSearchTimer = window.setTimeout(runSearch, 100);
  }

  function replaceMentionToken(mention) {
    const text = el.userInput.value;
    let before = text.slice(0, mention.start);
    let after = text.slice(mention.end);

    if (before.endsWith(" ") && after.startsWith(" ")) {
      after = after.slice(1);
    }

    const nextValue = before + after;
    el.userInput.value = nextValue;
    el.userInput.focus();
    el.userInput.setSelectionRange(before.length, before.length);
    resizeUserInput();
  }

  function chooseMentionResult(result) {
    const mention = getActiveMention() || ui.mentionRange;
    if (!mention || !result?.uri) {
      hideMentionPicker();
      return;
    }

    replaceMentionToken(mention);
    hideMentionPicker();
    vscode.postMessage({
      type: "attach-file",
      uri: result.uri,
    });
  }

  function triggerMentionSearch() {
    el.userInput.focus();
    const currentMention = getActiveMention();
    if (!currentMention) {
      const selectionStart = el.userInput.selectionStart ?? el.userInput.value.length;
      const selectionEnd = el.userInput.selectionEnd ?? selectionStart;
      const text = el.userInput.value;
      const needsLeadingSpace = selectionStart > 0 && !/[\s([{,'"“”‘’`]/.test(text[selectionStart - 1] || "");
      const insertText = `${needsLeadingSpace ? " " : ""}@`;
      const nextValue = `${text.slice(0, selectionStart)}${insertText}${text.slice(selectionEnd)}`;
      const nextCaret = selectionStart + insertText.length;
      el.userInput.value = nextValue;
      el.userInput.setSelectionRange(nextCaret, nextCaret);
      resizeUserInput();
    }

    scheduleMentionSearch({ immediate: true });
  }

  function extractLastCodeBlock(text) {
    const matches = [...text.matchAll(/```(?:\w+)?\n?([\s\S]*?)```/g)];
    if (matches.length === 0) return null;
    return matches[matches.length - 1][1].trimEnd();
  }

  function extractLastCodeBlockInfo(text) {
    const matches = [...text.matchAll(/```(\w*)\n?([\s\S]*?)```/g)];
    if (matches.length === 0) return null;
    const last = matches[matches.length - 1];
    return {
      language: (last[1] || "").trim().toLowerCase(),
      code: last[2].trimEnd(),
    };
  }

  function extractStandaloneCodeBlockInfo(text) {
    const match = String(text || "").trim().match(/^```(\w*)\n?([\s\S]*?)```$/);
    if (!match?.[2]) return null;
    return {
      language: (match[1] || "").trim().toLowerCase(),
      code: match[2].trimEnd(),
    };
  }

  function hasGeneratedPathMarker(text) {
    return /^(?:@@(?:path\s+)?|path:\s*)/im.test(String(text || ""));
  }

  function getTargetContextItem(targetContextId = state.targetContextId) {
    if (targetContextId) {
      const explicitTarget = state.contextItems.find((item) => item.id === targetContextId);
      if (explicitTarget) {
        return explicitTarget;
      }
    }
    return state.contextItems[0] || null;
  }

  function getExplicitTargetContextItem(targetContextId) {
    if (!targetContextId) {
      return null;
    }
    return state.contextItems.find((item) => item.id === targetContextId) || null;
  }

  /* ── Render: messages ─────────────────────────────────────────────────── */

  function renderMessages() {
    const previousClientHeight = el.messages.clientHeight;
    const previousDistanceFromBottom = distanceFromBottom();
    const shouldStick = ui.stickToBottom || isNearBottom();
    ui.copyPayloads.clear();

    if (state.messages.length === 0) {
      el.messages.innerHTML = `
        <div class="messages-placeholder">
          <div class="messages-placeholder-icon">⬡</div>
          <div>Ask about the loaded model or your code</div>
        </div>`;
      if (shouldStick) {
        scrollMessagesToBottom();
      }
      return;
    }

    el.messages.innerHTML = "";

    for (const message of state.messages) {
      const rawContent = String(message.content || "");
      const visibleContent = message.role === "assistant" ? stripLeadingProtocolMarkup(rawContent) : rawContent;
      const row = document.createElement("div");
      row.className = `message-row ${message.role}`;

      if (message.role !== "user") {
        const roleLabel = document.createElement("div");
        roleLabel.className = "message-role";
        roleLabel.textContent = "MLX";
        row.appendChild(roleLabel);
      }

      const bubble = document.createElement("div");
      bubble.className = "message-bubble";

      const content = document.createElement("div");
      content.className = "message-content";
      content.innerHTML = renderMarkdown(visibleContent);
      bubble.appendChild(content);
      row.appendChild(bubble);

      if (message.phase && !message.metrics) {
        const phase = document.createElement("div");
        phase.className = "message-phase";
        phase.innerHTML = `${thinkingDots()} ${escapeHtml(message.phase.label || "Thinking...")}`;
        row.appendChild(phase);
      }

      const metricParts = [];
      if (message.metrics?.ttft_ms != null) {
        metricParts.push(`TTFT ${Number(message.metrics.ttft_ms).toFixed(0)}ms`);
      }
      if (message.metrics?.decode_tps) {
        metricParts.push(`${Number(message.metrics.decode_tps).toFixed(1)} tok/s`);
      }
      if (message.metrics?.peak_memory_gb) {
        metricParts.push(`${Number(message.metrics.peak_memory_gb).toFixed(2)} GB`);
      }

      if (message.role === "assistant" && !message.phase && visibleContent.trim()) {
        const metaRow = document.createElement("div");
        metaRow.className = "message-meta-row";

        const metrics = document.createElement("div");
        metrics.className = "message-metrics";
        metrics.textContent = metricParts.join(" · ");
        metaRow.appendChild(metrics);

        const copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.className = "copy-btn";
        copyBtn.textContent = "Copy";
        copyBtn.addEventListener("click", () => {
          vscode.postMessage({
            type: "copy-text",
            content: visibleContent,
          });
          copyBtn.textContent = "Copied";
          copyBtn.disabled = true;
          window.setTimeout(() => {
            copyBtn.textContent = "Copy";
            copyBtn.disabled = false;
          }, 1200);
        });
        metaRow.appendChild(copyBtn);

        row.appendChild(metaRow);
      } else if (metricParts.length > 0) {
        const metrics = document.createElement("div");
        metrics.className = "message-metrics";
        metrics.textContent = metricParts.join(" · ");
        row.appendChild(metrics);
      }

      if (message.autoApplied || message.autoApplySkipped) {
        const applyState = document.createElement("div");
        applyState.className = "message-apply-state" + (message.autoApplySkipped ? " warning" : "");
        applyState.textContent = message.autoApplied
          ? `Applied automatically to ${message.targetLabel || "target file"}`
          : message.autoApplyReason || "Automatic apply was skipped.";
        row.appendChild(applyState);
      }

      if (message.autoCreated) {
        const createState = document.createElement("div");
        createState.className = "message-apply-state";
        createState.textContent = `Created automatically: ${message.autoCreatedPath || message.targetLabel || "new file"}`;
        row.appendChild(createState);
      }

      if (message.autoCreateSkipped) {
        const createState = document.createElement("div");
        createState.className = "message-apply-state warning";
        createState.textContent = message.autoCreateReason || "Automatic file creation was skipped.";
        row.appendChild(createState);
      }

      // Apply button: shown on completed assistant messages that contain a code block.
      if (message.role === "assistant" && !message.phase && rawContent) {
        const editCodeBlock = extractStandaloneCodeBlockInfo(visibleContent);
        const createCodeBlock = hasGeneratedPathMarker(rawContent) ? extractLastCodeBlockInfo(rawContent) : null;
        const targetItem = getTargetContextItem(message.targetContextId);
        const label = targetItem ? targetItem.label : message.targetLabel || "Editor";
        const actions = document.createElement("div");
        actions.className = "message-actions";
        let hasActions = false;

        if ((message.requestMode === "edit-file" || message.requestMode === "auto") && editCodeBlock && targetItem) {
          const applyBtn = document.createElement("button");
          applyBtn.type = "button";
          applyBtn.className = "apply-btn" + (message.vibeMode ? " vibe-active" : "");
          applyBtn.textContent = message.autoApplied ? `↺ Reapply to ${label}` : `↓ Apply to ${label}`;
          applyBtn.addEventListener("click", () => {
            vscode.postMessage({
              type: "apply-code",
              code: editCodeBlock.code,
              contextItemId: targetItem.id,
            });
          });
          actions.appendChild(applyBtn);
          hasActions = true;
        }

        if (createCodeBlock) {
          const createBtn = document.createElement("button");
          createBtn.type = "button";
          createBtn.className = "apply-btn create-file-btn";
          createBtn.textContent = "+ Create File";
          createBtn.addEventListener("click", () => {
            vscode.postMessage({
              type: "create-file",
              code: createCodeBlock.code,
              language: createCodeBlock.language,
            });
          });
          actions.appendChild(createBtn);
          hasActions = true;
        }

        if (hasActions) {
          row.appendChild(actions);
        }
      }

      el.messages.appendChild(row);
    }

    if (shouldStick) {
      scrollMessagesToBottom();
      ui.stickToBottom = true;
    } else {
      el.messages.scrollTop = Math.max(0, el.messages.scrollHeight - previousClientHeight - previousDistanceFromBottom);
    }
  }

  /* ── Render: context chips ────────────────────────────────────────────── */

  function renderContextChips() {
    el.contextChips.innerHTML = "";
    const targetItem = getTargetContextItem();

    if (state.targetFolder) {
      const folderChip = document.createElement("div");
      folderChip.className = "context-chip folder";
      folderChip.title = `New files will be created under ${state.targetFolder.label}`;
      folderChip.innerHTML = `
        <span class="context-chip-badge">Folder</span>
        <span class="context-chip-label">${escapeHtml(state.targetFolder.label)}</span>
        <span class="context-chip-remove" aria-label="Clear folder">&times;</span>`;
      folderChip.addEventListener("click", (event) => {
        if (event.target.closest(".context-chip-remove")) {
          vscode.postMessage({ type: "clear-target-folder" });
          return;
        }
        vscode.postMessage({ type: "choose-target-folder" });
      });
      el.contextChips.appendChild(folderChip);
    }

    for (const item of state.contextItems) {
      const isTarget = Boolean(targetItem && targetItem.id === item.id);
      const chip = document.createElement("div");
      chip.className = "context-chip" + (isTarget ? " target" : "");
      chip.title = isTarget ? `${item.label} (edit target)` : `${item.label} (click to make edit target)`;
      chip.tabIndex = 0;
      chip.setAttribute("role", "button");
      chip.setAttribute("aria-pressed", isTarget ? "true" : "false");
      chip.innerHTML = `
        ${isTarget ? '<span class="context-chip-badge">Target</span>' : ""}
        <span class="context-chip-label">${escapeHtml(item.label)}</span>
        <span class="context-chip-remove" aria-label="Remove">&times;</span>`;
      chip.addEventListener("click", (event) => {
        if (event.target.closest(".context-chip-remove")) {
          vscode.postMessage({ type: "remove-context", id: item.id });
          return;
        }
        vscode.postMessage({ type: "set-target-context", id: item.id });
      });
      chip.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          vscode.postMessage({ type: "set-target-context", id: item.id });
        }
      });
      el.contextChips.appendChild(chip);
    }
  }

  function renderPendingConfirmation() {
    const pending = state.pendingConfirmation;
    if (!pending) {
      el.pendingConfirmation.hidden = true;
      el.pendingConfirmation.innerHTML = "";
      return;
    }

    const items = Array.isArray(pending.items) ? pending.items : [];
    el.pendingConfirmation.hidden = false;
    el.pendingConfirmation.innerHTML = `
      <div class="pending-confirmation-title">${escapeHtml(pending.title || "Confirm action")}</div>
      <div class="pending-confirmation-detail">${escapeHtml(pending.detail || "")}</div>
      ${
        items.length > 0
          ? `<div class="pending-confirmation-items">${items
              .map((item) => `<div class="pending-confirmation-item">${escapeHtml(item)}</div>`)
              .join("")}</div>`
          : ""
      }
      <div class="pending-confirmation-actions">
        <button type="button" class="pending-confirmation-btn primary" id="confirm-pending-action">
          ${escapeHtml(pending.confirmLabel || "Confirm")}
        </button>
        <button type="button" class="pending-confirmation-btn" id="cancel-pending-action">
          ${escapeHtml(pending.cancelLabel || "Cancel")}
        </button>
      </div>`;

    el.pendingConfirmation
      .querySelector("#confirm-pending-action")
      .addEventListener("click", () => vscode.postMessage({ type: "confirm-pending-action" }));
    el.pendingConfirmation
      .querySelector("#cancel-pending-action")
      .addEventListener("click", () => vscode.postMessage({ type: "cancel-pending-action" }));
  }

  /* ── Render: model select ─────────────────────────────────────────────── */

  function currentModelKey() {
    const runtime = state.serverStatus?.runtime;
    const modelId = state.serverStatus?.model_id;
    if (!runtime || !modelId || modelId === "-") return "";
    return `${runtime === "llama_cpp" ? "gguf" : runtime}:${modelId}`;
  }

  function renderModelSelect() {
    el.modelSelect.innerHTML = "";
    if (state.localModels.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No models";
      el.modelSelect.appendChild(opt);
      el.modelSelect.disabled = true;
      return;
    }

    const selectedKey = currentModelKey();
    for (const model of state.localModels) {
      const opt = document.createElement("option");
      opt.value = model.key;
      opt.textContent = `${model.label} [${model.format}]`;
      opt.selected = model.key === selectedKey;
      el.modelSelect.appendChild(opt);
    }
    el.modelSelect.disabled = state.isGenerating;
  }

  /* ── Render: vibe mode ────────────────────────────────────────────────── */

  function renderVibeMode() {
    el.vibeToggle.classList.toggle("active", state.vibeMode);
    el.inputWrapper.classList.toggle("vibe-active", state.vibeMode);
    if (state.vibeMode && state.targetFolder && !getTargetContextItem()) {
      el.userInput.placeholder = `Describe the file to create in ${state.targetFolder.label}…`;
      return;
    }
    el.userInput.placeholder = state.vibeMode
      ? "Describe the change you want to make… Active editor is used if no target is attached."
      : "Message MLX Studio…";
  }

  /* ── Render: topbar + status ──────────────────────────────────────────── */

  function renderStatus() {
    const s = state.serverStatus;
    const available = s?.available === true;
    const blockedByConfirmation = Boolean(state.pendingConfirmation);

    // Status dot
    el.statusDot.className = "status-dot " + (available ? "online" : s ? "offline" : "");

    // Model name + runtime badge
    el.modelNameText.textContent = available ? (s.model_id || "—") : "—";
    el.runtimeBadge.textContent = available ? (s.runtime || "—") : "—";
    el.runtimeBadge.style.display = available ? "" : "none";

    // Status strip text
    if (!s) {
      el.statusText.textContent = "Checking server…";
    } else if (!available) {
      el.statusText.textContent = s.error
        ? `Offline — ${s.error}`
        : "Server offline — run ./scripts/ui.sh --port 8010";
    } else {
      el.statusText.textContent = `Connected · ${s.runtime || ""}`;
    }

    // Phase badge
    const phase = state.activePhase;
    const running = state.isGenerating;
    el.statusPhase.textContent = phase || (running ? "Running" : "Idle");
    el.statusPhase.className = "status-phase" + (running ? " running" : "");

    // Disable input during generation
    el.sendBtn.disabled = running || blockedByConfirmation;
    el.userInput.disabled = running || blockedByConfirmation;
    if (el.mentionFiles) {
      el.mentionFiles.disabled = running || blockedByConfirmation;
    }
    if (running || blockedByConfirmation) {
      hideMentionPicker();
    }
  }

  /* ── Render all ───────────────────────────────────────────────────────── */

  function renderAll() {
    el.systemPrompt.value = state.systemPrompt || "";
    renderStatus();
    renderVibeMode();
    renderModelSelect();
    renderContextChips();
    renderPendingConfirmation();
    renderMessages();
    renderMentionPicker();
  }

  /* ── Message bridge ───────────────────────────────────────────────────── */

  window.addEventListener("message", (event) => {
    const { type, payload, message } = event.data || {};
    if (type === "state") {
      state.messages = payload.messages || [];
      state.contextItems = payload.contextItems || [];
      state.targetContextId = payload.targetContextId || null;
      state.targetFolder = payload.targetFolder || null;
      state.pendingConfirmation = payload.pendingConfirmation || null;
      state.localModels = payload.localModels || [];
      state.systemPrompt = payload.systemPrompt || "";
      state.serverStatus = payload.serverStatus || null;
      state.isGenerating = Boolean(payload.isGenerating);
      state.activePhase = payload.activePhase || null;
      state.vibeMode = Boolean(payload.vibeMode);
      renderAll();
      vscode.setState(state);
    }
    if (type === "file-search-results") {
      const activeMention = getActiveMention();
      if (!activeMention) {
        hideMentionPicker();
        return;
      }

      if (Number(payload?.requestId || 0) < ui.mentionRequestId) {
        return;
      }

      if (String(payload?.query || "") !== activeMention.query) {
        return;
      }

      ui.mentionResults = Array.isArray(payload?.results) ? payload.results : [];
      ui.mentionSelectedIndex = 0;
      renderMentionPicker();
    }
    if (type === "error") {
      state.activePhase = message || "Error";
      renderStatus();
    }
  });

  /* ── Events ───────────────────────────────────────────────────────────── */

  el.composerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const content = el.userInput.value.trim();
    if (!content) return;
    ui.stickToBottom = true;
    hideMentionPicker();
    vscode.postMessage({ type: "set-system-prompt", value: el.systemPrompt.value });
    vscode.postMessage({ type: "send-chat", content });
    el.userInput.value = "";
    el.userInput.style.height = "";
  });

  el.vibeToggle.addEventListener("click", () => {
    vscode.postMessage({ type: "toggle-vibe-mode" });
  });

  el.userInput.addEventListener("keydown", (event) => {
    if (!el.mentionPicker.hidden) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        ui.mentionSelectedIndex = Math.min(ui.mentionSelectedIndex + 1, Math.max(ui.mentionResults.length - 1, 0));
        renderMentionPicker();
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        ui.mentionSelectedIndex = Math.max(ui.mentionSelectedIndex - 1, 0);
        renderMentionPicker();
        return;
      }

      if (event.key === "Enter" || event.key === "Tab") {
        const selected = ui.mentionResults[ui.mentionSelectedIndex];
        if (selected) {
          event.preventDefault();
          chooseMentionResult(selected);
          return;
        }
      }

      if (event.key === "Escape") {
        event.preventDefault();
        hideMentionPicker();
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      el.composerForm.requestSubmit();
    }
  });

  // Auto-grow textarea
  el.userInput.addEventListener("input", () => {
    resizeUserInput();
    scheduleMentionSearch();
  });

  el.userInput.addEventListener("click", () => {
    scheduleMentionSearch({ immediate: true });
  });

  el.userInput.addEventListener("keyup", (event) => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      scheduleMentionSearch({ immediate: true });
    }
  });

  el.messages.addEventListener("scroll", () => {
    ui.stickToBottom = isNearBottom();
  });

  el.messages.addEventListener("click", (event) => {
    const copyButton = event.target.closest(".block-copy-btn");
    if (!copyButton) {
      return;
    }

    const copyId = copyButton.getAttribute("data-copy-id");
    const content = copyId ? ui.copyPayloads.get(copyId) : null;
    if (!content) {
      return;
    }

    vscode.postMessage({
      type: "copy-text",
      content,
    });
    copyButton.textContent = "Copied";
    copyButton.disabled = true;
    window.setTimeout(() => {
      copyButton.textContent = "Copy";
      copyButton.disabled = false;
    }, 1200);
  });

  el.clearChat.addEventListener("click", () => {
    vscode.postMessage({ type: "clear-chat" });
  });

  el.refreshStatus.addEventListener("click", () => {
    vscode.postMessage({ type: "set-system-prompt", value: el.systemPrompt.value });
    vscode.postMessage({ type: "refresh-status" });
  });

  el.startServer.addEventListener("click", () => {
    vscode.postMessage({ type: "start-server" });
  });

  el.modelSelect.addEventListener("change", () => {
    if (!el.modelSelect.value) return;
    vscode.postMessage({ type: "switch-model", key: el.modelSelect.value });
  });

  el.addActiveFile.addEventListener("click", () => {
    vscode.postMessage({ type: "add-active-file" });
  });

  el.mentionFiles.addEventListener("click", () => {
    triggerMentionSearch();
  });

  el.chooseTargetFolder.addEventListener("click", () => {
    vscode.postMessage({ type: "choose-target-folder" });
  });

  el.mentionPicker.addEventListener("click", (event) => {
    const option = event.target.closest(".mention-result");
    if (!option) {
      return;
    }

    const index = Number(option.getAttribute("data-index"));
    const result = Number.isInteger(index) ? ui.mentionResults[index] : null;
    if (!result) {
      return;
    }

    chooseMentionResult(result);
  });

  el.mentionPicker.addEventListener("mousemove", (event) => {
    const option = event.target.closest(".mention-result");
    if (!option) {
      return;
    }

    const index = Number(option.getAttribute("data-index"));
    if (!Number.isInteger(index) || index === ui.mentionSelectedIndex) {
      return;
    }

    ui.mentionSelectedIndex = index;
    renderMentionPicker();
  });

  el.systemPrompt.addEventListener("change", () => {
    vscode.postMessage({ type: "set-system-prompt", value: el.systemPrompt.value });
  });

  el.systemPromptPreset.addEventListener("change", () => {
    if (el.systemPromptPreset.value === "coding") {
      el.systemPrompt.value =
        "You are a careful coding assistant. If you are unsure about an API, framework, or acronym, say you are unsure instead of guessing. Keep answers factual, practical, and in the user's language.";
    } else {
      el.systemPrompt.value =
        "You are a helpful local assistant. Answer clearly, stay concise, and match the user's language.";
    }
    vscode.postMessage({ type: "set-system-prompt", value: el.systemPrompt.value });
  });

  /* ── Init ─────────────────────────────────────────────────────────────── */

  const previous = vscode.getState();
  if (previous) {
    Object.assign(state, previous);
    renderAll();
  }

  vscode.postMessage({ type: "ready" });
})();
