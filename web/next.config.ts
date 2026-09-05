import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // contracts ships raw .ts; let Next compile it
  transpilePackages: ["@campaign-commons/contracts"],
  // data/out lives outside web/; include it in the server bundle so file reads work on Vercel
  outputFileTracingRoot: path.join(__dirname, ".."),
  outputFileTracingIncludes: {
    "/**": ["../data/out/**/*"],
  },
  // contracts is symlinked (file:../contracts) and has no node_modules of its own;
  // resolve its imports (zod) through web/node_modules instead of the realpath
  webpack: (config) => {
    config.resolve.symlinks = false;
    return config;
  },
};

export default nextConfig;
