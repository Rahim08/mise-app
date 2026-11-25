import { describe, it, expect } from 'vitest'
import { runMoneyOp, type OpAttempt } from './moneyOps'

describe('runMoneyOp', () => {
  it('повтор после сбоя несёт тот же op_id, другая операция и повтор после успеха — новый', async () => {
    const ids: string[] = []
    let fail = true
    const db = { rpc: async (_: string, args: any) => { ids.push(args.p.op_id); return { data: null, error: fail ? { message: 'Network error' } : null } } }
    const attempt: { current: OpAttempt } = { current: null }
    await runMoneyOp(db, attempt, 'pay_salary', { amount: 1 })
    await runMoneyOp(db, attempt, 'pay_salary', { amount: 1 })
    await runMoneyOp(db, attempt, 'pay_salary', { amount: 2 })
    fail = false
    await runMoneyOp(db, attempt, 'pay_salary', { amount: 2 })
    await runMoneyOp(db, attempt, 'pay_salary', { amount: 2 })
    expect(ids[1]).toBe(ids[0])
    expect(ids[2]).not.toBe(ids[0])
    expect(ids[3]).toBe(ids[2])
    expect(ids[4]).not.toBe(ids[3])
  })
})
