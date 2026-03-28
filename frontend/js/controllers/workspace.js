import { api } from "../api.js?v=20260328-2";
import { renderContextFiles, renderPreview, renderWorkspaceFiles, updatePreviewAction } from "../render.js?v=20260328-2";
import { elements, state } from "../state.js?v=20260328-2";

export async function refreshWorkspaceFiles() {
  const query = elements.fileSearchInput.value.trim();
  const payload = await api(`/api/workspace/files?query=${encodeURIComponent(query)}`);
  renderWorkspaceFiles(payload.files);
}

export async function openWorkspaceFile(path) {
  elements.requestState.textContent = `Opening ${path}...`;
  const payload = await api("/api/workspace/file", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
  state.selectedFile = payload;
  renderPreview(payload);
  updatePreviewAction();
  await refreshWorkspaceFiles();
  elements.requestState.textContent = `${path} ready.`;
}

export function handleContextRemove(path) {
  state.contextFiles.delete(path);
  renderContextFiles(handleContextRemove);
  updatePreviewAction();
}

export function toggleSelectedFileContext() {
  const file = state.selectedFile;
  if (!file) {
    return;
  }
  if (state.contextFiles.has(file.path)) {
    state.contextFiles.delete(file.path);
  } else {
    state.contextFiles.set(file.path, file);
  }
  renderContextFiles(handleContextRemove);
  updatePreviewAction();
}
