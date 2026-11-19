export function fromNodeRequest(req) {
  let body = req.body ?? {};
  if (typeof body === "string") {
    try {
      body = body ? JSON.parse(body) : {};
    } catch {
      body = { __invalidJson: true };
    }
  }
  const host = req.headers?.["x-forwarded-host"] || req.headers?.host || "localhost";
  const url = new URL(req.url || "/", `http://${host}`);
  return {
    method: req.method,
    query: { ...Object.fromEntries(url.searchParams), ...(req.query || {}) },
    headers: req.headers || {},
    body
  };
}
