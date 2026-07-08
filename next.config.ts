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
  async rewrites() {
    return {
      // Must run in beforeFiles: the clean API paths ("/banks", "/changelog")
      // are identical in shape to real pages (app/banks, app/changelog), and
      // the default afterFiles phase checks real routes first — the existing
      // page would always win before this rewrite ever got a chance to apply.
      beforeFiles: [
        // api.instantrailcheck.com/banks -> /api/banks, same deployment,
        // same routes. Purely additive — the original /api/* paths on the
        // main domain keep working, so nothing already integrated breaks.
        // (This also maps .../robots.txt -> /api/robots.txt, which is a real
        // route below — a subdomain is a separate origin and doesn't inherit
        // the main domain's robots.txt, so without one here it would default
        // to "everything's crawlable.")
        {
          source: "/:path*",
          has: [{ type: "host", value: "api.instantrailcheck.com" }],
          destination: "/api/:path*",
        },
      ],
    };
  },
};

export default nextConfig;
