import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Content-Security-Policy is only applied to production builds: the dev server
// needs eval for fast refresh. Next.js hydration relies on inline scripts, so
// 'unsafe-inline' is required for script-src without a nonce-based setup.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(isProd ? [{ key: "Content-Security-Policy", value: csp }] : []),
];

const nextConfig: NextConfig = {
  // Cache Components is intentionally off: every screen is authenticated and
  // loads data client-side through the typed API, so request-time rendering is
  // the simpler and more predictable model for this application.
  cacheComponents: false,
  poweredByHeader: false,
  // PGlite ships WASM + data files resolved relative to its own module URL and
  // must not be bundled. `pg` and `nodemailer` are Node-only.
  serverExternalPackages: ["@electric-sql/pglite", "pg", "nodemailer"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
