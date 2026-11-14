import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CustomExpenseFields } from './CustomExpenseFields'

describe('one-off expense fields', () => {
  it('renders a named amount with accessible debt and remove controls', () => {
    const html = renderToStaticMarkup(<CustomExpenseFields restaurantId="venue" contextKey="shift"
      rows={[{ id: 'a', name: 'Perfume', amount: '12,50', unpaid: true }]} onChange={() => {}} />)
    expect(html).toContain('value="Perfume"')
    expect(html).toContain('value="12,50"')
    expect(html).toContain('role="combobox"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('aria-label="Remove expense 1"')
    expect(html).toContain('Add expense')
  })

  it('disables all edits for a locked shift while retaining its values', () => {
    const html = renderToStaticMarkup(<CustomExpenseFields restaurantId="venue" contextKey="shift" disabled
      rows={[{ id: 'a', name: 'Perfume', amount: '12.50' }]} onChange={() => {}} />)
    expect(html).toContain('<fieldset disabled=""')
    expect(html).toContain('value="Perfume"')
    expect(html).toContain('value="12.50"')
  })
})
