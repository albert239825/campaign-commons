import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // contracts ships raw .ts; let Next compile it
  transpilePackages: ["@citizen-gotham/contracts"],
  // data/out lives outside web/; include it in the server bundle so file reads work on Vercel
  outputFileTracingRoot: path.join(__dirname, ".."),
  outputFileTracingIncludes: {
    "/**": ["../data/out/**/*"],
  },
  // contracts is symlinked (file:../contracts) and has no node_modules of its own;
  // let its imports (zod) fall back to web/node_modules. Keep symlink resolution on
  // so webpack sees contracts at its real path (not node_modules/, which the build
  // cache treats as immutable and would serve stale).
  webpack: (config) => {
    config.resolve.modules = [
      ...(config.resolve.modules ?? ["node_modules"]),
      path.join(__dirname, "node_modules"),
    ];
    return config;
  },
};

export default nextConfig;
