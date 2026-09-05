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
};

export default nextConfig;
