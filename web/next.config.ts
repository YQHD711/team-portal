import type { NextConfig } from "next";

// Server-side env only (rewrites never reach the browser) — non-NEXT_PUBLIC_ to keep it out of the client bundle.
const apiUrl = process.env.API_PROXY_URL || "http://localhost:8080";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
