'use client'
import { useEffect, useRef, useState, useCallback } from 'react'

type TableShape = 'rect' | 'round' | 'square'

type PosTable = {
  id: string
  floor_id: string
  number: string
  label: string | null
  shape: TableShape
  capacity: number
  pos_x: number
  pos_y: number
  width: number
  height: number
  status: string
}

type Floor = {
  id: string
  name: string
  sort: number
  pos_tables: PosTable[]
}

const CANVAS_W = 1200
const CANVAS_H = 700
const GRID = 20

function snap(v: number) { return Math.round(v / GRID) * GRID }

function TableEl({
  table,
  selected,
  onSelect,
  onDragStart,
}: {
  table: PosTable
  selected: boolean
  onSelect: (id: string) => void
  onDragStart: (e: React.PointerEvent, id: string) => void
}) {
  const isRound = table.shape === 'round'
  const size = table.shape === 'square' ? Math.min(table.width, table.height) : undefined

  return (
    <div
      onPointerDown={e => { e.stopPropagation(); onSelect(table.id); onDragStart(e, table.id) }}
      style={{
        position: 'absolute',
        left: table.pos_x,
        top: table.pos_y,
        width: isRound ? table.width : (size ?? table.width),
        height: isRound ? table.width : (size ?? table.height),
        borderRadius: isRound ? '50%' : 10,
        background: selected ? '#1c2a1c' : '#161616',
        border: `2px solid ${selected ? '#4ade80' : '#2a2a2a'}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'grab',
        userSelect: 'none',
        touchAction: 'none',
        transition: 'border-color .1s',
        boxShadow: selected ? '0 0 0 1px #4ade8040' : 'none',
      }}
    >
      <div style={{ color: selected ? '#4ade80' : '#fff', fontWeight: 700, fontSize: 15, lineHeight: 1 }}>
        {table.number}
      </div>
      {table.label && (
        <div style={{ color: '#555', fontSize: 10, marginTop: 2 }}>{table.label}</div>
      )}
      <div style={{ color: '#444', fontSize: 10, marginTop: 3 }}>{table.capacity}p</div>
    </div>
  )
}

export default function FloorsPage() {
  const [floors, setFloors] = useState<Floor[]>([])
  const [activeFloorId, setActiveFloorId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dragging, setDragging] = useState<{ id: string; ox: number; oy: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [addingFloor, setAddingFloor] = useState(false)
  const [newFloorName, setNewFloorName] = useState('')
  const [showTablePanel, setShowTablePanel] = useState(false)
  const [newTable, setNewTable] = useState({ number: '', label: '', shape: 'rect' as TableShape, capacity: 4 })
  const canvasRef = useRef<HTMLDivElement>(null)
  const pendingPositions = useRef<Record<string, { pos_x: number; pos_y: number }>>({})
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    fetch('/api/pos/floors').then(r => r.json()).then(d => {
      if (d.floors?.length) {
        setFloors(d.floors)
        setActiveFloorId(d.floors[0].id)
      }
    })
  }, [])

  const activeFloor = floors.find(f => f.id === activeFloorId)
  const tables = activeFloor?.pos_tables ?? []
  const selectedTable = tables.find(t => t.id === selectedId) ?? null

  const updateTableLocal = useCallback((id: string, patch: Partial<PosTable>) => {
    setFloors(prev => prev.map(f => ({
      ...f,
      pos_tables: f.pos_tables.map(t => t.id === id ? { ...t, ...patch } : t),
    })))
  }, [])

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      const updates = Object.entries(pendingPositions.current).map(([id, pos]) => ({ id, ...pos }))
      if (!updates.length) return
      pendingPositions.current = {}
      await fetch('/api/pos/tables', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tables: updates }),
      })
    }, 800)
  }, [])

  const handleCanvasPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const x = snap(e.clientX - rect.left - dragging.ox)
    const y = snap(e.clientY - rect.top - dragging.oy)
    const bx = Math.max(0, Math.min(x, CANVAS_W - 100))
    const by = Math.max(0, Math.min(y, CANVAS_H - 80))
    updateTableLocal(dragging.id, { pos_x: bx, pos_y: by })
    pendingPositions.current[dragging.id] = { pos_x: bx, pos_y: by }
    scheduleSave()
  }, [dragging, updateTableLocal, scheduleSave])

  const handleDragStart = useCallback((e: React.PointerEvent, id: string) => {
    if (!canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const table = tables.find(t => t.id === id)!
    setDragging({ id, ox: e.clientX - rect.left - table.pos_x, oy: e.clientY - rect.top - table.pos_y })
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [tables])

  const handlePointerUp = useCallback(() => {
    setDragging(null)
  }, [])

  async function addFloor() {
    if (!newFloorName.trim()) return
    const res = await fetch('/api/pos/floors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newFloorName.trim(), sort: floors.length }),
    })
    const d = await res.json()
    if (d.floor) {
      const f = { ...d.floor, pos_tables: [] }
      setFloors(prev => [...prev, f])
      setActiveFloorId(d.floor.id)
    }
    setNewFloorName('')
    setAddingFloor(false)
  }

  async function deleteFloor(id: string) {
    if (!confirm('Удалить зал? Все столы в нём тоже удалятся.')) return
    await fetch(`/api/pos/floors?id=${id}`, { method: 'DELETE' })
    setFloors(prev => prev.filter(f => f.id !== id))
    if (activeFloorId === id) setActiveFloorId(floors.find(f => f.id !== id)?.id ?? null)
  }

  async function addTable() {
    if (!activeFloorId || !newTable.number.trim()) return
    const count = tables.length
    const res = await fetch('/api/pos/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        floor_id: activeFloorId,
        number: newTable.number.trim(),
        label: newTable.label.trim() || null,
        shape: newTable.shape,
        capacity: newTable.capacity,
        pos_x: snap(60 + (count % 6) * 140),
        pos_y: snap(60 + Math.floor(count / 6) * 140),
        width: newTable.shape === 'round' ? 90 : 110,
        height: newTable.shape === 'round' ? 90 : 80,
      }),
    })
    const d = await res.json()
    if (d.table) {
      setFloors(prev => prev.map(f =>
        f.id === activeFloorId
          ? { ...f, pos_tables: [...f.pos_tables, d.table] }
          : f
      ))
      setSelectedId(d.table.id)
    }
    setNewTable({ number: '', label: '', shape: 'rect', capacity: 4 })
    setShowTablePanel(false)
  }

  async function deleteTable(id: string) {
    await fetch(`/api/pos/tables?id=${id}`, { method: 'DELETE' })
    setFloors(prev => prev.map(f => ({
      ...f,
      pos_tables: f.pos_tables.filter(t => t.id !== id),
    })))
    setSelectedId(null)
  }

  async function updateTableProp(id: string, patch: Partial<PosTable>) {
    updateTableLocal(id, patch)
    setSaving(true)
    await fetch('/api/pos/tables', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    })
    setSaving(false)
  }

  return (
    <div style={{ display: 'flex', height: '100%', flexDirection: 'column' }}>
      {/* Top bar */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', gap: 12, background: '#0d0d0d' }}>
        <h1 style={{ color: '#fff', fontSize: 18, fontWeight: 700, margin: 0 }}>Редактор залов</h1>
        <div style={{ flex: 1 }} />
        {saving && <span style={{ color: '#555', fontSize: 12 }}>Сохранение...</span>}
        <button
          onClick={() => setShowTablePanel(true)}
          disabled={!activeFloorId}
          style={{ padding: '8px 16px', background: '#fff', color: '#000', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: activeFloorId ? 'pointer' : 'not-allowed', opacity: activeFloorId ? 1 : 0.4 }}
        >
          + Добавить стол
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Floor tabs sidebar */}
        <div style={{ width: 200, background: '#0d0d0d', borderRight: '1px solid #1a1a1a', display: 'flex', flexDirection: 'column', padding: '16px 0' }}>
          <div style={{ padding: '0 16px 12px', color: '#444', fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' }}>Залы</div>
          {floors.map(f => (
            <div
              key={f.id}
              onClick={() => { setActiveFloorId(f.id); setSelectedId(null) }}
              style={{
                padding: '10px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
                background: f.id === activeFloorId ? '#1a1a1a' : 'transparent',
                borderLeft: f.id === activeFloorId ? '2px solid #fff' : '2px solid transparent',
              }}
            >
              <span style={{ color: f.id === activeFloorId ? '#fff' : '#555', fontSize: 14, flex: 1 }}>{f.name}</span>
              <span style={{ color: '#333', fontSize: 11 }}>{f.pos_tables.length}</span>
              <button
                onClick={e => { e.stopPropagation(); deleteFloor(f.id) }}
                style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', padding: '0 2px', fontSize: 16, lineHeight: 1, display: f.id === activeFloorId ? 'block' : 'none' }}
              >
                ×
              </button>
            </div>
          ))}

          {addingFloor ? (
            <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input
                autoFocus
                value={newFloorName}
                onChange={e => setNewFloorName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addFloor(); if (e.key === 'Escape') setAddingFloor(false) }}
                placeholder="Название зала"
                style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '6px 8px', color: '#fff', fontSize: 13, outline: 'none' }}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={addFloor} style={{ flex: 1, padding: '5px 0', background: '#fff', color: '#000', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>OK</button>
                <button onClick={() => setAddingFloor(false)} style={{ flex: 1, padding: '5px 0', background: '#1a1a1a', color: '#555', border: '1px solid #2a2a2a', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Отмена</button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAddingFloor(true)}
              style={{ margin: '8px 12px 0', padding: '8px 0', background: 'transparent', border: '1px dashed #2a2a2a', borderRadius: 8, color: '#444', fontSize: 13, cursor: 'pointer' }}
            >
              + Новый зал
            </button>
          )}
        </div>

        {/* Canvas area */}
        <div style={{ flex: 1, overflow: 'auto', background: '#0a0a0a', position: 'relative' }}>
          {activeFloor ? (
            <div
              ref={canvasRef}
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={handlePointerUp}
              onClick={() => setSelectedId(null)}
              style={{
                position: 'relative',
                width: CANVAS_W,
                height: CANVAS_H,
                margin: 24,
                background: '#111',
                borderRadius: 16,
                border: '1px solid #1a1a1a',
                backgroundImage: `radial-gradient(circle, #1e1e1e 1px, transparent 1px)`,
                backgroundSize: `${GRID}px ${GRID}px`,
                overflow: 'hidden',
              }}
            >
              {tables.map(t => (
                <TableEl
                  key={t.id}
                  table={t}
                  selected={t.id === selectedId}
                  onSelect={setSelectedId}
                  onDragStart={handleDragStart}
                />
              ))}

              {tables.length === 0 && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                  <div style={{ color: '#2a2a2a', fontSize: 48 }}>□</div>
                  <div style={{ color: '#333', fontSize: 14 }}>Нажми «Добавить стол» чтобы начать</div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 12 }}>
              <div style={{ color: '#333', fontSize: 14 }}>Создай зал слева чтобы начать</div>
            </div>
          )}
        </div>

        {/* Right panel — selected table properties */}
        {selectedTable && (
          <div style={{ width: 240, background: '#0d0d0d', borderLeft: '1px solid #1a1a1a', padding: 20, display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>Стол {selectedTable.number}</span>
              <button
                onClick={() => deleteTable(selectedTable.id)}
                style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 13, padding: 0 }}
              >
                Удалить
              </button>
            </div>

            <Field label="Номер">
              <input
                value={selectedTable.number}
                onChange={e => updateTableLocal(selectedTable.id, { number: e.target.value })}
                onBlur={e => updateTableProp(selectedTable.id, { number: e.target.value })}
                style={inputStyle}
              />
            </Field>

            <Field label="Название">
              <input
                value={selectedTable.label ?? ''}
                placeholder="напр. Веранда"
                onChange={e => updateTableLocal(selectedTable.id, { label: e.target.value })}
                onBlur={e => updateTableProp(selectedTable.id, { label: e.target.value || null })}
                style={inputStyle}
              />
            </Field>

            <Field label="Форма">
              <div style={{ display: 'flex', gap: 6 }}>
                {(['rect', 'square', 'round'] as TableShape[]).map(s => (
                  <button
                    key={s}
                    onClick={() => updateTableProp(selectedTable.id, { shape: s })}
                    style={{
                      flex: 1, padding: '6px 0', background: selectedTable.shape === s ? '#fff' : '#1a1a1a',
                      color: selectedTable.shape === s ? '#000' : '#555',
                      border: `1px solid ${selectedTable.shape === s ? '#fff' : '#2a2a2a'}`,
                      borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 600,
                    }}
                  >
                    {s === 'rect' ? 'Прям' : s === 'square' ? 'Квад' : 'Круг'}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Вместимость">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={() => updateTableProp(selectedTable.id, { capacity: Math.max(1, selectedTable.capacity - 1) })}
                  style={{ ...btnStyle, width: 32, height: 32 }}
                >-</button>
                <span style={{ color: '#fff', fontSize: 16, fontWeight: 700, flex: 1, textAlign: 'center' }}>{selectedTable.capacity}</span>
                <button
                  onClick={() => updateTableProp(selectedTable.id, { capacity: selectedTable.capacity + 1 })}
                  style={{ ...btnStyle, width: 32, height: 32 }}
                >+</button>
              </div>
            </Field>

            <Field label="Позиция">
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="number"
                  value={selectedTable.pos_x}
                  onChange={e => updateTableProp(selectedTable.id, { pos_x: Number(e.target.value) })}
                  style={{ ...inputStyle, width: '50%' }}
                />
                <input
                  type="number"
                  value={selectedTable.pos_y}
                  onChange={e => updateTableProp(selectedTable.id, { pos_y: Number(e.target.value) })}
                  style={{ ...inputStyle, width: '50%' }}
                />
              </div>
            </Field>

            <Field label="Размер">
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="number"
                  value={selectedTable.width}
                  onChange={e => updateTableProp(selectedTable.id, { width: Number(e.target.value) })}
                  style={{ ...inputStyle, width: '50%' }}
                />
                <input
                  type="number"
                  value={selectedTable.height}
                  onChange={e => updateTableProp(selectedTable.id, { height: Number(e.target.value) })}
                  style={{ ...inputStyle, width: '50%' }}
                />
              </div>
            </Field>
          </div>
        )}
      </div>

      {/* Add table modal */}
      {showTablePanel && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#111', border: '1px solid #222', borderRadius: 16, padding: 28, width: 340, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 17 }}>Новый стол</div>

            <Field label="Номер стола">
              <input
                autoFocus
                value={newTable.number}
                onChange={e => setNewTable(p => ({ ...p, number: e.target.value }))}
                placeholder="1, A1, Бар..."
                style={inputStyle}
              />
            </Field>

            <Field label="Название (необязательно)">
              <input
                value={newTable.label}
                onChange={e => setNewTable(p => ({ ...p, label: e.target.value }))}
                placeholder="Терраса, Кабинет..."
                style={inputStyle}
              />
            </Field>

            <Field label="Форма">
              <div style={{ display: 'flex', gap: 8 }}>
                {(['rect', 'square', 'round'] as TableShape[]).map(s => (
                  <button
                    key={s}
                    onClick={() => setNewTable(p => ({ ...p, shape: s }))}
                    style={{
                      flex: 1, padding: '8px 0',
                      background: newTable.shape === s ? '#fff' : '#1a1a1a',
                      color: newTable.shape === s ? '#000' : '#555',
                      border: `1px solid ${newTable.shape === s ? '#fff' : '#2a2a2a'}`,
                      borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: 600,
                    }}
                  >
                    {s === 'rect' ? 'Прям' : s === 'square' ? 'Квад' : 'Круг'}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Вместимость">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button onClick={() => setNewTable(p => ({ ...p, capacity: Math.max(1, p.capacity - 1) }))} style={{ ...btnStyle, width: 36, height: 36 }}>-</button>
                <span style={{ color: '#fff', fontSize: 20, fontWeight: 700, flex: 1, textAlign: 'center' }}>{newTable.capacity}</span>
                <button onClick={() => setNewTable(p => ({ ...p, capacity: p.capacity + 1 }))} style={{ ...btnStyle, width: 36, height: 36 }}>+</button>
              </div>
            </Field>

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button
                onClick={() => setShowTablePanel(false)}
                style={{ flex: 1, padding: '11px 0', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, color: '#555', fontSize: 14, cursor: 'pointer' }}
              >
                Отмена
              </button>
              <button
                onClick={addTable}
                disabled={!newTable.number.trim()}
                style={{ flex: 1, padding: '11px 0', background: '#fff', border: 'none', borderRadius: 10, color: '#000', fontSize: 14, fontWeight: 700, cursor: newTable.number.trim() ? 'pointer' : 'not-allowed', opacity: newTable.number.trim() ? 1 : 0.5 }}
              >
                Добавить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ color: '#444', fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase' }}>{label}</label>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  background: '#1a1a1a',
  border: '1px solid #2a2a2a',
  borderRadius: 8,
  padding: '8px 10px',
  color: '#fff',
  fontSize: 13,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
}

const btnStyle: React.CSSProperties = {
  background: '#1a1a1a',
  border: '1px solid #2a2a2a',
  borderRadius: 8,
  color: '#fff',
  fontSize: 18,
  fontWeight: 700,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}
