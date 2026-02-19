export function getApiBase() {
  const raw = (
    window.__API_BASE ||
    import.meta.env.VITE_API_BASE ||
    import.meta.env.API_BASE ||
    "/api"
  ).replace(/\/$/, "");

  return raw.endsWith("/api") ? raw : `${raw}/api`;
}

