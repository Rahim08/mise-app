import type { NextConfig } from "next";

// Security headers applied to every response.
//
// Notes for this app specifically:
//  • The landing page is embedded same-origin via <iframe> in app/page.tsx, so
//    X-Frame-Options stays SAMEORIGIN (not DENY).
//  • The QR scanner needs the camera and the staff layer needs geolocation, so
//    Permissions-Policy allows camera/geolocation for self only.
//  • No strict CSP yet — a real CSP needs auditing against Supabase, Stripe,
//    Gemini and Google Fonts origins. Tracked in docs/LAUNCH-READINESS.md.
const securityHeaders = [
  // Force HTTPS for two years incl. subdomains (safe once on a custom domain / vercel.app).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Block MIME-type sniffing.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Allow framing only from same origin (landing iframe), block external clickjacking.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Don't leak full URLs to third parties.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Grant only the device capabilities the app actually uses.
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=(), payment=(self)" },
  // Isolate the browsing context a bit (helps against cross-origin leaks).
  { key: "X-DNS-Prefetch-Control", value: "on" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
