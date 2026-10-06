import type { NextConfig } from "next";

/**
 * Baseline security headers applied to every response.
 *
 * Deliberately NO script/style CSP: a strict `script-src` breaks Next's inline
 * bootstrap scripts unless nonces are wired through the proxy. The CSP below
 * only carries directives that cannot affect script execution (framing, base
 * URI and plugins).
 */
const SECURITY_HEADERS = [
  // Production is HTTPS-only behind Traefik. No `preload`: that is a manual,
  // hard-to-revert commitment for the whole domain.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Clickjacking: legacy header + its CSP successor.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  // Camera stays allowed for this origin (receipt capture); everything else the
  // app never uses is switched off.
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",

  // Optimize for production
  poweredByHeader: false,

  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
