# MLX Studio VS Code Extension

VS Code webview extension for chatting with a local MLX Studio runtime and turning model output into workspace actions.

This folder is now being developed as a focused, git-backed extension workspace rather than a throwaway MVP. The current implementation already supports chat, file attachment, automatic file creation, automatic edit application, and a lighter "vibe coding" workflow inside VS Code.

## Overview

The extension currently covers four practical loops:

- Ask the local model normal questions in a side-panel chat
- Attach workspace files with `@` search or the active editor
- Apply code-style responses back into a target file
- Create new files directly inside the workspace from model output

It is designed around a simple idea: the model does not write files directly. Instead, the extension watches for specific output shapes and then performs safe VS Code actions on the user's behalf.

## Current Development Snapshot

Implemented and working in the current codebase:

- Local chat UI connected to the MLX Studio FastAPI backend at `http://127.0.0.1:8010`
- Activity bar view with runtime status, model selection, and composer actions
- Workspace file attachment from the active editor
- `@`-based workspace file search and attach flow
- Target file selection through context chips
- Auto mode that can interpret edit/create responses without depending entirely on the `⚡ Vibe` toggle
- `⚡ Vibe` mode for stronger edit-oriented prompting
- Auto-apply to the current target when the model returns a clean standalone fenced block
- Auto-create files when the model returns the file-creation protocol
- Inline confirmation near the composer before creating missing folders
- Response-level copy plus per-block copy for code and markdown sections
- Better streaming rendering for markdown/code blocks and less aggressive auto-scroll behavior
- Internal protocol markers such as `@@path ...` hidden from normal chat rendering

## Repo Layout

Current repository structure:

```text
vscode-extension/
├── extension.js
├── package.json
├── README.md
├── media/
│   ├── icon.svg
│   ├── main.css
│   └── main.js
├── .vscode/
│   └── launch.json
└── .claude/
    └── settings.json
```

What each part is responsible for:

- `extension.js`: extension entrypoint, webview provider, protocol parsing, file actions, command registration
- `media/main.js`: webview UI behavior, rendering, streaming updates, copy actions, mention search interactions
- `media/main.css`: webview layout and styling
- `package.json`: extension manifest, commands, settings, activity bar view registration
- `.vscode/launch.json`: Extension Host launch configuration for local development

There is currently no build step. The extension runs as plain JavaScript.

## Response Protocols

The extension currently relies more on output protocol detection than on large keyword-based intent rules.

### 1. Normal chat

- If the response is plain conversational text, it stays as chat only
- No file action is triggered

### 2. Edit candidate

- If the model returns a single standalone fenced code block
- and there is an attached target file
- the extension can treat that response as an edit candidate

In auto mode, the extension only applies edits when the output shape is clear enough.

### 3. Create-file candidate

If the model returns a path marker like:

`@@path docs/about.md`

followed by a fenced code block containing the full file contents, the extension treats that response as a file creation action.

Example:

```text
@@path docs/about.md
```

```md
# About

Sample markdown file.
```

The extension then resolves the path inside the selected workspace folder, confirms missing intermediate folders inline when needed, and writes the file through VS Code APIs.

## Main User Flows

### Ask a normal question

- Open the MLX Studio panel
- Send a message normally
- The assistant responds as chat unless the output is clearly edit-shaped or create-file-shaped

### Attach a workspace file with `@`

- Type `@` in the composer
- Search by filename or partial path
- Choose a file with the keyboard or mouse
- The selected file is attached as a context chip

The `@ Files` button opens the same flow directly.

### Edit a target file

- Attach a file with `@ Files` or from the active editor
- Make that file the active target
- Ask for a change
- If the model answers with a clean standalone code block, the extension can auto-apply it to that target

`⚡ Vibe` still exists, but it is no longer the only way to get action-oriented behavior.

### Create a new file

- Optionally choose a folder with `+ Folder`
- Ask for a file such as `docs/about.md 만들어줘`
- Or ask more loosely for something like `SwiftUI 기본 샘플 파일 만들어줘`
- If the model returns the creation protocol, the extension creates the file automatically

If intermediate folders do not exist yet, the extension asks for confirmation inline near the composer instead of showing a blocking full-screen-style modal flow.

## UI Notes

Current composer / footer capabilities include:

- `+ File`: attach the active editor file
- `@ Files`: search and attach a workspace file
- `+ Folder`: choose the default folder for new file generation
- Model switcher: choose between available local models
- `⚡ Vibe`: strengthen edit-focused prompting
- `Clear`: reset the current chat view

Response rendering also includes:

- Copy for the full assistant response
- Copy for individual code or markdown blocks
- Streaming-friendly markdown and code presentation
- Hidden internal protocol lines such as `@@path ...`

## Commands

Available command palette commands:

- `MLX Studio: Open Chat`
- `MLX Studio: Open Chat Panel`
- `MLX Studio: Start Local Server`
- `MLX Studio: Add Active File To Chat`
- `MLX Studio: Add Selection To Chat`

The command set still includes selection-based attachment, even though the current composer UX is more focused on `@ Files`.

## Settings

Available extension settings:

- `mlxStudio.serverUrl`
- `mlxStudio.maxContextChars`

Defaults from `package.json`:

- `mlxStudio.serverUrl`: `http://127.0.0.1:8010`
- `mlxStudio.maxContextChars`: `12000`

## Local Development

1. Start the backend from the project root that contains the MLX Studio server:

   ```bash
   ./scripts/ui.sh --port 8010
   ```

2. Open this `vscode-extension` folder in VS Code.
3. Run the launch configuration from `.vscode/launch.json`:

   - `Run MLX Studio Extension`

4. In the Extension Host window, open:

   - `MLX Studio: Open Chat Panel`

## Recent Progress

This README reflects the state after several practical workflow upgrades:

- The UI moved from a basic local chat panel toward an action-capable editing workflow
- File creation can now write directly into the workspace instead of stopping at copy-paste output
- Missing-folder confirmation moved into the chat area rather than using disruptive modal prompts
- File attachment is now faster through `@` mentions and workspace search
- Rendering feels more natural during streaming, especially for markdown and code blocks
- Internal action markers are no longer exposed as noisy user-facing text
- The extension now depends less on brittle language-specific intent keyword lists and more on output structure

## Known Limitations

- Most extension-side logic still lives in `extension.js`, so modular refactoring is still needed
- Output reliability depends heavily on the local model following the expected protocol cleanly
- Multi-file planning, diff preview, and richer tool-use loops are not implemented yet
- Auto-actions are intentionally conservative when the model output is ambiguous

## Next Good Refactors

The next structural improvements that would pay off the most are:

- Split `extension.js` into smaller provider, protocol, and file-action modules
- Add more robust retry / repair logic when the model almost follows the expected protocol
- Add diff preview or approval UI before applying larger edits
- Support more agent-like multi-file workflows without losing safety
