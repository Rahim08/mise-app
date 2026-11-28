import { describe, expect, it } from 'vitest'
import { formatCatalog, parseStashReply } from './stashAi'

const stock = [
  { brand: 'Adalya', flavor: 'Love 66' },
  { brand: 'Adalya', flavor: 'Love' },
  { brand: 'MustHave', flavor: 'Pinkman' },
]

describe('formatCatalog', () => {
  it('groups flavors by brand', () => {
    expect(formatCatalog(stock)).toBe('Adalya: Love 66; Love\nMustHave: Pinkman')
  })
  it('never cuts a line in half', () => {
    expect(formatCatalog(stock, 25)).toBe('Adalya: Love 66; Love')
  })
})

describe('parseStashReply', () => {
  const reply = (rows: unknown[], action = 'in') => JSON.stringify({ action, rows })

  it('takes the stock spelling for case, spacing and hyphen differences', () => {
    expect(parseStashReply(reply([{ brand: 'must-have', flavor: 'PINK MAN', grams: '300' }]), stock)).toEqual({
      action: 'in',
      rows: [{ brand: 'MustHave', flavor: 'Pinkman', grams: '300', isNew: false }],
    })
  })
  it('keeps similar flavors apart and marks unknown ones as new', () => {
    const out = parseStashReply(reply([{ brand: 'adalya', flavor: 'Love', grams: 1000 }, { brand: 'adalya', flavor: 'Mint', grams: '50 g' }]), stock)
    expect(out?.rows).toEqual([
      { brand: 'Adalya', flavor: 'Love', grams: '1000', isNew: false },
      { brand: 'Adalya', flavor: 'Mint', grams: '50', isNew: true },
    ])
  })
  it('drops an unknown action and rejects non-JSON', () => {
    expect(parseStashReply(reply([], 'delete'), stock)?.action).toBe('')
    expect(parseStashReply('sorry', stock)).toBeNull()
  })
})
