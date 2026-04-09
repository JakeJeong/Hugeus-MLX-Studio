import AppKit
import Foundation
import SwiftUI
import WebKit

// The transcript uses a single WKWebView so markdown, code blocks, copy
// actions, and future syntax engines can evolve without forcing SwiftUI to
// recreate every assistant message bubble.
struct ChatTranscriptWebView: NSViewRepresentable {
    let messages: [ConversationMessage]
    let isSending: Bool
    let requestStateText: String

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        let controller = WKUserContentController()
        controller.add(context.coordinator, name: Coordinator.copyHandlerName)
        configuration.userContentController = controller

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.setValue(false, forKey: "drawsBackground")
        webView.setValue(NSColor.clear, forKey: "underPageBackgroundColor")
        webView.allowsMagnification = false
        webView.allowsBackForwardNavigationGestures = false
        configureScrollView(for: webView)

        context.coordinator.attach(webView)
        webView.loadHTMLString(Coordinator.htmlShell, baseURL: nil)
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        configureScrollView(for: webView)
        let payload = TranscriptPayload(
            messages: messages.map(TranscriptMessage.init),
            showPendingIndicator: isSending && messages.last?.role == .user,
            requestStateText: requestStateText
        )
        context.coordinator.render(payload, in: webView)
    }

    static func dismantleNSView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.navigationDelegate = nil
        webView.configuration.userContentController.removeScriptMessageHandler(forName: Coordinator.copyHandlerName)
    }

    private func configureScrollView(for webView: WKWebView) {
        guard let scrollView = webView.subviews.compactMap({ $0 as? NSScrollView }).first else {
            return
        }

        scrollView.drawsBackground = false
        scrollView.borderType = .noBorder
        scrollView.hasHorizontalScroller = false
        scrollView.autohidesScrollers = true
        scrollView.scrollerStyle = .overlay
        scrollView.scrollerKnobStyle = .dark
    }
}

extension ChatTranscriptWebView {
    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        static let copyHandlerName = "copy"
        static let htmlShell = #"""
        <!doctype html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            :root {
              color-scheme: dark;
              --bg: transparent;
              --text: #F4F7FB;
              --muted: rgba(244, 247, 251, 0.62);
              --subtle: rgba(244, 247, 251, 0.42);
              --border: rgba(255, 255, 255, 0.08);
              --panel: rgba(39, 43, 56, 0.94);
              --panel-soft: rgba(28, 32, 43, 0.88);
              --panel-muted: rgba(46, 51, 64, 0.96);
              --code-bg: rgba(21, 24, 33, 0.98);
              --accent: #4C94FF;
              --accent-soft: rgba(76, 148, 255, 0.18);
              --code-plain: #E6EBF5;
              --code-keyword: #84B5FF;
              --code-type: #FACF7B;
              --code-string: #F7A76D;
              --code-comment: #75B783;
              --code-number: #65D9D2;
              --code-annotation: #D98AF7;
              --code-symbol: #CAD3E2;
            }

            * { box-sizing: border-box; }
            html, body {
              margin: 0;
              padding: 0;
              background: var(--bg);
              color: var(--text);
              font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
            }

            body {
              min-height: 100%;
            }

            #transcript {
              width: 100%;
              padding: 2px 0 14px;
            }

            .conversation {
              width: min(100%, 750px);
              margin: 0 auto;
              display: flex;
              flex-direction: column;
              gap: 14px;
            }

            .message-row {
              width: 100%;
              display: flex;
            }

            .message-row.user {
              justify-content: flex-end;
            }

            .message-row.assistant,
            .message-row.pending {
              justify-content: flex-start;
            }

            .user-bubble {
              width: fit-content;
              max-width: min(100%, 640px);
              padding: 10px 16px;
              border-radius: 16px;
              border: 1px solid var(--border);
              background: linear-gradient(180deg, rgba(50, 56, 73, 0.96), rgba(41, 46, 59, 0.96));
              color: var(--text);
              font-size: 15px;
              line-height: 1.52;
              text-align: left;
              white-space: pre-wrap;
              word-break: break-word;
              box-shadow: 0 10px 28px rgba(0, 0, 0, 0.14);
            }

            .assistant-content {
              max-width: none;
              width: 100%;
              color: var(--text);
              font-size: 15px;
              line-height: 1.64;
            }

            .assistant-content > :first-child {
              margin-top: 0;
            }

            .assistant-content > :last-child {
              margin-bottom: 0;
            }

            .assistant-content p,
            .assistant-content ul,
            .assistant-content ol,
            .assistant-content blockquote {
              margin: 0 0 12px;
            }

            .assistant-content h1,
            .assistant-content h2,
            .assistant-content h3,
            .assistant-content h4,
            .assistant-content h5,
            .assistant-content h6 {
              margin: 2px 0 10px;
              line-height: 1.35;
            }

            .assistant-content h1 { font-size: 28px; }
            .assistant-content h2 { font-size: 23px; }
            .assistant-content h3 { font-size: 19px; }

            .assistant-content ul,
            .assistant-content ol {
              padding-left: 20px;
            }

            .assistant-content li + li {
              margin-top: 4px;
            }

            .assistant-content hr {
              border: none;
              border-top: 1px solid var(--border);
              margin: 16px 0;
            }

            .assistant-content a {
              color: #8CB9FF;
              text-decoration: none;
            }

            .assistant-content a:hover {
              text-decoration: underline;
            }

            .assistant-content blockquote {
              border-left: 3px solid rgba(76, 148, 255, 0.38);
              padding-left: 12px;
              color: var(--muted);
            }

            .assistant-content code {
              font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
              font-size: 12px;
              background: rgba(255, 255, 255, 0.06);
              border: 1px solid rgba(255, 255, 255, 0.07);
              border-radius: 6px;
              padding: 2px 6px;
            }

            .copyable-block {
              margin: 12px 0;
              border: 1px solid var(--border);
              border-radius: 14px;
              overflow: hidden;
              background: var(--code-bg);
              box-shadow: 0 10px 28px rgba(0, 0, 0, 0.12);
            }

            .code-file-label {
              margin: 0 0 8px;
              font-size: 13px;
              font-weight: 700;
              letter-spacing: 0.01em;
              color: var(--text);
            }

            .copyable-block-toolbar {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 10px;
              padding: 7px 11px;
              border-bottom: 1px solid var(--border);
              background: rgba(255, 255, 255, 0.03);
            }

            .code-meta {
              display: inline-flex;
              align-items: center;
              gap: 8px;
              min-width: 0;
            }

            .block-copy-label {
              font-size: 10px;
              font-weight: 700;
              letter-spacing: 0.08em;
              text-transform: uppercase;
              color: var(--muted);
            }

            .block-status {
              font-size: 10px;
              font-weight: 700;
              letter-spacing: 0.05em;
              text-transform: uppercase;
              color: var(--accent);
              background: var(--accent-soft);
              border-radius: 999px;
              padding: 4px 8px;
            }

            .block-copy-btn {
              appearance: none;
              border: 1px solid var(--border);
              background: transparent;
              color: var(--muted);
              font: 11px/1.4 -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
              padding: 4px 10px;
              border-radius: 8px;
              cursor: pointer;
            }

            .block-copy-btn:hover {
              background: rgba(255, 255, 255, 0.06);
              color: var(--text);
            }

            .copyable-block pre,
            .copyable-block .markdown-preview {
              margin: 0;
              border: none;
              border-radius: 0;
            }

            .copyable-block pre {
              overflow-x: auto;
              padding: 12px 14px 14px;
              background: transparent;
            }

            .copyable-block pre code {
              display: block;
              background: transparent;
              border: none;
              padding: 0;
              color: var(--code-plain);
              font-size: 13px;
              line-height: 1.62;
              white-space: pre;
            }

            .copyable-block.markdown .markdown-preview {
              padding: 12px 14px 14px;
            }

            .token-comment { color: var(--code-comment); }
            .token-string { color: var(--code-string); }
            .token-number { color: var(--code-number); }
            .token-keyword { color: var(--code-keyword); }
            .token-type { color: var(--code-type); }
            .token-symbol { color: var(--code-symbol); }
            .token-variable { color: var(--code-annotation); }

            .pending-row {
              display: inline-flex;
              align-items: center;
              gap: 10px;
              color: var(--muted);
              font-size: 13px;
            }

            .thinking-dots {
              display: inline-flex;
              gap: 4px;
            }

            .thinking-dots span {
              width: 5px;
              height: 5px;
              border-radius: 50%;
              background: var(--muted);
              animation: dot-pulse 1.4s ease-in-out infinite;
            }

            .thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
            .thinking-dots span:nth-child(3) { animation-delay: 0.4s; }

            @keyframes dot-pulse {
              0%, 80%, 100% { opacity: 0.35; transform: scale(0.8); }
              40% { opacity: 1; transform: scale(1); }
            }

            .empty-state {
              min-height: 360px;
              display: flex;
              align-items: center;
              justify-content: center;
              text-align: center;
              padding: 24px;
            }

            .empty-state h2 {
              margin: 0 0 10px;
              font-size: 30px;
              line-height: 1.2;
            }

            .empty-state p {
              margin: 0;
              max-width: 560px;
              color: var(--muted);
              line-height: 1.65;
            }
          </style>
        </head>
        <body>
          <div id="transcript"></div>
          <script>
            const copyPayloads = new Map();
            let nextCopyId = 1;

            function escapeHtml(value) {
              return String(value || "")
                .replaceAll("&", "&amp;")
                .replaceAll("<", "&lt;")
                .replaceAll(">", "&gt;")
                .replaceAll('"', "&quot;")
                .replaceAll("'", "&#39;");
            }

            function decodeBase64UTF8(base64) {
              const binary = window.atob(base64);
              const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
              return new TextDecoder().decode(bytes);
            }

            function thinkingDots() {
              return '<span class="thinking-dots"><span></span><span></span><span></span></span>';
            }

            function truncateAtProtocolBoundary(text) {
              const source = String(text || "");
              const markers = ["<|start|>", "<|end|>", "<|channel|>", "<|message|>"];
              let earliest = -1;
              for (const marker of markers) {
                const index = source.indexOf(marker);
                if (index === -1) continue;
                if (earliest === -1 || index < earliest) earliest = index;
              }
              return earliest === -1 ? source : source.slice(0, earliest);
            }

            function extractVisibleAssistantText(text) {
              const normalized = String(text || "").replace(/\r\n/g, "\n");
              if (!normalized.includes("<|channel|>") && !normalized.includes("<|message|>") && !normalized.includes("<|start|>")) {
                return normalized;
              }

              const markerPattern = /<\|channel\|>([^<\r\n]+?)<\|message\|>/gi;
              const markers = Array.from(normalized.matchAll(markerPattern));
              if (markers.length === 0) {
                return "";
              }

              const preferred = [];
              const fallback = [];

              for (let index = 0; index < markers.length; index += 1) {
                const match = markers[index];
                const channel = String(match[1] || "").trim().toLowerCase();
                const start = match.index + match[0].length;
                const end = index + 1 < markers.length ? markers[index + 1].index : normalized.length;
                const segment = truncateAtProtocolBoundary(normalized.slice(start, end));
                if (channel === "final") {
                  preferred.push(segment);
                } else if (!["analysis", "thought", "commentary"].includes(channel)) {
                  fallback.push(segment);
                }
              }

              if (preferred.length > 0) return preferred.join("").replace(/^\n+/, "");
              if (fallback.length > 0) return fallback.join("").replace(/^\n+/, "");
              return "";
            }

            function stripAuxiliaryProtocolMarkup(rawText) {
              return String(rawText || "")
                .replace(/\r\n/g, "\n")
                .replace(/<\|\/?[a-z0-9_.-]+(?:\|)?>/gi, "")
                .replace(/<\/?[a-z0-9_.-]+\|>/gi, "")
                .replace(/<\|channel\>thought[\s\S]*?(?:<channel\|>|$)\s*/gi, "")
                .replace(/<think>[\s\S]*?(?:<\/think>|$)\s*/gi, "")
                .replace(/<\|think\|>[\s\S]*?(?:<\|\/think\|>|<\/think>|$)\s*/gi, "")
                .replace(/^\s+/, "");
            }

            function sanitizeSource(rawText) {
              return stripAuxiliaryProtocolMarkup(extractVisibleAssistantText(rawText)).trim();
            }

            function withProvisionalClosingFence(rawText) {
              const text = String(rawText || "");
              const fenceCount = (text.match(/```/g) || []).length;
              if (fenceCount % 2 === 1) {
                return `${text}\n\`\`\``;
              }
              return text;
            }

            function renderInlineText(text) {
              let html = escapeHtml(text);
              html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
              html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
              html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
              html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
              html = html.replace(/\n/g, "<br>");
              return html;
            }

            function registerCopyPayload(content) {
              const id = `copy-${nextCopyId++}`;
              copyPayloads.set(id, String(content || ""));
              return id;
            }

            function renderCopyableBlock(innerHtml, copyContent, label, variant = "", extraMeta = "") {
              const copyId = registerCopyPayload(copyContent);
              const labelHtml = label ? `<span class="block-copy-label">${escapeHtml(label)}</span>` : "";
              const variantClass = variant ? ` ${variant}` : "";
              return `
                <div class="copyable-block${variantClass}">
                  <div class="copyable-block-toolbar">
                    <div class="code-meta">
                      ${labelHtml}
                      ${extraMeta}
                    </div>
                    <button type="button" class="block-copy-btn" data-copy-id="${copyId}">Copy</button>
                  </div>
                  ${innerHtml}
                </div>`;
            }

            function renderBlockMarkdown(rawText) {
              const lines = String(rawText || "").replace(/\r\n/g, "\n").split("\n");
              const blocks = [];
              let paragraphLines = [];
              let unorderedItems = [];
              let orderedItems = [];

              function flushParagraph() {
                if (paragraphLines.length === 0) return;
                blocks.push(`<p>${paragraphLines.map(line => renderInlineText(line)).join("<br>")}</p>`);
                paragraphLines = [];
              }

              function flushUnorderedList() {
                if (unorderedItems.length === 0) return;
                blocks.push(`<ul>${unorderedItems.map(item => `<li>${renderInlineText(item)}</li>`).join("")}</ul>`);
                unorderedItems = [];
              }

              function flushOrderedList() {
                if (orderedItems.length === 0) return;
                blocks.push(`<ol>${orderedItems.map(item => `<li>${renderInlineText(item)}</li>`).join("")}</ol>`);
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

            function highlightCode(rawCode, language) {
              if (window.hljs) {
                try {
                  if (language && window.hljs.getLanguage && window.hljs.getLanguage(language)) {
                    return window.hljs.highlight(rawCode, { language }).value;
                  }
                  if (window.hljs.highlightAuto) {
                    return window.hljs.highlightAuto(rawCode).value;
                  }
                } catch (_) {}
              }

              const raw = rawCode || "";
              const lang = String(language || "").toLowerCase();
              const keywordPattern = /\b(import|final|class|struct|enum|func|var|let|return|if|else|for|while|guard|switch|case|break|continue|protocol|extension|async|await|try|catch|throw|private|public|internal|static|self|super|where|some|in|new|const|from|export|default|function|def|pass|none|nil|true|false|val|fun|package)\b/i;
              const typePattern = /\b(String|Int|Bool|Double|Float|Void|Any|Self|UIViewController|ObservableObject|Publisher|AnyCancellable|List|Map|Set|Optional)\b/;
              const tokenPattern = /(\/\/.*$|#.*$|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?\b|\$\{[^}]+\}|\$\w+|@[A-Za-z_][A-Za-z0-9_]*|\b[A-Z][A-Za-z0-9_]*\b|[\{\}\[\]\(\)\.,:=<>+\-/*%&|!?\^~]+)/gm;

              let html = "";
              let lastIndex = 0;
              let match;

              while ((match = tokenPattern.exec(raw)) !== null) {
                html += escapeHtml(raw.slice(lastIndex, match.index));
                const token = match[0];
                let className = "";

                if (token.startsWith("//") || token.startsWith("#") || token.startsWith("/*")) {
                  className = "token-comment";
                } else if (token.startsWith('"') || token.startsWith("'")) {
                  className = "token-string";
                } else if (/^\d/.test(token)) {
                  className = "token-number";
                } else if (token.startsWith("@") || token.startsWith("$")) {
                  className = "token-variable";
                } else if (/^[\{\}\[\]\(\)\.,:=<>+\-/*%&|!?\^~]+$/.test(token)) {
                  className = "token-symbol";
                } else if (keywordPattern.test(token)) {
                  className = "token-keyword";
                } else if (
                  typePattern.test(token) ||
                  (/^[A-Z]/.test(token) && ["swift", "javascript", "typescript", "python", "js", "ts", "kotlin", "java"].includes(lang))
                ) {
                  className = "token-type";
                }

                html += className ? `<span class="${className}">${escapeHtml(token)}</span>` : escapeHtml(token);
                lastIndex = match.index + token.length;
              }

              html += escapeHtml(raw.slice(lastIndex));
              return html;
            }

            function looksLikeFilePath(text) {
              if (!text || text.includes(" ")) return false;
              return /^(?:\.{1,2}\/|\/)?(?:[\w@.-]+\/)*[\w@.-]+\.[A-Za-z0-9]{1,10}$/.test(text);
            }

            function normalizedFileLabel(candidate) {
              const pathMatch = candidate.match(/^@@path\s+(.+)$/);
              if (pathMatch) return pathMatch[1].trim();

              const prefixedPathMatch = candidate.match(/^path:\s*(.+)$/);
              if (prefixedPathMatch) return prefixedPathMatch[1].trim();

              const trimmed = candidate.trim();
              return looksLikeFilePath(trimmed) ? trimmed : null;
            }

            function splitTrailingFileLabel(prefix) {
              const normalized = prefix.replace(/\r\n/g, "\n");
              const lines = normalized.split("\n");
              const lastIndex = [...lines.keys()].reverse().find(index => lines[index].trim().length > 0);
              if (lastIndex === undefined) {
                return { markdown: normalized, fileLabel: null };
              }

              const candidate = lines[lastIndex].trim();
              const fileLabel = normalizedFileLabel(candidate);
              if (!fileLabel) {
                return { markdown: normalized, fileLabel: null };
              }

              const trimmedLines = lines.slice();
              trimmedLines.splice(lastIndex, 1);
              return {
                markdown: trimmedLines.join("\n").trim(),
                fileLabel
              };
            }

            function segmentsFromRawText(rawText) {
              const source = sanitizeSource(rawText);
              if (!source) return [];

              const segments = [];
              const text = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
              let cursor = 0;

              while (true) {
                const fenceIndex = text.indexOf("```", cursor);
                if (fenceIndex === -1) break;

                const prefix = text.slice(cursor, fenceIndex);
                const { markdown, fileLabel } = splitTrailingFileLabel(prefix);
                if (markdown) {
                  segments.push({ type: "markdown", text: markdown });
                }

                let languageStart = fenceIndex + 3;
                let languageEnd = languageStart;
                while (languageEnd < text.length && text[languageEnd] !== "\n") {
                  languageEnd += 1;
                }

                let contentStart = languageEnd;
                if (contentStart < text.length && text[contentStart] === "\n") {
                  contentStart += 1;
                }

                const closingFence = text.indexOf("```", contentStart);
                if (closingFence === -1) {
                  segments.push({
                    type: "code",
                    fileLabel,
                    language: text.slice(languageStart, languageEnd).trim() || null,
                    code: text.slice(contentStart),
                    pending: true
                  });
                  cursor = text.length;
                  break;
                }

                segments.push({
                  type: "code",
                  fileLabel,
                  language: text.slice(languageStart, languageEnd).trim() || null,
                  code: text.slice(contentStart, closingFence),
                  pending: false
                });
                cursor = closingFence + 3;
              }

              if (cursor < text.length) {
                const tail = text.slice(cursor).trim();
                if (tail) {
                  segments.push({ type: "markdown", text: tail });
                }
              }

              return segments;
            }

            function renderAssistantContent(rawText) {
              const segments = segmentsFromRawText(rawText);
              return segments.map(segment => {
                if (segment.type === "markdown") {
                  return renderBlockMarkdown(segment.text);
                }

                const languageLabel = segment.language ? escapeHtml(segment.language.toUpperCase()) : "CODE";
                const statusLabel = segment.pending ? '<span class="block-status">Streaming</span>' : "";
                const fileLabel = segment.fileLabel ? `<div class="code-file-label">${escapeHtml(segment.fileLabel)}</div>` : "";
                const codeHtml = highlightCode(segment.code.replace(/\n$/, ""), segment.language);
                return `${fileLabel}${renderCopyableBlock(
                  `<pre><code class="language-${escapeHtml(segment.language || "plain")}">${codeHtml}</code></pre>`,
                  segment.code,
                  languageLabel,
                  "code",
                  statusLabel
                )}`;
              }).join("");
            }

            function renderUserMessage(text) {
              return `<div class="user-bubble">${escapeHtml(text)}</div>`;
            }

            function renderAssistantMessage(text) {
              return `<div class="assistant-content">${renderAssistantContent(text)}</div>`;
            }

            function renderPendingRow(label) {
              return `
                <div class="message-row pending">
                  <div class="assistant-content">
                    <div class="pending-row">
                      ${thinkingDots()}
                      <span>${escapeHtml(label || "Thinking...")}</span>
                    </div>
                  </div>
                </div>`;
            }

            function renderEmptyState() {
              return `
                <div class="empty-state">
                  <div>
                    <h2>Start a sharper local conversation</h2>
                    <p>Choose a model on the left, keep the thread in the center, and use the right inspector only when you want to tune generation.</p>
                  </div>
                </div>`;
            }

            function renderMessage(message) {
              const role = message.role === "user" ? "user" : "assistant";
              const inner = role === "user"
                ? renderUserMessage(message.text)
                : renderAssistantMessage(message.text);
              return `<div class="message-row ${role}" data-message-id="${escapeHtml(message.id)}">${inner}</div>`;
            }

            function renderChat(payload, shouldScroll) {
              const root = document.getElementById("transcript");
              if (!root) return;

              const messages = Array.isArray(payload.messages) ? payload.messages : [];
              if (messages.length === 0) {
                root.innerHTML = renderEmptyState();
              } else {
                let html = '<div class="conversation">';
                for (const message of messages) {
                  html += renderMessage(message);
                }
                if (payload.showPendingIndicator) {
                  html += renderPendingRow(payload.requestStateText);
                }
                html += '</div>';
                root.innerHTML = html;
              }

              if (shouldScroll) {
                window.requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "auto" }));
              }
            }

            function renderChatFromBase64(base64, shouldScroll) {
              const payload = JSON.parse(decodeBase64UTF8(base64));
              renderChat(payload, shouldScroll);
            }

            document.addEventListener("click", event => {
              const button = event.target.closest("[data-copy-id]");
              if (!button) return;
              const payload = copyPayloads.get(button.dataset.copyId) || "";
              window.webkit.messageHandlers.copy.postMessage(payload);
              const original = button.textContent;
              button.textContent = "Copied";
              button.disabled = true;
              window.setTimeout(() => {
                button.textContent = original;
                button.disabled = false;
              }, 1200);
            });

            window.renderChatFromBase64 = renderChatFromBase64;
            window.__chatRendererReady = true;
          </script>
        </body>
        </html>
        """#

        private weak var webView: WKWebView?
        private var didFinishInitialLoad = false
        private var pendingScript: String?

        func attach(_ webView: WKWebView) {
            self.webView = webView
        }

        fileprivate func render(_ payload: TranscriptPayload, in webView: WKWebView) {
            guard let data = try? JSONEncoder().encode(payload) else {
                return
            }

            let base64 = data.base64EncodedString()
            let script = "window.renderChatFromBase64('\(base64)', true);"

            guard didFinishInitialLoad else {
                pendingScript = script
                return
            }

            webView.evaluateJavaScript(script)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            didFinishInitialLoad = true

            if let pendingScript {
                webView.evaluateJavaScript(pendingScript)
                self.pendingScript = nil
            }
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == Self.copyHandlerName, let text = message.body as? String else {
                return
            }

            let pasteboard = NSPasteboard.general
            pasteboard.clearContents()
            pasteboard.setString(text, forType: .string)
        }

        @MainActor
        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
        ) {
            if let url = navigationAction.request.url,
               ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
               navigationAction.navigationType == .linkActivated {
                NSWorkspace.shared.open(url)
                decisionHandler(.cancel)
                return
            }

            decisionHandler(.allow)
        }
    }
}

private struct TranscriptPayload: Encodable {
    let messages: [TranscriptMessage]
    let showPendingIndicator: Bool
    let requestStateText: String
}

private struct TranscriptMessage: Encodable {
    let id: String
    let role: String
    let text: String

    init(_ message: ConversationMessage) {
        id = message.id.uuidString
        role = message.role.rawValue
        text = message.text
    }
}
