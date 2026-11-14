import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// Importing the shared UI also imports the authenticated Supabase singleton.
// Rendering a report does not use that client or require a live session.
vi.mock('@/lib/supabase', () => ({ supabase: {} }))

import { AuditReportSheet } from './audits'

const props = {
  audit: { title: 'Opening checklist', items: [] },
  completion: { items_state: [] }, staff: [], accent: '#5856d6', t: {}, onClose() {},
}

describe('audit report export permission', () => {
  it('keeps the report readable without exposing PDF export to staff', () => {
    const html = renderToStaticMarkup(<AuditReportSheet {...props} canExport={false} />)
    expect(html).toContain('Opening checklist')
    expect(html).not.toContain('PDF ·')
  })

  it('offers PDF export to authorized officials', () => {
    const html = renderToStaticMarkup(<AuditReportSheet {...props} canExport />)
    expect(html).toContain('PDF ·')
  })
})

describe('report export identity', () => {
  it('uses the current PIN role rather than an older owner identity', async () => {
    const { getMe } = await import('@/components/people/helpers')
    const { canExportReports } = await import('@/lib/reportPermissions')
    const stored: Record<string, string> = {
      mise_staff_venue: JSON.stringify({ id: 'waiter', role: 'waiter' }),
      mise_me_venue: JSON.stringify({ id: 'owner', is_owner: true }),
    }
    vi.stubGlobal('window', {})
    vi.stubGlobal('localStorage', { getItem: (key: string) => stored[key] ?? null })
    try { expect(canExportReports(getMe('venue'))).toBe(false) }
    finally { vi.unstubAllGlobals() }
  })

  it('recognizes a manager authenticated with PIN before visiting People', async () => {
    const { getMe } = await import('@/components/people/helpers')
    const { canExportReports } = await import('@/lib/reportPermissions')
    vi.stubGlobal('window', {})
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => key === 'mise_staff_venue' ? JSON.stringify({ role: 'manager' }) : null,
    })
    try { expect(canExportReports(getMe('venue'))).toBe(true) }
    finally { vi.unstubAllGlobals() }
  })
})

it('does not restore export access from a legacy owner after current identity is cleared', async () => {
  const { getMe } = await import('@/components/people/helpers')
  const { canExportReports } = await import('@/lib/reportPermissions')
  vi.stubGlobal('window', {})
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => key === 'mise_me_venue' ? JSON.stringify({ is_owner: true }) : null,
  })
  try { expect(canExportReports(getMe('venue'))).toBe(false) }
  finally { vi.unstubAllGlobals() }
})
