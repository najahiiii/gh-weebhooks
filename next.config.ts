import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["git.jp.eu.org", "dev-staging.najahi.dev"],
  poweredByHeader: false,
};

export default nextConfig;