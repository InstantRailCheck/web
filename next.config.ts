import type { NextConfig } from "next";

// Content-Security-Policy is set per-request in proxy.ts instead (it needs a
// fresh nonce every request — a static CSP here would combine with it via
// header intersection and strip the nonce/strict-dynamic exception right back out).
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  async redirects() {
    return [
      // RFC 9116 requires the file to live under /.well-known/, but
      // recommends redirecting the legacy top-level path for older scanners.
      {
        source: "/security.txt",
        destination: "/.well-known/security.txt",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
