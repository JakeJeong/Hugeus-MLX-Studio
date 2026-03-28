# MLX Studio VS Code Extension

Minimal MVP webview for chatting with the local MLX Studio runtime from inside VS Code.

## What it does

- Connects to the local FastAPI server at `http://127.0.0.1:8010`
- Streams chat responses into a VS Code webview
- Shows current model and runtime status
- Lets you switch between local MLX and GGUF models from the bottom toolbar
- Lets you attach the active file or current selection as chat context
- Includes a Vibe mode that treats one attached context item as the edit target and keeps the rest as reference files
- Applies generated code back to the selected file or selection range from the chat
- Auto-applies Vibe edit responses to the current target file when it is safe to do so
- Can save a generated code block as a brand new file with `Create File`
- Can auto-create a new file inside a chosen workspace folder in Vibe mode

## Commands

- `MLX Studio: Open Chat`
- `MLX Studio: Open Chat Panel`
- `MLX Studio: Start Local Server`
- `MLX Studio: Add Active File To Chat`
- `MLX Studio: Add Selection To Chat`

## Local setup

1. Start the backend from the workspace root:

   ```bash
   ./scripts/ui.sh --port 8010
   ```

2. Open the `vscode-extension` folder in VS Code as an extension project, or use `Run Extension`.
3. Use `MLX Studio: Open Chat Panel` to open the chat beside the editor, or open the `MLX Studio` activity bar view.

## Vibe workflow

1. Attach the active file or a selection.
2. Click a context chip to mark it as the edit target.
3. Toggle `⚡ Vibe`.
4. Describe the change you want.
5. Use `Apply` on the assistant response to write the generated code back into the file.

If no explicit target is attached, Vibe mode falls back to the current visible editor.

## Create new files

1. Click `+ Folder` and choose a workspace folder.
2. Toggle `⚡ Vibe`.
3. Ask for a new file such as `docs/about-me.md 만들어줘` or `이 폴더에 자기소개 md 파일 만들어줘`.
4. The extension will try to create the file automatically inside that folder.

## Settings

- `mlxStudio.serverUrl`
- `mlxStudio.maxContextChars`
