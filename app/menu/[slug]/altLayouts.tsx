'use client'
// Пять альтернативных структур QR-меню (Design Lab прототип, одобрено пользователем).
// Каждая — это ТОЛЬКО шапка+контент; корзина/детали/фильтры/язык/AI-квиз/счёт остаются
// общими компонентами из page.tsx (MenuPage) — сюда прокидываются готовые хендлеры через ctx.
import React, { useState } from 'react'
import type { AltLayoutCtx, MenuItem, Category } from './page'

// Тень / контур / стекло — только border+shadow+blur, фон карточки задаёт сам вызывающий
// компонент (разный per-design: T.surface2 у Apple, T.surface у Lounge и т.д.).
function cardShapeStyle(ctx: AltLayoutCtx): React.CSSProperties {
  const { cardStyle, T } = ctx
  if (cardStyle === 'outline') return { border: `1px solid ${T.sep}`, boxShadow: 'none' }
  if (cardStyle === 'glass') return { border: `1px solid ${T.sep}`, boxShadow: T.sh, backdropFilter: 'blur(20px) saturate(170%)', WebkitBackdropFilter: 'blur(20px) saturate(170%)' }
  return { border: 'none', boxShadow: T.sh }
}

function IntensityBars({ n, accent, fill }: { n: number; accent: string; fill: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }} aria-label={`${n}/5`}>
      {[1, 2, 3, 4, 5].map(i => <span key={i} style={{ width: 3, height: 10, borderRadius: 1, background: i <= n ? accent : fill }} />)}
    </span>
  )
}

function ItemMeta({ item, ctx }: { item: MenuItem; ctx: AltLayoutCtx }) {
  const { t, accent, T, trendingIds, orderable, tagPills } = ctx
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 5 }}>
      {item.intensity != null && <IntensityBars n={item.intensity} accent={accent} fill={T.fill} />}
      {trendingIds.includes(item.id) && <span style={{ fontSize: 10, fontWeight: 700, color: accent, border: `1px solid ${accent}`, padding: '1px 6px', borderRadius: 6 }}>{t('menu.trending')}</span>}
      {orderable(item) && item.stock_left != null && item.stock_left > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: '#ff9500', border: '1px solid #ff9500', padding: '1px 6px', borderRadius: 6 }}>{t('menu.stockLeft', { n: item.stock_left })}</span>}
      {tagPills(item).map(d => <span key={d.id} style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: d.color, padding: '2px 7px', borderRadius: 6 }}>{t(d.labelKey)}</span>)}
    </div>
  )
}

// ══════════════════════════════════════ APPLE ══════════════════════════════════════
// Без табов категорий — вертикальный скролл, крупные заголовки, сквиркл-строки.
function AppleLayout({ ctx }: { ctx: AltLayoutCtx }) {
  const { settings, restaurant, categories, filteredItems, nm, dsc, money, accent, T, headFont, bodyFont, t, cartQty, addToCart, favs, toggleFav, openDetail, orderable, soldOutToday } = ctx
  return (
    <>
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200, padding: '16px 18px', background: T.hbg, backdropFilter: 'saturate(200%) blur(24px)', WebkitBackdropFilter: 'saturate(200%) blur(24px)', borderBottom: `0.5px solid ${T.sep}` }}>
        <span style={{ fontWeight: 700, fontSize: 17, color: T.text, letterSpacing: -0.3, fontFamily: headFont }}>{restaurant.name}</span>
      </div>
      <div style={{ position: 'fixed', top: 60, left: 0, right: 0, bottom: 0, overflowY: 'auto' }}>
        <div style={{ padding: '8px 20px 110px', maxWidth: 640, margin: '0 auto' }}>
          {categories.map(cat => {
            const catItems = filteredItems(cat.id)
            if (catItems.length === 0) return null
            return (
              <div key={cat.id} style={{ padding: '30px 0 4px' }}>
                <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.6, color: T.text, marginBottom: 16, fontFamily: headFont }}>{nm(cat)}</div>
                {catItems.map(item => {
                  const qty = cartQty(item.id)
                  const fav = favs.includes(item.id)
                  const canOrder = settings.allow_orders && orderable(item)
                  return (
                    <div key={item.id} onClick={() => openDetail(item)} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 16, borderRadius: ctx.radius, background: T.surface2, marginBottom: 10, cursor: 'pointer', opacity: orderable(item) ? 1 : 0.5, ...cardShapeStyle(ctx) }}>
                      <div style={{ width: 50, height: 50, borderRadius: 15, background: T.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative' }}>
                        {settings.show_photos && item.image_url ? <img src={item.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 15 }} /> : <svg width="20" height="20" fill="none" stroke={accent} strokeWidth="1.6" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /></svg>}
                        <button onClick={e => { e.stopPropagation(); toggleFav(item.id) }} style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', border: 'none', background: T.surface, boxShadow: '0 1px 4px rgba(0,0,0,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill={fav ? '#ff3b30' : 'none'} stroke={fav ? '#ff3b30' : T.text3} strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" /></svg>
                        </button>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 16, fontWeight: 700, color: T.text, letterSpacing: -0.2, fontFamily: headFont, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nm(item)}</div>
                        {dsc(item) && <div style={{ fontSize: 12.5, color: T.text2, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{dsc(item)}</div>}
                        <ItemMeta item={item} ctx={ctx} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                        {item.price != null && <span style={{ fontSize: 13, fontWeight: 700, color: accent }}>{money(item.price)}</span>}
                        {canOrder && (
                          <button onClick={() => addToCart(item)} style={{ width: 30, height: 30, borderRadius: '50%', border: `1.5px solid ${accent}`, background: qty > 0 ? accent : 'transparent', color: qty > 0 ? '#fff' : accent, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13 }}>
                            {qty > 0 ? qty : <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" viewBox="0 0 16 16"><path d="M8 1v14M1 8h14" /></svg>}
                          </button>
                        )}
                        {!orderable(item) && <span style={{ fontSize: 10, color: '#ff3b30' }}>{soldOutToday(item) ? t('menu.soldOutToday') : t('menu.unavailable')}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

// ══════════════════════════════════════ ELITE ══════════════════════════════════════
// По центру, без фото/иконок, курсив-описания, тонкая линия под категорией.
function EliteLayout({ ctx }: { ctx: AltLayoutCtx }) {
  const { settings, restaurant, categories, filteredItems, nm, dsc, money, accent, T, headFont, openDetail, orderable, cartQty, addToCart } = ctx
  return (
    <>
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200, padding: 18, textAlign: 'center', background: T.hbg, backdropFilter: 'saturate(200%) blur(24px)', WebkitBackdropFilter: 'saturate(200%) blur(24px)', borderBottom: `0.5px solid ${T.sep}` }}>
        <span style={{ fontSize: 13, letterSpacing: 2.2, textTransform: 'uppercase', color: T.text, fontFamily: headFont }}>{restaurant.name}</span>
      </div>
      <div style={{ position: 'fixed', top: 60, left: 0, right: 0, bottom: 0, overflowY: 'auto', textAlign: 'center' }}>
        <div style={{ padding: '30px 24px 110px', maxWidth: 560, margin: '0 auto' }}>
          {categories.map(cat => {
            const catItems = filteredItems(cat.id)
            if (catItems.length === 0) return null
            return (
              <div key={cat.id} style={{ marginBottom: 34 }}>
                <div style={{ fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', color: T.text3, marginBottom: 6 }}>{nm(cat)}</div>
                <div style={{ width: 34, height: 1, background: accent, margin: '0 auto 22px' }} />
                {catItems.map((item, i) => (
                  <div key={item.id} onClick={() => openDetail(item)} style={{ padding: '15px 0', borderBottom: i < catItems.length - 1 ? `1px solid ${T.sep}` : 'none', cursor: 'pointer' }}>
                    <div style={{ fontSize: 16, color: T.text, fontFamily: headFont, marginBottom: 5 }}>{nm(item)}</div>
                    {dsc(item) && <div style={{ fontSize: 12.5, color: T.text2, fontStyle: 'italic', lineHeight: 1.6, marginBottom: 8 }}>{dsc(item)}</div>}
                    <ItemMeta item={item} ctx={ctx} />
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 6 }}>
                      {item.price != null && <span style={{ fontSize: 12, letterSpacing: 0.5, color: accent }}>{money(item.price)}</span>}
                      {settings.allow_orders && orderable(item) && (
                        <button onClick={e => { e.stopPropagation(); addToCart(item) }} style={{ width: 26, height: 26, borderRadius: '50%', border: `1.5px solid ${accent}`, background: cartQty(item.id) > 0 ? accent : 'transparent', color: cartQty(item.id) > 0 ? '#fff' : accent, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontWeight: 700, fontSize: 11 }}>
                          {cartQty(item.id) > 0 ? cartQty(item.id) : <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" viewBox="0 0 16 16"><path d="M8 1v14M1 8h14" /></svg>}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

// ══════════════════════════════════════ MARKET WALL ══════════════════════════════════════
// Масонри-стена фото-плиток, плавающие чипсы-фильтры вместо табов.
function MarketLayout({ ctx }: { ctx: AltLayoutCtx }) {
  const { settings, restaurant, categories, filteredItems, nm, money, accent, T, headFont, cartQty, addToCart, favs, toggleFav, openDetail, orderable, trendingIds, t } = ctx
  const [cat, setCat] = useState<string>('all')
  const all: (MenuItem & { catId: string })[] = categories.flatMap(c => filteredItems(c.id).map(i => ({ ...i, catId: c.id })))
  const shown = cat === 'all' ? all : all.filter(i => i.catId === cat)
  return (
    <>
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200, padding: '14px 16px', background: T.hbg, backdropFilter: 'saturate(200%) blur(24px)', WebkitBackdropFilter: 'saturate(200%) blur(24px)' }}>
        <span style={{ fontWeight: 700, fontSize: 16, color: T.text, fontFamily: headFont }}>{restaurant.name}</span>
      </div>
      <div style={{ position: 'fixed', top: 52, left: 0, right: 0, bottom: 0, overflowY: 'auto' }}>
        <div style={{ padding: '10px 10px 110px' }}>
          <div style={{ position: 'sticky', top: 0, zIndex: 20, display: 'flex', gap: 6, overflowX: 'auto', padding: '4px 4px 12px', margin: '0 -4px', background: T.bg }}>
            <button onClick={() => setCat('all')} style={{ flexShrink: 0, fontSize: 12, fontWeight: 650, padding: '7px 14px', borderRadius: 999, background: cat === 'all' ? accent : T.surface, color: cat === 'all' ? '#fff' : T.text2, border: `1px solid ${T.sep}`, cursor: 'pointer', boxShadow: T.sh }}>{t('menu.all')}</button>
            {categories.map(c => (
              <button key={c.id} onClick={() => setCat(c.id)} style={{ flexShrink: 0, fontSize: 12, fontWeight: 650, padding: '7px 14px', borderRadius: 999, background: cat === c.id ? accent : T.surface, color: cat === c.id ? '#fff' : T.text2, border: `1px solid ${T.sep}`, cursor: 'pointer', boxShadow: T.sh }}>{nm(c)}</button>
            ))}
          </div>
          <div style={{ columnCount: 2, columnGap: 8 }}>
            {shown.map((item, i) => {
              const qty = cartQty(item.id)
              const fav = favs.includes(item.id)
              const tall = i % 3 === 0
              return (
                <div key={item.id} onClick={() => openDetail(item)} style={{ breakInside: 'avoid', marginBottom: 8, borderRadius: ctx.radius, overflow: 'hidden', position: 'relative', background: T.surface2, cursor: 'pointer', opacity: orderable(item) ? 1 : 0.5, ...cardShapeStyle(ctx) }}>
                  <div style={{ width: '100%', aspectRatio: tall ? '3/4' : '1/1', background: settings.show_photos && item.image_url ? `center/cover url(${item.image_url})` : `linear-gradient(155deg, ${accent}44, ${T.surface2})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {!(settings.show_photos && item.image_url) && <svg width="22" height="22" fill="none" stroke={accent} strokeWidth="1.6" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /></svg>}
                  </div>
                  <button onClick={e => { e.stopPropagation(); toggleFav(item.id) }} style={{ position: 'absolute', top: 8, right: 8, width: 26, height: 26, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(6px)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill={fav ? '#ff3b30' : 'none'} stroke={fav ? '#ff3b30' : '#fff'} strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" /></svg>
                  </button>
                  {trendingIds.includes(item.id) && <span style={{ position: 'absolute', top: 8, left: 8, fontSize: 9, fontWeight: 800, color: '#fff', background: 'rgba(0,0,0,0.45)', padding: '3px 7px', borderRadius: 8, textTransform: 'uppercase' }}>{t('menu.trending')}</span>}
                  <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '20px 9px 9px', background: 'linear-gradient(to top, rgba(0,0,0,0.72), transparent)' }}>
                    <div style={{ fontSize: 13, fontWeight: 650, color: '#fff', fontFamily: headFont }}>{nm(item)}</div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 3 }}>
                      {item.price != null && <span style={{ fontSize: 11.5, color: '#fff', opacity: 0.9 }}>{money(item.price)}</span>}
                      {settings.allow_orders && orderable(item) && (
                        <button onClick={e => { e.stopPropagation(); addToCart(item) }} style={{ width: 22, height: 22, borderRadius: '50%', border: 'none', background: accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 10, fontWeight: 700 }}>{qty > 0 ? qty : '+'}</button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}

// ══════════════════════════════════════ LOUNGE LIVE ══════════════════════════════════════
// Живой статус стола + аккордеон вместо табов, featured сверху.
function LoungeLayout({ ctx, tableN }: { ctx: AltLayoutCtx; tableN: string | null }) {
  const { settings, restaurant, categories, filteredItems, nm, dsc, money, accent, T, headFont, t, cartQty, addToCart, openDetail, orderable, trendingIds } = ctx
  const [openCat, setOpenCat] = useState<string | null>(categories[0]?.id ?? null)
  const featured = categories.flatMap(c => filteredItems(c.id)).filter(i => (i.tags || []).includes('popular') || (i.tags || []).includes('chef')).slice(0, 6)
  return (
    <>
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200, padding: '14px 16px 0', background: T.hbg, backdropFilter: 'saturate(200%) blur(24px)', WebkitBackdropFilter: 'saturate(200%) blur(24px)' }}>
        <span style={{ fontWeight: 700, fontSize: 16, color: T.text, fontFamily: headFont }}>{restaurant.name}</span>
        <div style={{ margin: '8px 0 10px', padding: '11px 14px', borderRadius: ctx.radius * 0.7, background: `linear-gradient(90deg, ${accent}22, ${T.surface2})`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 650, color: T.text }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#4ade80', display: 'inline-block', marginRight: 6, boxShadow: '0 0 0 3px rgba(74,222,128,.25)' }} />
              {tableN ? `${t('menu.table')} ${tableN}` : t('menu.featured')}
            </div>
          </div>
        </div>
      </div>
      <div style={{ position: 'fixed', top: 108, left: 0, right: 0, bottom: 0, overflowY: 'auto' }}>
        <div style={{ padding: '8px 14px 110px' }}>
          {featured.length > 0 && (
            <>
              <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: T.text3, marginBottom: 9 }}>{t('menu.featured')}</div>
              <div style={{ display: 'flex', gap: 10, overflowX: 'auto', margin: '0 -14px 20px', padding: '0 14px' }}>
                {featured.map(item => (
                  <div key={item.id} onClick={() => openDetail(item)} style={{ flexShrink: 0, width: 148, borderRadius: ctx.radius, background: T.surface2, padding: 12, cursor: 'pointer', ...cardShapeStyle(ctx) }}>
                    <div style={{ fontSize: 13.5, fontWeight: 650, color: T.text, fontFamily: headFont, lineHeight: 1.2 }}>{nm(item)}</div>
                    {item.price != null && <div style={{ fontSize: 12, color: accent, marginTop: 8 }}>{money(item.price)}</div>}
                  </div>
                ))}
              </div>
            </>
          )}
          {categories.map(cat => {
            const catItems = filteredItems(cat.id)
            if (catItems.length === 0) return null
            const open = openCat === cat.id
            return (
              <div key={cat.id} style={{ borderRadius: ctx.radius * 0.7, background: T.surface2, marginBottom: 8, overflow: 'hidden' }}>
                <button onClick={() => setOpenCat(open ? null : cat.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 15px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: headFont, fontWeight: 650, fontSize: 15, color: T.text }}>
                  <span>{nm(cat)}</span>
                  <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}><path d="m6 9 6 6 6-6" /></svg>
                </button>
                {open && catItems.map(item => {
                  const qty = cartQty(item.id)
                  return (
                    <div key={item.id} onClick={() => openDetail(item)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 15px', borderTop: `1px solid ${T.sep}`, cursor: 'pointer', opacity: orderable(item) ? 1 : 0.5 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: T.text, fontFamily: headFont }}>{nm(item)}</div>
                        <ItemMeta item={item} ctx={ctx} />
                      </div>
                      {item.price != null && <span style={{ fontSize: 13, color: accent, fontWeight: 600 }}>{money(item.price)}</span>}
                      {settings.allow_orders && orderable(item) && (
                        <button onClick={e => { e.stopPropagation(); addToCart(item) }} style={{ width: 28, height: 28, borderRadius: '50%', border: `1.5px solid ${accent}`, background: qty > 0 ? accent : 'transparent', color: qty > 0 ? '#fff' : accent, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontWeight: 700, fontSize: 12, flexShrink: 0 }}>
                          {qty > 0 ? qty : <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" viewBox="0 0 16 16"><path d="M8 1v14M1 8h14" /></svg>}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

// ══════════════════════════════════════ LEDGER ══════════════════════════════════════
// Плотная винная карта: имя···········цена точками-лидерами. Для меню на 100+ позиций.
function LedgerLayout({ ctx }: { ctx: AltLayoutCtx }) {
  const { settings, restaurant, categories, filteredItems, nm, dsc, money, accent, T, headFont, openDetail, orderable, cartQty, addToCart } = ctx
  return (
    <>
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200, padding: '14px 18px', background: T.hbg, backdropFilter: 'saturate(200%) blur(24px)', WebkitBackdropFilter: 'saturate(200%) blur(24px)', borderBottom: `0.5px solid ${T.sep}` }}>
        <span style={{ fontWeight: 700, fontSize: 16, color: T.text, fontFamily: headFont }}>{restaurant.name}</span>
      </div>
      <div style={{ position: 'fixed', top: 58, left: 0, right: 0, bottom: 0, overflowY: 'auto' }}>
        <div style={{ padding: '10px 18px 110px', maxWidth: 640, margin: '0 auto' }}>
          {categories.map(cat => {
            const catItems = filteredItems(cat.id)
            if (catItems.length === 0) return null
            return (
              <div key={cat.id}>
                <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: accent, margin: '20px 0 8px', paddingBottom: 5, borderBottom: `1px solid ${T.sep}` }}>{nm(cat)}</div>
                {catItems.map(item => (
                  <div key={item.id} onClick={() => openDetail(item)} style={{ cursor: 'pointer', padding: '6px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <span style={{ fontSize: 14, color: T.text, fontFamily: headFont, whiteSpace: 'nowrap' }}>{nm(item)}</span>
                      <span style={{ flex: 1, borderBottom: `1.5px dotted ${T.sep}`, marginBottom: 4, minWidth: 12 }} />
                      {item.price != null && <span style={{ fontSize: 13, color: accent, flexShrink: 0 }}>{money(item.price)}</span>}
                      {settings.allow_orders && orderable(item) && (
                        <button onClick={e => { e.stopPropagation(); addToCart(item) }} style={{ alignSelf: 'center', width: 22, height: 22, borderRadius: '50%', border: `1.5px solid ${accent}`, background: cartQty(item.id) > 0 ? accent : 'transparent', color: cartQty(item.id) > 0 ? '#fff' : accent, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontWeight: 700, fontSize: 10, flexShrink: 0 }}>
                          {cartQty(item.id) > 0 ? cartQty(item.id) : <svg width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" viewBox="0 0 16 16"><path d="M8 1v14M1 8h14" /></svg>}
                        </button>
                      )}
                    </div>
                    {dsc(item) && <div style={{ fontSize: 10.5, color: T.text3, marginTop: -2, marginBottom: 2 }}>{dsc(item)}</div>}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

export function AltMenuBody({ design, ctx, tableN }: { design: string; ctx: AltLayoutCtx; tableN: string | null }) {
  switch (design) {
    case 'apple': return <AppleLayout ctx={ctx} />
    case 'elite': return <EliteLayout ctx={ctx} />
    case 'market': return <MarketLayout ctx={ctx} />
    case 'lounge': return <LoungeLayout ctx={ctx} tableN={tableN} />
    case 'ledger': return <LedgerLayout ctx={ctx} />
    default: return null
  }
}
