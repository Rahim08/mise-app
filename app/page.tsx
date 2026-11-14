import type { Metadata } from 'next'
import Script from 'next/script'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HomeBehavior } from './home-behavior'
import { PLANS } from '@/lib/plans'

// The public landing remains the source of its markup and translations. Render
// the same content here so the root URL has useful server-generated HTML.
const landing = readFileSync(join(process.cwd(), 'public/landing.html'), 'utf8')
const part = (start: string, end: string) => {
  const from = landing.indexOf(start)
  const to = landing.indexOf(end, from + start.length)
  if (from < 0 || to < 0) throw new Error(`Missing landing section: ${start}`)
  return landing.slice(from + start.length, to)
}
const styles = part('<style>', '</style>')
const markup = part('<body>', '<script>')
const interactions = part('<script>', '</script>')

export const metadata: Metadata = {
  title: 'Mise — платформа управления рестораном',
  description: 'Кассовые смены, аналитика, склад, команда и QR-меню в одной платформе для ресторана. 14 дней бесплатно.',
  alternates: { canonical: '/' },
  // Smart App Banner in iOS Safari → the App Store listing (Mise Control).
  itunes: { appId: '6781283801' },
}

// Structured data for rich results. Prices mirror lib/plans.ts.
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': 'https://www.misesuite.com/#org',
      name: 'Mise',
      url: 'https://www.misesuite.com/',
      logo: 'https://www.misesuite.com/icons/icon-512.png',
    },
    {
      '@type': 'SoftwareApplication',
      name: 'Mise',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'iOS, Web',
      url: 'https://www.misesuite.com/',
      installUrl: 'https://apps.apple.com/app/id6781283801',
      publisher: { '@id': 'https://www.misesuite.com/#org' },
      offers: Object.values(PLANS).map(p => ({
        '@type': 'Offer', name: p.name, price: p.price, priceCurrency: 'EUR',
      })),
    },
  ],
}

export default function Home() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <div className="landing-root" dangerouslySetInnerHTML={{ __html: markup }} />
      <Script id="mise-landing-interactions" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: interactions }} />
      <HomeBehavior />
    </>
  )
}
