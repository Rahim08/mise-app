import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { Table } from './index'

it('offers a native keyboard button to open a guest profile', () => {
  const html = renderToStaticMarkup(<Table columns={[{ key: 'name', label: 'Guest' }]} rows={[{ id: 'a', name: 'Alex' }]}
    onRowClick={() => {}} keyboardRows />)
  expect(html).toMatch(/<button[^>]*type="button"[^>]*>Alex<\/button>/)
})
