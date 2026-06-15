import type { CapacitorConfig } from '@capacitor/cli';

// Hybrid model: the native iOS shell loads the live Next.js app (SSR + API + middleware
// stay on Vercel). `webDir` is only an offline fallback shown when the device is offline.
// To point at a different environment, change `server.url` (e.g. https://misesuite.com).
const config: CapacitorConfig = {
  appId: 'com.misesuite.app',
  appName: 'Mise',
  webDir: 'capacitor-www',
  // Метка в User-Agent — надёжный признак «мы внутри приложения» (lib/native.ts),
  // не зависит от готовности Capacitor-моста при загрузке внешнего URL.
  appendUserAgent: 'MiseApp',
  server: {
    // Грузим www напрямую: apex misesuite.com отдаёт 308-редирект, на котором
    // WKWebView рвёт загрузку главного фрейма («Frame load interrupted», code 102)
    // и не инициализирует Capacitor-мост.
    url: 'https://www.misesuite.com',
    cleartext: false,
  },
  ios: {
    contentInset: 'always',
    limitsNavigationsToAppBoundDomains: false,
  },
};

export default config;
