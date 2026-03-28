export async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ detail: "Request failed" }));
    throw new Error(payload.detail || "Request failed");
  }

  return response.json();
}

export async function readError(response, fallback) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const payload = await response.json().catch(() => ({}));
    const detail = payload.detail || fallback;
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      const first = payload.errors[0];
      const path = Array.isArray(first.loc) ? first.loc.join(".") : "request";
      return `${detail}: ${path} ${first.msg}`;
    }
    return detail;
  }
  const text = await response.text().catch(() => "");
  return text || fallback;
}
