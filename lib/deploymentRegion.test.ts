import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('keeps server functions beside the Ireland database', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
  expect(config.regions).toEqual(['dub1'])
})
