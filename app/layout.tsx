import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist } from "next/font/google";
import { ErrorReporter } from "@/components/ErrorReporter";
import { CookieConsent } from "@/components/CookieConsent";
import { Analytics } from "@/components/Analytics";
import { OfflineBanner } from "@/components/OfflineBanner";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://misesuite.com"),
  title: { default: "Mise", template: "%s · Mise" },
  description: "Mise — система управления рестораном: кассовые смены, аналитика, склад, команда и QR-меню в одном приложении.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Mise" },
  openGraph: {
    type: "website",
    siteName: "Mise",
    title: "Mise — управление рестораном",
    description: "Кассовые смены, аналитика, склад, команда и QR-меню в одном приложении.",
    images: [{ url: "/icons/icon-512.png", width: 512, height: 512, alt: "Mise" }],
  },
  twitter: {
    card: "summary",
    title: "Mise — управление рестораном",
    description: "Кассовые смены, аналитика, склад, команда и QR-меню в одном приложении.",
    images: ["/icons/icon-512.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className={`${geistSans.variable} h-full antialiased`}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="theme-color" content="#f2f2f7" />
      </head>
      <body className="min-h-full flex flex-col">
        <ErrorReporter />
        <OfflineBanner />
        <ImpersonationBanner />
        {children}
        <CookieConsent />
        <Suspense fallback={null}><Analytics /></Suspense>
      </body>
    </html>
  );
}
