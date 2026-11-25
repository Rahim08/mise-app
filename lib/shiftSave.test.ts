import { describe, it, expect } from 'vitest'
import { saveShiftAtomic, type SaveAttempt, type ShiftSavePayload } from './shiftSave'

const payload: ShiftSavePayload = {
  expected: { income: 0, income_card: 0, inkassation: 0 }, income: 10, income_card: 0, inkassation: 0,
  seen: [], replace_ids: [], rows: [], custom: [], debts: [], ink_expense_delta: 0, ink_reason: '', ink_loaded_reason: '',
}

describe('saveShiftAtomic', () => {
  it('повтор той же формы после сбоя несёт тот же op_id, новая форма и успех — новый', async () => {
    const ids: string[] = []
    let fail = true
    const db = { rpc: async (_: string, args: any) => { ids.push(args.p.op_id); return { data: {}, error: fail ? { message: 'Network error' } : null } } }
    const attempt: { current: SaveAttempt } = { current: null }
    await saveShiftAtomic(db, attempt, 's', payload)
    await saveShiftAtomic(db, attempt, 's', payload)
    await saveShiftAtomic(db, attempt, 's', { ...payload, income: 11 })
    fail = false
    await saveShiftAtomic(db, attempt, 's', { ...payload, income: 11 })
    await saveShiftAtomic(db, attempt, 's', { ...payload, income: 11 })
    expect(ids[1]).toBe(ids[0])
    expect(ids[2]).not.toBe(ids[0])
    expect(ids[3]).toBe(ids[2])
    expect(ids[4]).not.toBe(ids[3])
  })
})
