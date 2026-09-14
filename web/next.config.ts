import type { NextConfig } from "next";

// Static export: the FastAPI relay serves web/out, so the dashboard and /ws share one origin and one URL.
const nextConfig: NextConfig = { output: "export" };

export default nextConfig;
