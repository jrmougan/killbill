import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  // Optimize for production
  poweredByHeader: false,

  // Handle Prisma in serverless/Docker
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client"],
  },
};

export default nextConfig;
