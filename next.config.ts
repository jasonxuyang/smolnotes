import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // COOP/COEP for WebLLM SharedArrayBuffer support in Chromium.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "credentialless",
          },
        ],
      },
    ];
  },
  turbopack: {},
};

export default nextConfig;
