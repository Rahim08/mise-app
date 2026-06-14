import type { CapacitorConfig } from '@capacitor/cli';

// Hybrid model: the native iOS shell loads the live Next.js app (SSR + API + middleware
// stay on Vercel). `webDir` is only an offline fallback shown when the device is offline.
// To point at a different environment, change `server.url` (e.g. https://misesuite.com).
const config: CapacitorConfig = {
  appId: 'app.getmise.mise',
  appName: 'Mise',
  webDir: 'capacitor-www',
  server: {
    url: 'https://mise-app-omega.vercel.app',
    cleartext: false,
  },
  ios: {
    contentInset: 'always',
    limitsNavigationsToAppBoundDomains: false,
  },
};

export default config;
