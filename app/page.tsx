import type { Metadata } from 'next'
import Script from 'next/script'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HomeBehavior } from './home-behavior'

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
}

export default function Home() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <div className="landing-root" dangerouslySetInnerHTML={{ __html: markup }} />
      <Script id="mise-landing-interactions" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: interactions }} />
      <HomeBehavior />
    </>
  )
}
