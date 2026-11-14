// POST /api/people/checklist-item — отметка ОДНОГО пункта чек-листа/аудита.
// {checklist_id, idx, item, completion_id?, shift_id?, date?, attendance_id?}
//
// Раньше клиент читал items_state, менял свой индекс и записывал весь массив: два
// сотрудника, отмечающие разные пункты одновременно, затирали отметки друг друга (lost
// update). Теперь слияние делает сервер с compare-and-swap по items_state: запись проходит,
// только если массив не изменился с момента чтения, иначе — перечитываем и повторяем.
// Попутно в пункт пишется снимок формулировки и веса из шаблона — правка шаблона позже
// не меняет трактовку уже пройденных проверок.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveCaller } from '@/lib/apiAuth'
import { peopleContext } from '@/lib/peoplePolicy'
import { mergeChecklistItem as mergeItem, type ChecklistItemState as ItemState } from '@/lib/checklistMerge'

export const dynamic = 'force-dynamic'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const RESULTS = new Set(['pass', 'fail', 'na'])

function cleanItem(raw: any): ItemState | null {
  if (!raw || typeof raw !== 'object' || typeof raw.done !== 'boolean') return null
  const out: ItemState = { done: raw.done }
  if (raw.photo_url != null) { if (typeof raw.photo_url !== 'string' || raw.photo_url.length > 1000) return null; out.photo_url = raw.photo_url }
  if (raw.result != null) { if (!RESULTS.has(raw.result)) return null; out.result = raw.result }
  if (raw.note != null) { if (typeof raw.note !== 'string' || raw.note.length > 2000) return null; out.note = raw.note }
  return out
}

/** Пункт шаблона: строка (старый формат) или {label, weight, photo_required}. */
function templateItem(items: any[], idx: number): { label?: string; weight?: number } {
  const it = items?.[idx]
  if (typeof it === 'string') return { label: it }
  if (it && typeof it === 'object') return { label: typeof it.label === 'string' ? it.label : undefined, weight: typeof it.weight === 'number' ? it.weight : undefined }
  return {}
}

export async function POST(req: NextRequest) {
  const caller = await resolveCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!caller.owner && !caller.apps.includes('people')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const { checklist_id, completion_id, shift_id, date, attendance_id } = body || {}
  const idx = body?.idx
  const item = cleanItem(body?.item)
  if (typeof checklist_id !== 'string' || !UUID_RE.test(checklist_id) || !Number.isInteger(idx) || idx < 0 || idx > 500 || !item
    || (completion_id != null && (typeof completion_id !== 'string' || !UUID_RE.test(completion_id)))
    || (shift_id != null && (typeof shift_id !== 'string' || !UUID_RE.test(shift_id)))
    || (attendance_id != null && (typeof attendance_id !== 'string' || !UUID_RE.test(attendance_id)))
    || (date != null && (typeof date !== 'string' || !DATE_RE.test(date)))) {
    return NextResponse.json({ error: 'Invalid checklist item' }, { status: 400 })
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const rid = caller.rid
  const staffId = caller.sid && caller.sid !== 'owner' ? caller.sid : null
  let verify = false
  if (body?.verify === true) {
    try { verify = await peopleContext(admin, caller).official() } catch { return NextResponse.json({ error: 'Access could not be verified' }, { status: 503 }) }
    if (!verify) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: tpl, error: tplErr } = await admin.from('shift_checklists').select('id, items')
    .eq('restaurant_id', rid).eq('id', checklist_id).maybeSingle()
  if (tplErr) return NextResponse.json({ error: 'Checklist could not be loaded' }, { status: 503 })
  if (!tpl) return NextResponse.json({ error: 'Checklist not found' }, { status: 404 })
  const tplItems: any[] = Array.isArray(tpl.items) ? tpl.items : []
  const snap = templateItem(tplItems, idx)
  if (snap.label) item.label = snap.label
  if (snap.weight != null) item.weight = snap.weight

  const find = async () => {
    let q = admin.from('shift_checklist_completions').select('id, items_state, status').eq('restaurant_id', rid)
    if (completion_id) q = q.eq('id', completion_id)
    else if (shift_id) q = q.eq('checklist_id', checklist_id).eq('shift_id', shift_id)
    else q = q.eq('checklist_id', checklist_id).eq('date', date || new Date().toISOString().slice(0, 10))
    return q.order('created_at', { ascending: true }).limit(1).maybeSingle()
  }

  for (let attempt = 0; attempt < 6; attempt++) {
    const { data: row, error } = await find()
    if (error) return NextResponse.json({ error: 'Checklist could not be loaded' }, { status: 503 })
    if (!row) {
      if (completion_id) return NextResponse.json({ error: 'Checklist run not found' }, { status: 404 })
      const { state, allDone } = mergeItem(null, tplItems.length, idx, item)
      const { data: inserted, error: insErr } = await admin.from('shift_checklist_completions').insert({
        restaurant_id: rid, checklist_id, shift_id: shift_id ?? null, date: date || new Date().toISOString().slice(0, 10),
        staff_id: staffId, items_state: state, attendance_id: attendance_id ?? null,
        status: allDone ? 'done' : 'in_progress', completed_at: allDone ? new Date().toISOString() : null,
      }).select('*').single()
      if (insErr) return NextResponse.json({ error: 'Checklist could not be saved' }, { status: 503 })
      // Гонка двух первых отметок создала бы два прогона: оставляем самый ранний, нашу
      // отметку переносим в него (следующая итерация цикла), лишнюю строку удаляем.
      const { data: first } = await find()
      if (first && first.id !== inserted.id) {
        await admin.from('shift_checklist_completions').delete().eq('restaurant_id', rid).eq('id', inserted.id)
        continue
      }
      return NextResponse.json({ data: inserted })
    }
    const { state, allDone } = mergeItem(row.items_state, tplItems.length, idx, item)
    const status = allDone ? 'done' : 'in_progress'
    let q = admin.from('shift_checklist_completions')
      // verify: менеджерская оценка чужого прогона — исполнитель (staff_id) остаётся прежним.
      .update({ items_state: state, status, completed_at: allDone ? new Date().toISOString() : null, ...(verify ? {} : { staff_id: staffId }) })
      .eq('restaurant_id', rid).eq('id', row.id)
    // Compare-and-swap: запись только поверх той версии, которую мы прочитали.
    q = row.items_state == null ? q.is('items_state', null) : q.eq('items_state', JSON.stringify(row.items_state))
    const { data: updated, error: upErr } = await q.select('*')
    if (upErr) return NextResponse.json({ error: 'Checklist could not be saved' }, { status: 503 })
    if (updated?.length) return NextResponse.json({ data: updated[0] })
  }
  return NextResponse.json({ error: 'Checklist is busy, try again' }, { status: 409 })
}
