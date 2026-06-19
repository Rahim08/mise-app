'use client'
import { useEffect, useRef, useState } from 'react'

type Category = { id: string; name: string; sort: number; color: string | null; icon: string | null }
type Item = {
  id: string; category_id: string; name: string; description: string | null
  photo_url: string | null; base_price: number; yield_g: number | null
  allergens: string[]; station: string; flags: string[]; is_available: boolean; sort: number
}
type ModGroup = { id: string; menu_item_id: string; name: string; required: boolean; min_select: number; max_select: number; sort: number }
type Modifier = { id: string; group_id: string; name: string; price_delta: number; sort: number }

const STATIONS = ['kitchen', 'bar', 'grill', 'sushi', 'cold', 'dessert']
const FLAGS = ['vegetarian', 'vegan', 'spicy', 'featured', 'new', 'gluten-free']

export default function MenuPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [groups, setGroups] = useState<ModGroup[]>([])
  const [modifiers, setModifiers] = useState<Modifier[]>([])
  const [activeCat, setActiveCat] = useState<string | null>(null)
  const [selected, setSelected] = useState<Item | null>(null)
  const [editing, setEditing] = useState<Partial<Item> | null>(null)
  const [addingCat, setAddingCat] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [showAddGroup, setShowAddGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [addingMod, setAddingMod] = useState<string | null>(null)
  const [newMod, setNewMod] = useState({ name: '', price_delta: 0 })
  const [saving, setSaving] = useState(false)
  const isNew = editing && !editing.id

  useEffect(() => {
    fetch('/api/pos/menu').then(r => r.json()).then(d => {
      setCategories(d.categories ?? [])
      setItems(d.items ?? [])
      setGroups(d.groups ?? [])
      setModifiers(d.modifiers ?? [])
      if (d.categories?.length) setActiveCat(d.categories[0].id)
    })
  }, [])

  const visibleItems = items.filter(i => !activeCat || i.category_id === activeCat)
    .sort((a, b) => a.sort - b.sort)
  const selectedGroups = groups.filter(g => g.menu_item_id === selected?.id).sort((a, b) => a.sort - b.sort)

  async function addCategory() {
    if (!newCatName.trim()) return
    const r = await fetch('/api/pos/menu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'category', name: newCatName.trim(), sort: categories.length }),
    })
    const d = await r.json()
    if (d.category) {
      setCategories(p => [...p, d.category])
      setActiveCat(d.category.id)
    }
    setNewCatName(''); setAddingCat(false)
  }

  async function deleteCategory(id: string) {
    if (!confirm('Удалить категорию и все её блюда?')) return
    await fetch(`/api/pos/menu?id=${id}&type=category`, { method: 'DELETE' })
    setCategories(p => p.filter(c => c.id !== id))
    setItems(p => p.filter(i => i.category_id !== id))
    if (activeCat === id) setActiveCat(categories.find(c => c.id !== id)?.id ?? null)
  }

  function startAdd() {
    setEditing({
      category_id: activeCat ?? categories[0]?.id ?? '',
      name: '', description: null, photo_url: null,
      base_price: 0, yield_g: null, allergens: [],
      station: 'kitchen', flags: [], is_available: true, sort: visibleItems.length,
    })
    setSelected(null)
  }

  async function saveItem() {
    if (!editing?.name?.trim()) return
    setSaving(true)
    if (isNew) {
      const r = await fetch('/api/pos/menu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'item', ...editing }),
      })
      const d = await r.json()
      if (d.item) { setItems(p => [...p, d.item]); setSelected(d.item); setEditing(null) }
    } else {
      const { id, ...fields } = editing as Item
      const r = await fetch('/api/pos/menu', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, type: 'item', ...fields }),
      })
      const d = await r.json()
      if (d.data) { setItems(p => p.map(i => i.id === id ? d.data : i)); setSelected(d.data); setEditing(null) }
    }
    setSaving(false)
  }

  async function deleteItem(id: string) {
    if (!confirm('Удалить блюдо?')) return
    await fetch(`/api/pos/menu?id=${id}&type=item`, { method: 'DELETE' })
    setItems(p => p.filter(i => i.id !== id))
    if (selected?.id === id) { setSelected(null); setEditing(null) }
  }

  async function toggleAvailable(item: Item) {
    const r = await fetch('/api/pos/menu', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, type: 'item', is_available: !item.is_available }),
    })
    const d = await r.json()
    if (d.data) setItems(p => p.map(i => i.id === item.id ? d.data : i))
  }

  async function addModifierGroup() {
    if (!selected || !newGroupName.trim()) return
    const r = await fetch('/api/pos/menu/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ menu_item_id: selected.id, name: newGroupName.trim(), required: false, min_select: 0, max_select: 1, sort: selectedGroups.length }),
    })
    const d = await r.json()
    if (d.group) setGroups(p => [...p, d.group])
    setNewGroupName(''); setShowAddGroup(false)
  }

  async function addModifier(groupId: string) {
    if (!newMod.name.trim()) return
    const r = await fetch('/api/pos/menu/modifiers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_id: groupId, name: newMod.name.trim(), price_delta: newMod.price_delta, sort: modifiers.filter(m => m.group_id === groupId).length }),
    })
    const d = await r.json()
    if (d.modifier) setModifiers(p => [...p, d.modifier])
    setNewMod({ name: '', price_delta: 0 }); setAddingMod(null)
  }

  async function deleteModifier(id: string) {
    await fetch(`/api/pos/menu/modifiers?id=${id}`, { method: 'DELETE' })
    setModifiers(p => p.filter(m => m.id !== id))
  }

  async function deleteGroup(id: string) {
    await fetch(`/api/pos/menu/groups?id=${id}`, { method: 'DELETE' })
    setGroups(p => p.filter(g => g.id !== id))
    setModifiers(p => p.filter(m => m.group_id !== id))
  }

  const [importing, setImporting] = useState(false)
  const [importPreview, setImportPreview] = useState<{ categories: number; items: number; already: boolean } | null>(null)

  async function previewImport() {
    const r = await fetch('/api/pos/menu/import')
    const d = await r.json()
    setImportPreview({ categories: d.categories?.length ?? 0, items: d.items?.length ?? 0, already: d.already_has_pos_menu })
    setImporting(true)
  }

  async function executeImport(overwrite: boolean) {
    const r = await fetch('/api/pos/menu/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overwrite }),
    })
    const d = await r.json()
    if (d.error) { alert(d.error); return }
    // Reload menu data
    const m = await fetch('/api/pos/menu').then(r => r.json())
    setCategories(m.categories ?? [])
    setItems(m.items ?? [])
    setGroups(m.groups ?? [])
    setModifiers(m.modifiers ?? [])
    if (m.categories?.length) setActiveCat(m.categories[0].id)
    setImporting(false)
    setImportPreview(null)
  }

  const currentItem = editing ?? selected

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* Categories column */}
      <div style={{ width: 200, background: '#0d0d0d', borderRight: '1px solid #1a1a1a', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 16px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: '#444', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Категории</span>
          {categories.length === 0 && (
            <button onClick={previewImport} style={{ fontSize: 11, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              Импорт из меню
            </button>
          )}
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {categories.map(c => (
            <div
              key={c.id}
              onClick={() => { setActiveCat(c.id); setSelected(null); setEditing(null) }}
              style={{
                padding: '9px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer',
                background: c.id === activeCat ? '#1a1a1a' : 'transparent',
                borderLeft: `2px solid ${c.id === activeCat ? '#fff' : 'transparent'}`,
              }}
            >
              <span style={{ color: c.id === activeCat ? '#fff' : '#555', fontSize: 13 }}>{c.name}</span>
              <span style={{ color: '#333', fontSize: 11 }}>{items.filter(i => i.category_id === c.id).length}</span>
              {c.id === activeCat && (
                <button onClick={e => { e.stopPropagation(); deleteCategory(c.id) }} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 0 0 4px' }}>×</button>
              )}
            </div>
          ))}
        </div>
        {addingCat ? (
          <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input
              autoFocus value={newCatName}
              onChange={e => setNewCatName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addCategory(); if (e.key === 'Escape') setAddingCat(false) }}
              placeholder="Название"
              style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '6px 8px', color: '#fff', fontSize: 13, outline: 'none' }}
            />
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={addCategory} style={{ flex: 1, padding: '5px 0', background: '#fff', color: '#000', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>OK</button>
              <button onClick={() => setAddingCat(false)} style={{ flex: 1, padding: '5px 0', background: '#1a1a1a', color: '#555', border: '1px solid #2a2a2a', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>✕</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAddingCat(true)} style={{ margin: '8px 10px 12px', padding: '8px 0', background: 'transparent', border: '1px dashed #2a2a2a', borderRadius: 8, color: '#444', fontSize: 13, cursor: 'pointer' }}>
            + Категория
          </button>
        )}
      </div>

      {/* Items list */}
      <div style={{ width: 280, borderRight: '1px solid #1a1a1a', display: 'flex', flexDirection: 'column', background: '#0a0a0a' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>{categories.find(c => c.id === activeCat)?.name ?? 'Все'}</span>
          <button onClick={startAdd} disabled={!activeCat} style={{ padding: '5px 12px', background: activeCat ? '#fff' : '#1a1a1a', color: activeCat ? '#000' : '#333', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: activeCat ? 'pointer' : 'not-allowed' }}>+ Блюдо</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {visibleItems.map(item => (
            <div
              key={item.id}
              onClick={() => { setSelected(item); setEditing(null) }}
              style={{
                padding: '12px 16px', cursor: 'pointer',
                background: selected?.id === item.id ? '#161616' : 'transparent',
                borderLeft: `2px solid ${selected?.id === item.id ? '#fff' : 'transparent'}`,
                borderBottom: '1px solid #111',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ color: item.is_available ? '#fff' : '#444', fontWeight: 500, fontSize: 14 }}>{item.name}</span>
                <span style={{ color: '#555', fontSize: 13 }}>€{item.base_price.toFixed(2)}</span>
              </div>
              {item.description && (
                <div style={{ color: '#333', fontSize: 11, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description}</div>
              )}
              <div style={{ display: 'flex', gap: 4, marginTop: 5 }}>
                {!item.is_available && <Chip label="Стоп" color="#ff4444" />}
                {item.flags.includes('featured') && <Chip label="Хит" color="#eab308" />}
                {item.flags.includes('vegan') && <Chip label="Vegan" color="#22c55e" />}
                {item.flags.includes('spicy') && <Chip label="Острое" color="#f97316" />}
              </div>
            </div>
          ))}
          {visibleItems.length === 0 && (
            <div style={{ color: '#2a2a2a', fontSize: 13, textAlign: 'center', paddingTop: 40 }}>Нет блюд в категории</div>
          )}
        </div>
      </div>

      {/* Editor panel */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 28 }}>
        {(editing || selected) ? (
          <div style={{ maxWidth: 560 }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
              <h2 style={{ color: '#fff', fontSize: 18, fontWeight: 800, margin: 0 }}>
                {isNew ? 'Новое блюдо' : editing ? 'Редактировать' : selected?.name}
              </h2>
              <div style={{ display: 'flex', gap: 8 }}>
                {!editing && selected && (
                  <>
                    <button onClick={() => toggleAvailable(selected)} style={edBtnStyle(selected.is_available ? '#f9731620' : '#22c55e20', selected.is_available ? '#f97316' : '#22c55e')}>
                      {selected.is_available ? 'Стоп' : 'В меню'}
                    </button>
                    <button onClick={() => setEditing({ ...selected })} style={edBtnStyle('#1a1a1a', '#fff')}>Изменить</button>
                    <button onClick={() => deleteItem(selected.id)} style={edBtnStyle('#ff444422', '#ff4444')}>Удалить</button>
                  </>
                )}
                {editing && (
                  <>
                    <button onClick={() => setEditing(null)} style={edBtnStyle('#1a1a1a', '#555')}>Отмена</button>
                    <button onClick={saveItem} disabled={saving} style={edBtnStyle('#fff', '#000')}>
                      {saving ? '...' : isNew ? 'Создать' : 'Сохранить'}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Fields */}
            {editing ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <F label="Название">
                  <input value={editing.name ?? ''} onChange={e => setEditing(p => ({ ...p, name: e.target.value }))} style={inp} />
                </F>
                <F label="Описание">
                  <textarea value={editing.description ?? ''} onChange={e => setEditing(p => ({ ...p, description: e.target.value }))} rows={2} style={{ ...inp, resize: 'none' }} />
                </F>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <F label="Цена (€)">
                    <input type="number" step="0.01" value={editing.base_price ?? 0} onChange={e => setEditing(p => ({ ...p, base_price: parseFloat(e.target.value) || 0 }))} style={inp} />
                  </F>
                  <F label="Выход (г)">
                    <input type="number" value={editing.yield_g ?? ''} onChange={e => setEditing(p => ({ ...p, yield_g: e.target.value ? Number(e.target.value) : null }))} style={inp} />
                  </F>
                </div>
                <F label="Станция">
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {STATIONS.map(s => (
                      <button key={s} onClick={() => setEditing(p => ({ ...p, station: s }))} style={{ padding: '5px 12px', background: editing.station === s ? '#fff' : '#1a1a1a', color: editing.station === s ? '#000' : '#555', border: `1px solid ${editing.station === s ? '#fff' : '#2a2a2a'}`, borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                        {s}
                      </button>
                    ))}
                  </div>
                </F>
                <F label="Теги">
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {FLAGS.map(f => {
                      const on = (editing.flags ?? []).includes(f)
                      return (
                        <button key={f} onClick={() => setEditing(p => ({ ...p, flags: on ? (p.flags ?? []).filter(x => x !== f) : [...(p.flags ?? []), f] }))} style={{ padding: '5px 12px', background: on ? '#fff' : '#1a1a1a', color: on ? '#000' : '#555', border: `1px solid ${on ? '#fff' : '#2a2a2a'}`, borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                          {f}
                        </button>
                      )
                    })}
                  </div>
                </F>
                <F label="URL фото">
                  <input value={editing.photo_url ?? ''} onChange={e => setEditing(p => ({ ...p, photo_url: e.target.value || null }))} placeholder="https://..." style={inp} />
                </F>
              </div>
            ) : selected ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* Display mode */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <InfoCard label="Цена" value={`€${selected.base_price.toFixed(2)}`} />
                  <InfoCard label="Выход" value={selected.yield_g ? `${selected.yield_g}г` : '—'} />
                  <InfoCard label="Станция" value={selected.station} />
                  <InfoCard label="Статус" value={selected.is_available ? 'В меню' : 'Стоп'} accent={selected.is_available ? '#22c55e' : '#ff4444'} />
                </div>
                {selected.description && (
                  <div style={{ background: '#111', border: '1px solid #1a1a1a', borderRadius: 10, padding: '12px 14px', color: '#666', fontSize: 13, lineHeight: 1.5 }}>
                    {selected.description}
                  </div>
                )}
                {selected.flags.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {selected.flags.map(f => <Chip key={f} label={f} color="#555" />)}
                  </div>
                )}

                {/* Modifier groups */}
                <div style={{ marginTop: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <span style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>Модификаторы</span>
                    <button onClick={() => setShowAddGroup(true)} style={{ padding: '5px 12px', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 7, color: '#fff', fontSize: 12, cursor: 'pointer' }}>+ Группа</button>
                  </div>

                  {showAddGroup && (
                    <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                      <input autoFocus value={newGroupName} onChange={e => setNewGroupName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addModifierGroup(); if (e.key === 'Escape') setShowAddGroup(false) }} placeholder="Соус, Добавки, Размер..." style={{ ...inp, flex: 1 }} />
                      <button onClick={addModifierGroup} style={{ padding: '8px 14px', background: '#fff', color: '#000', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>OK</button>
                      <button onClick={() => setShowAddGroup(false)} style={{ padding: '8px 14px', background: '#1a1a1a', color: '#555', border: '1px solid #2a2a2a', borderRadius: 8, cursor: 'pointer' }}>✕</button>
                    </div>
                  )}

                  {selectedGroups.length === 0 && !showAddGroup && (
                    <div style={{ color: '#2a2a2a', fontSize: 13, padding: '16px 0' }}>Нет групп модификаторов</div>
                  )}

                  {selectedGroups.map(g => (
                    <div key={g.id} style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, padding: 14, marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <span style={{ color: '#fff', fontWeight: 600, fontSize: 13 }}>{g.name}</span>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <span style={{ color: '#444', fontSize: 11 }}>до {g.max_select}</span>
                          <button onClick={() => deleteGroup(g.id)} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 14 }}>×</button>
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {modifiers.filter(m => m.group_id === g.id).sort((a, b) => a.sort - b.sort).map(m => (
                          <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #111' }}>
                            <span style={{ color: '#ddd', fontSize: 13, flex: 1 }}>{m.name}</span>
                            {m.price_delta !== 0 && <span style={{ color: '#555', fontSize: 12 }}>{m.price_delta > 0 ? '+' : ''}€{m.price_delta.toFixed(2)}</span>}
                            <button onClick={() => deleteModifier(m.id)} style={{ background: 'none', border: 'none', color: '#333', cursor: 'pointer', fontSize: 14 }}>×</button>
                          </div>
                        ))}
                      </div>
                      {addingMod === g.id ? (
                        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                          <input autoFocus value={newMod.name} onChange={e => setNewMod(p => ({ ...p, name: e.target.value }))} placeholder="Название" style={{ ...inp, flex: 2 }} />
                          <input type="number" step="0.5" value={newMod.price_delta || ''} onChange={e => setNewMod(p => ({ ...p, price_delta: parseFloat(e.target.value) || 0 }))} placeholder="+0.00" style={{ ...inp, flex: 1 }} />
                          <button onClick={() => addModifier(g.id)} style={{ padding: '0 12px', background: '#fff', color: '#000', border: 'none', borderRadius: 7, fontWeight: 700, cursor: 'pointer' }}>+</button>
                          <button onClick={() => setAddingMod(null)} style={{ padding: '0 10px', background: '#1a1a1a', color: '#555', border: '1px solid #2a2a2a', borderRadius: 7, cursor: 'pointer' }}>✕</button>
                        </div>
                      ) : (
                        <button onClick={() => setAddingMod(g.id)} style={{ marginTop: 8, padding: '5px 10px', background: 'transparent', border: '1px dashed #222', borderRadius: 6, color: '#333', fontSize: 12, cursor: 'pointer' }}>
                          + Вариант
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 10 }}>
            <div style={{ color: '#2a2a2a', fontSize: 14 }}>Выбери блюдо или создай новое</div>
          </div>
        )}
      </div>

      {/* Import modal */}
      {importing && importPreview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
          <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: 16, padding: 28, width: 380 }}>
            <div style={{ color: '#fff', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Импорт из Mise Menu</div>
            <div style={{ color: '#666', fontSize: 14, marginBottom: 20 }}>
              Найдено: <span style={{ color: '#fff' }}>{importPreview.categories}</span> категорий, <span style={{ color: '#fff' }}>{importPreview.items}</span> блюд
            </div>
            {importPreview.already && (
              <div style={{ background: '#2a1500', border: '1px solid #4a2000', borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: '#f97316', fontSize: 13 }}>
                В POS-меню уже есть данные. Импорт заменит их.
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => executeImport(importPreview.already)} style={{ flex: 1, padding: '10px 0', background: '#fff', color: '#000', border: 'none', borderRadius: 9, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                {importPreview.already ? 'Заменить' : 'Импортировать'}
              </button>
              <button onClick={() => { setImporting(false); setImportPreview(null) }} style={{ padding: '10px 16px', background: '#1a1a1a', color: '#666', border: '1px solid #2a2a2a', borderRadius: 9, fontSize: 14, cursor: 'pointer' }}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Chip({ label, color }: { label: string; color: string }) {
  return <span style={{ fontSize: 10, fontWeight: 700, color, background: color + '22', padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</span>
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ color: '#444', fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</label>
      {children}
    </div>
  )
}

function InfoCard({ label, value, accent = '#fff' }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ background: '#111', border: '1px solid #1a1a1a', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ color: '#444', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
      <div style={{ color: accent, fontSize: 16, fontWeight: 700 }}>{value}</div>
    </div>
  )
}

const inp: React.CSSProperties = { background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '9px 12px', color: '#fff', fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box' }
function edBtnStyle(bg: string, color: string): React.CSSProperties {
  return { padding: '7px 14px', background: bg, color, border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }
}
