import { describe, it, expect } from 'vitest'
import { buildCheckIn, zonedToUtc, localDateKey } from './attendanceCheckIn'

const settings = { timezone: 'Europe/Rome', late_grace_min: 5, attendance_enabled: true, latitude: 41.9, longitude: 12.5, geo_radius_m: 150 }
const now = new Date('2026-11-14T18:20:00Z') // 19:20 в Риме

describe('buildCheckIn', () => {
  it('опоздание от начала смены в поясе заведения', () => {
    const r = buildCheckIn({ input: { date: '2026-11-14' }, staffId: 'w1', now, settings, schedule: { shift_start: '19:00', id: 's1' } })
    expect(r.late_minutes).toBe(20)
    expect(r.status).toBe('late')
  })
  it('в пределах грейса — present', () => {
    const r = buildCheckIn({ input: { date: '2026-11-14' }, staffId: 'w1', now, settings, schedule: { shift_start: '19:16' } })
    expect(r.late_minutes).toBe(4)
    expect(r.status).toBe('present')
  })
  it('время из будущего заменяется на «сейчас»', () => {
    const r = buildCheckIn({ input: { check_in_at: '2026-11-14T20:00:00Z' }, staffId: 'w1', now, settings, schedule: null })
    expect(r.check_in_at).toBe(now.toISOString())
  })
  it('офлайн-приход принимается с исходным временем, но слишком старый — нет', () => {
    const r = buildCheckIn({ input: { check_in_at: '2026-11-14T18:00:00Z', date: '2026-11-14' }, staffId: 'w1', now, settings, schedule: { shift_start: '19:00' } })
    expect(r.late_minutes).toBe(0)
    expect(r.source).toBe('manual')
    expect(() => buildCheckIn({ input: { check_in_at: '2026-11-13T01:00:00Z' }, staffId: 'w1', now, settings, schedule: null })).toThrow()
  })
  it('нельзя отметиться на произвольную дату', () => {
    expect(() => buildCheckIn({ input: { date: '2026-11-01' }, staffId: 'w1', now, settings, schedule: null })).toThrow()
    // Ночная смена: вчерашняя дата после полуночи допустима.
    const night = new Date('2026-11-14T23:30:00Z') // 00:30 15.11 в Риме
    expect(buildCheckIn({ input: { date: '2026-11-14' }, staffId: 'w1', now: night, settings, schedule: null }).date).toBe('2026-11-14')
  })
  it('вне радиуса — отказ, в радиусе — дистанция от сервера', () => {
    expect(() => buildCheckIn({ input: { check_in_lat: 45, check_in_lng: 9 }, staffId: 'w1', now, settings, schedule: null })).toThrow('Out of zone')
    const r = buildCheckIn({ input: { check_in_lat: 41.9005, check_in_lng: 12.5 }, staffId: 'w1', now, settings, schedule: null })
    expect(r.check_in_distance_m).toBeLessThan(150)
    expect(r.source).toBe('geo')
  })
})

describe('часовые пояса', () => {
  it('zonedToUtc учитывает летнее время', () => {
    expect(zonedToUtc('2026-07-01', '19:00', 'Europe/Rome').toISOString()).toBe('2026-07-01T17:00:00.000Z')
    expect(zonedToUtc('2026-12-01', '19:00', 'Europe/Rome').toISOString()).toBe('2026-12-01T18:00:00.000Z')
  })
  it('localDateKey', () => {
    expect(localDateKey(new Date('2026-11-14T23:30:00Z'), 'Europe/Rome')).toBe('2026-11-15')
  })
})
