import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// Link preview (Telegram/WhatsApp/iMessage/X) for the whole site — 1200×630 instead of
// the square app icon. LiberationSans (OFL) is bundled because the default OG font
// has no Cyrillic glyphs.
export const alt = 'Mise — платформа управления рестораном'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const MODULES: [string, string][] = [
  ['Касса', '#007aff'],
  ['Аналитика', '#34c759'],
  ['Склад', '#ff9500'],
  ['Команда', '#5e5ce6'],
  ['QR-меню', '#ff2d55'],
]

export default async function Image() {
  const [bold, regular] = await Promise.all([
    readFile(join(process.cwd(), 'assets/fonts/LiberationSans-Bold.ttf')),
    readFile(join(process.cwd(), 'assets/fonts/LiberationSans-Regular.ttf')),
  ])
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '64px 76px', background: 'radial-gradient(circle at 85% 15%, #1d1a4a 0%, #000 55%)', color: '#fff', fontFamily: 'Liberation Sans' }}>
        <div style={{ display: 'flex', fontSize: 52, fontWeight: 700, letterSpacing: -2 }}>
          <span>mis</span><span style={{ color: '#8e8e93' }}>e</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 84, fontWeight: 700, letterSpacing: -3, lineHeight: 1.04 }}>
          <span>Весь ресторан.</span>
          <span style={{ color: '#a1a1a6' }}>Одна платформа.</span>
          <span style={{ color: '#6e6bff' }}>Полный контроль.</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 26, fontWeight: 400 }}>
          <div style={{ display: 'flex', gap: 26 }}>
            {MODULES.map(([name, color]) => (
              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'rgba(255,255,255,.75)' }}>
                <div style={{ width: 12, height: 12, borderRadius: 6, background: color }} />
                {name}
              </div>
            ))}
          </div>
          <span style={{ color: 'rgba(255,255,255,.5)' }}>misesuite.com</span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Liberation Sans', data: bold, style: 'normal', weight: 700 },
        { name: 'Liberation Sans', data: regular, style: 'normal', weight: 400 },
      ],
    },
  )
}
