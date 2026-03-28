export function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderMarkdown(text) {
  const source = text || "";
  const fencePattern = /```([\w+-]*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let html = "";
  let match;

  while ((match = fencePattern.exec(source)) !== null) {
    html += renderMarkdownParagraphs(source.slice(lastIndex, match.index));
    html += renderCodeBlock(match[2].replace(/\n$/, ""), match[1], false);
    lastIndex = match.index + match[0].length;
  }

  html += renderTrailingMarkdown(source.slice(lastIndex));
  return html.trim() || "<p></p>";
}

function renderTrailingMarkdown(text) {
  const trailing = text || "";
  const openIndex = trailing.indexOf("```");
  if (openIndex === -1) {
    return renderMarkdownParagraphs(trailing);
  }

  const before = renderMarkdownParagraphs(trailing.slice(0, openIndex));
  const partialFence = trailing.slice(openIndex).match(/^```([\w+-]*)\n?([\s\S]*)$/);
  if (!partialFence) {
    return before + renderMarkdownParagraphs(trailing.slice(openIndex));
  }

  return before + renderCodeBlock(partialFence[2], partialFence[1], true);
}

function renderCodeBlock(rawCode, language, isPending) {
  const languageLabel = language
    ? `<span class="code-language">${escapeHtml(language)}</span>`
    : "<span class=\"code-language\">code</span>";
  const status = isPending ? "<span class=\"code-status\">Streaming</span>" : "";
  const codeHtml = highlightCode(rawCode, language);

  return `
    <div class="code-block${isPending ? " pending" : ""}">
      <div class="code-block-header">
        <div class="code-meta">
          ${languageLabel}
          ${status}
        </div>
        <button class="code-copy-button" type="button">Copy</button>
      </div>
      <pre><code>${codeHtml}</code></pre>
    </div>
  `;
}

function highlightCode(code, language) {
  const raw = code || "";
  const lang = (language || "").toLowerCase();
  const keywordPattern = /\b(import|final|class|struct|enum|func|var|let|return|if|else|for|while|guard|switch|case|break|continue|protocol|extension|async|await|try|catch|throw|private|public|internal|static|self|super|where|some|in|new|const|from|export|default|function|def|pass|None|nil|true|false)\b/;
  const typePattern = /\b(String|Int|Bool|Double|Float|Void|Any|Self|UIViewController|ObservableObject|Publisher|AnyCancellable)\b/;
  const tokenPattern =
    /(\/\/.*$|#.*$|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?\b|\b[A-Z][A-Za-z0-9_]*\b|\b[a-z_][A-Za-z0-9_]*\b)/gm;

  let html = "";
  let lastIndex = 0;
  let match;

  while ((match = tokenPattern.exec(raw)) !== null) {
    html += escapeHtml(raw.slice(lastIndex, match.index));
    const token = match[0];
    let className = "";

    if (token.startsWith("//") || token.startsWith("#") || token.startsWith("/*")) {
      className = "token-comment";
    } else if (token.startsWith("\"") || token.startsWith("'")) {
      className = "token-string";
    } else if (/^\d/.test(token)) {
      className = "token-number";
    } else if (keywordPattern.test(token)) {
      className = "token-keyword";
    } else if (
      typePattern.test(token) ||
      (/^[A-Z]/.test(token) && ["swift", "javascript", "typescript", "python", "js", "ts"].includes(lang))
    ) {
      className = "token-type";
    }

    html += className ? `<span class="${className}">${escapeHtml(token)}</span>` : escapeHtml(token);
    lastIndex = match.index + token.length;
  }

  html += escapeHtml(raw.slice(lastIndex));
  return html;
}

function renderMarkdownParagraphs(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed
    .split(/\n{2,}/)
    .map((block) => `<p>${renderInlineMarkdown(block)}</p>`)
    .join("");
}

function renderInlineMarkdown(text) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/\n/g, "<br>");
  return html;
}
