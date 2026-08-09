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
  // CSP frame-ancestors is the modern replacement; kept for older browsers.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Don't leak full URLs to third parties.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Grant only the device capabilities the app actually uses.
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=(), payment=(self)" },
  // Isolate the browsing context a bit (helps against cross-origin leaks).
  { key: "X-DNS-Prefetch-Control", value: "on" },
  // Content Security Policy — restricts sources for scripts, styles, images, etc.
  // Inline styles are needed because all page components use style={{}} objects.
  { key: "Content-Security-Policy", value: [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://*.vercel-scripts.com https://js.stripe.com https://*.googletagmanager.com https://*.google-analytics.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https://*.supabase.co https://*.googleusercontent.com",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self' https://*.supabase.co https://api.resend.com https://api.stripe.com https://api.groq.com https://*.posthog.com",
    "frame-src 'self' https://js.stripe.com https://*.supabase.co",
    "frame-ancestors 'self'",
  ].join('; ') },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // APNs-ключ прод берёт из env APNS_AUTH_KEY (Vercel). Файл-фолбэк в lib/apns.ts —
  // только для локальной отладки пушей; .p8 в git нет и в бандл никогда не попадал,
  // поэтому outputFileTracingIncludes для него удалён (2026-07-18).
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Статические дубли-страницы в public/: /landing.html рендерится внутри iframe на «/»
      // (canonical уже указывает туда) и сам по себе индексировался как дубликат; остальные —
      // заброшенные версии секций сайта (mise-landing-v2 — старый лендинг с ценой €9 от июня,
      // manager/analytics/tobacco.html — старые одностраничники) без canonical и без ссылок
      // из текущей навигации, но доступные по прямому URL и не закрытые в robots.ts (тот
      // блокирует только /manager /analytics /tobacco — роуты приложения, не эти .html-файлы).
      { source: "/landing.html", headers: [{ key: "X-Robots-Tag", value: "noindex" }] },
      { source: "/mise-landing-v2.html", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/manager.html", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/analytics.html", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/tobacco.html", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
  async redirects() {
    return [
      { source: "/privacy", destination: "/privacy.html", permanent: false },
      { source: "/terms", destination: "/terms.html", permanent: false },
      { source: "/about", destination: "/about.html", permanent: false },
      { source: "/support", destination: "/support.html", permanent: false },
      { source: "/contact", destination: "/contact.html", permanent: false },
    ];
  },
};

export default nextConfig;
