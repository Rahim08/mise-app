import { describe, expect, it } from 'vitest'
import { canExportReports } from './reportPermissions'

describe('report export roles', () => {
  it.each([
    [{ is_owner: true }, true],
    [{ is_owner: true, role: 'waiter' }, true],
    [{ role: 'manager' }, true],
    [{ role: 'admin' }, true],
    [{ role: 'waiter' }, false],
    [{ role: 'hookah' }, false],
    [{ role: 'barista' }, false],
    [{ role: 'cook' }, false],
    [{ role: 'hostess' }, false],
    [{ role: 'unknown' }, false],
    [{}, false],
    [null, false],
    [undefined, false],
  ] as const)('checks identity %j → %s', (staff, expected) => {
    expect(canExportReports(staff)).toBe(expected)
  })
})
