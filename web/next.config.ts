import type { NextConfig } from "next";

// Static export: the FastAPI relay serves web/out, so the dashboard and /ws share one origin and one URL.
// trailingSlash: StaticFiles(html=True) resolves "/history/" to "history/index.html" but does not guess
// "/history" -> "history.html" -- verified live, the latter 404s. Exporting with a trailing slash on every
// nested route matches what the server actually serves.
const nextConfig: NextConfig = { output: "export", trailingSlash: true };

export default nextConfig;
