'use client'
// Дашборд v2: единый shell — сайдбар (desktop) / пилюли (mobile), auth-гейт, splash.
// Модули рендерятся ВНУТРИ shell (/dashboard/analytics|stash|people|menu) в embedded-режиме
// без PIN — owner уже авторизован. Staff-страницы (/analytics, /tobacco, /people) живут отдельно.
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { db } from '@/lib/db'
import { useI18n } from '@/lib/i18n'
import { entitlements, isActiveStatus, type ModuleId } from '@/lib/plans'
import { Wordmark, WordmarkMark } from '@/components/brand'
import { Spinner } from '@/components/ui'
import { DashboardProvider, useDash } from '@/components/dash/context'
import { TabIcon, SplashScreen } from '@/components/dash/shared'

// Группа «Модули»: всё внутри shell — обычные вкладки, без PIN.
// Смены — module: 'manager' (базовый модуль, всегда в тарифе). Гости — вкладка внутри Bookings, не отдельный пункт.
const NAV_MODULES: { id: string; label: string; href: string; module?: ModuleId }[] = [
  { id: 'overview',  label: 'dash.navOverview', href: '/dashboard' },
  { id: 'shifts',    label: 'dash.navShifts',   href: '/dashboard/shifts',    module: 'manager' },
  { id: 'analytics', label: 'Analytics',        href: '/dashboard/analytics', module: 'analytics' },
  { id: 'stash',     label: 'Stash',            href: '/dashboard/stash',     module: 'stash' },
  { id: 'people',    label: 'People',           href: '/dashboard/people',    module: 'people' },
  { id: 'menu',      label: 'Menu',             href: '/dashboard/menu',      module: 'menu' },
  { id: 'bookings',  label: 'dash.navBookings', href: '/dashboard/bookings',  module: 'bookings' },
  { id: 'news',      label: 'dash.navNews',     href: '/dashboard/news',      module: 'news' },
]
const NAV_SERVICE: { id: string; label: string; href: string }[] = [
  { id: 'team',          label: 'dash.navTeam',          href: '/dashboard/team' },
  { id: 'notifications', label: 'dash.navNotifications', href: '/dashboard/notifications' },
  { id: 'settings',      label: 'dash.navSettings',      href: '/dashboard/settings' },
  { id: 'billing',       label: 'dash.navBilling',       href: '/dashboard/billing' },
]

function Shell({ children }: { children: React.ReactNode }) {
  const { t: tr } = useI18n()
  const router = useRouter()
  const pathname = usePathname()
  const { user, restaurant, authChecked } = useDash()

  // Чтение storage — только после маунта: инициализатор со storage расходится
  // с SSR-HTML и роняет гидрацию (сервер false, клиент true).
  const [showSplash, setShowSplash] = useState(false)
  const [sideCollapsed, setSideCollapsed] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  useEffect(() => {
    if (!sessionStorage.getItem('mise_splash_shown')) setShowSplash(true)
    if (localStorage.getItem('mise_dash_side_collapsed') === '1') setSideCollapsed(true)
  }, [])
  const toggleSide = () => setSideCollapsed(c => {
    const next = !c
    localStorage.setItem('mise_dash_side_collapsed', next ? '1' : '0')
    return next
  })

  // Бейдж уведомлений: новые заказы после последнего открытия ленты + low-stock табака
  // (постоянное состояние склада — не гейтится «просмотрено», лента его тоже показывает).
  const [unseen, setUnseen] = useState(0)
  useEffect(() => {
    if (!restaurant?.id) return
    const check = async () => {
      const seen = +(localStorage.getItem('mise_notif_seen') || 0)
      const [{ data }, { data: stock }] = await Promise.all([
        db.from('menu_orders').select('id, created_at, status').eq('status', 'new').limit(50),
        db.from('tobacco_stock').select('quantity_g, min_quantity_g'),
      ])
      const newOrders = (data || []).filter((o: any) => new Date(o.created_at).getTime() > seen).length
      // Порог как в ленте уведомлений (notifications/page.tsx): min_quantity_g ?? 100.
      const low = (stock || []).filter((s: any) => Number(s.quantity_g || 0) <= Number(s.min_quantity_g ?? 100)).length
      setUnseen(newOrders + low)
    }
    check()
    const iv = setInterval(check, 60000)
    return () => clearInterval(iv)
  }, [restaurant?.id])
  useEffect(() => {
    if (pathname === '/dashboard/notifications') {
      localStorage.setItem('mise_notif_seen', String(Date.now()))
      setUnseen(0)
    }
  }, [pathname])

  // Права тарифа: залоченный модуль ведёт в оплату
  const ent = entitlements(restaurant)
  const active = isActiveStatus(restaurant?.subscription_status)
  const isLocked = (m?: ModuleId) => !!m && (!active || !ent.modules.includes(m))
  const isCurrent = (href: string) => href === '/dashboard' ? pathname === '/dashboard' : !!pathname?.startsWith(href)
  const go = (item: { href: string; module?: ModuleId }) => {
    router.push(isLocked(item.module) ? '/dashboard/billing' : item.href)
  }

  // Гейт по АДРЕСУ, а не только по кнопкам сайдбара: раньше кнопка залоченного модуля
  // вела в оплату, но прямой URL (закладка, ссылка, «назад») открывал страницу целиком —
  // модуль работал без тарифа. Образец — app/dashboard/(shell)/menu/page.tsx (init()).
  // Ждём загрузки ресторана: entitlements(null) даёт минимум прав и выкинул бы владельца зря.
  const lockedPage = !!restaurant && NAV_MODULES.some(m => isCurrent(m.href) && isLocked(m.module))
  useEffect(() => {
    if (lockedPage) router.replace('/dashboard/billing')
  }, [lockedPage])

  if (!authChecked || !user) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '-apple-system,sans-serif', color: 'var(--tx2)', fontSize: '.9rem', background: 'var(--bg)' }}>
      {/* На первом (холодном) заходе бренд-момент — SplashScreen ниже; на перезаходе — вордмарк+спиннер */}
      {showSplash ? <SplashScreen onDone={() => { sessionStorage.setItem('mise_splash_shown', '1'); setShowSplash(false) }} /> : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <Wordmark size={34} />
          <Spinner compact />
        </div>
      )}
    </div>
  )

  const SideItem = ({ item, badge = 0 }: { item: { id: string; label: string; href: string; module?: ModuleId }; badge?: number }) => {
    const on = isCurrent(item.href)
    const locked = isLocked(item.module)
    const label = item.label.startsWith('dash.') ? tr(item.label) : item.label
    if (sideCollapsed) return (
      <button onClick={() => go(item)} title={label} className="ui-press" style={{
        position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 40, height: 40, borderRadius: 10, border: 'none', fontFamily: 'inherit',
        background: on ? 'var(--fill)' : 'transparent', color: on ? 'var(--tx)' : locked ? 'var(--tx3)' : 'var(--tx2)',
        cursor: 'pointer', margin: '0 auto',
      }}>
        <TabIcon id={locked ? 'lock' : item.id} size={17} />
        {badge > 0 && <span style={{ position: 'absolute', top: 7, right: 7, width: 7, height: 7, borderRadius: '50%', background: 'var(--danger)', border: '2px solid var(--surface)' }} />}
      </button>
    )
    return (
      <button onClick={() => go(item)} className="ui-press" style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        padding: '9px 12px', borderRadius: 10, border: 'none', fontFamily: 'inherit',
        fontSize: '.85rem', fontWeight: on ? 600 : 500, textAlign: 'left',
        background: on ? 'var(--fill)' : 'transparent',
        color: on ? 'var(--tx)' : locked ? 'var(--tx3)' : 'var(--tx2)', cursor: 'pointer',
      }}>
        <TabIcon id={item.id} size={16} />
        <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden' }}>{label}</span>
        {locked && <TabIcon id="lock" size={13} />}
        {badge > 0 && <span style={{ fontSize: '.65rem', fontWeight: 700, color: '#fff', background: 'var(--danger)', borderRadius: 980, padding: '1px 7px' }}>{badge}</span>}
      </button>
    )
  }

  const SectionLabel = ({ children }: { children: React.ReactNode }) =>
    sideCollapsed ? null : (
      <div style={{ fontSize: '.62rem', fontWeight: 700, color: 'var(--tx3)', textTransform: 'uppercase', letterSpacing: '.08em', padding: '0 12px', marginBottom: 6 }}>
        {children}
      </div>
    )

  const avatar = (size: number) => (
    <div style={{ width: size, height: size, borderRadius: size * 0.3, background: 'var(--fill)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: size * 0.42, fontWeight: 700, color: 'var(--tx2)' }}>
      {restaurant?.logo_url
        ? <img src={restaurant.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : (restaurant?.name || 'M')[0].toUpperCase()}
    </div>
  )

  return (
    <>
      {showSplash && <SplashScreen onDone={() => { sessionStorage.setItem('mise_splash_shown', '1'); setShowSplash(false) }} />}

      <div style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif', WebkitFontSmoothing: 'antialiased', '--dash-side-w': sideCollapsed ? '64px' : '232px' } as any}>
        <style>{`
          /* Тактильный отклик: на iPhone без :active кнопки выглядят «мёртвыми» */
          button { -webkit-tap-highlight-color: transparent; transition: transform .1s ease, opacity .15s ease, background .15s ease; }
          button:active:not(:disabled) { transform: scale(.96); opacity: .8; }
          /* Контент проявляется: crossfade + сдвиг 8px; рама (сайдбар/шапка) неподвижна */
          @keyframes dashIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
          @keyframes dashPulse { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }
          .dash-fade { animation: dashIn .16s ease-out; }
          .dash-side { display: none; }
          /* Mobile: контент не подлезает под нижний таб-бар */
          .dash-content { padding-bottom: calc(70px + env(safe-area-inset-bottom)); }
          @keyframes dashSheetIn { from { transform: translateY(100%); } to { transform: none; } }
          @media (min-width: 900px) {
            .dash-side { display: flex; }
            .dash-mobilebar, .dash-bottombar, .dash-moresheet { display: none !important; }
            .dash-content { margin-left: var(--dash-side-w, 232px); transition: margin-left .28s var(--ease); will-change: margin-left; padding-bottom: 0; }
          }
        `}</style>

        {/* Сайдбар (desktop): Модули / Сервис, аккаунт внизу */}
        <aside className="dash-side" style={{
          position: 'fixed', top: 0, left: 0, bottom: 0,
          width: sideCollapsed ? 64 : 232,
          flexDirection: 'column', padding: '20px 12px 16px',
          borderRight: 'var(--hairline)',
          /* Тон канвы (--bg), не --surface: сайдбар — часть «рамы» окна (как в Finder/Mail),
             карточки контента остаются единственной белой поверхностью и не сливаются с чромом. */
          background: 'var(--bg)', zIndex: 100, boxSizing: 'border-box',
          overflow: 'hidden', transition: 'width .28s var(--ease)', willChange: 'width', whiteSpace: 'nowrap',
        }}>
          {sideCollapsed ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <WordmarkMark size={26} />
              <button onClick={toggleSide} title={tr('dash.expand')} className="ui-press" style={{
                width: 28, height: 28, borderRadius: 8, background: 'var(--fill)', border: 'none',
                cursor: 'pointer', color: 'var(--tx2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" viewBox="0 0 12 12"><path d="M4 2l4 4-4 4" /></svg>
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px 0 12px', marginBottom: 24 }}>
              <Wordmark size={24} />
              <button onClick={toggleSide} title={tr('dash.collapse')} className="ui-press" style={{
                width: 28, height: 28, borderRadius: 8, background: 'var(--fill)', border: 'none',
                cursor: 'pointer', color: 'var(--tx2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" viewBox="0 0 12 12"><path d="M8 2L4 6l4 4" /></svg>
              </button>
            </div>
          )}

          <SectionLabel>{tr('dash.secModules')}</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {NAV_MODULES.map(item => <SideItem key={item.id} item={item} />)}
          </div>
          <div style={{ height: 1, background: 'var(--sep-c)', margin: sideCollapsed ? '10px 8px' : '14px 12px' }} />
          <SectionLabel>{tr('dash.secService')}</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {NAV_SERVICE.map(item => <SideItem key={item.id} item={item} badge={item.id === 'notifications' ? unseen : 0} />)}
          </div>
          <div style={{ flex: 1 }} />

          {/* Аккаунт */}
          {sideCollapsed ? (
            <button onClick={() => router.push('/dashboard/account')} title={tr('dash.account')} className="ui-press" style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 40, height: 40, borderRadius: 10, border: 'none', cursor: 'pointer',
              background: pathname === '/dashboard/account' ? 'var(--fill)' : 'transparent', margin: '0 auto',
            }}>
              {avatar(32)}
            </button>
          ) : (
            <button onClick={() => router.push('/dashboard/account')} className="ui-press" style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px',
              borderRadius: 12, border: 'none', fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left',
              background: pathname === '/dashboard/account' ? 'var(--fill)' : 'transparent',
            }}>
              {avatar(32)}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '.82rem', fontWeight: 600, color: 'var(--tx)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{restaurant?.name || tr('dash.myRestaurant')}</div>
                <div style={{ fontSize: '.68rem', color: 'var(--tx3)' }}>{tr('dash.account')}</div>
              </div>
            </button>
          )}
        </aside>

        {/* Шапка (mobile): логотип + колокольчик + аватар */}
        <nav className="dash-mobilebar" style={{ background: 'var(--glass-bg)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)', borderBottom: 'var(--hairline)', padding: '0 16px', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100 }}>
          <Wordmark size={22} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => router.push('/dashboard/notifications')} className="ui-press" style={{ position: 'relative', width: 32, height: 32, borderRadius: '50%', background: 'var(--fill)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tx)' }}>
              <TabIcon id="notifications" size={15} />
              {unseen > 0 && <span style={{ position: 'absolute', top: 2, right: 2, width: 9, height: 9, borderRadius: '50%', background: 'var(--danger)', border: '2px solid var(--bg)' }} />}
            </button>
            <button onClick={() => router.push('/dashboard/account')} className="ui-press" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>{avatar(32)}</button>
          </div>
        </nav>

        <div className="dash-content">
          {/* Ширину контента задаёт каждая страница сама через <Container size="normal|wide|full">
              (components/ui) — раньше здесь был фикс 880px на всё, отсюда «телефон на десктопе». */}
          <div style={{ padding: '20px 24px' }}>
            {/* key={pathname} перезапускает анимацию проявления при каждом переходе */}
            <main key={pathname} className="dash-fade">
              {/* Пока идёт редирект залоченной страницы — не монтируем модуль:
                  иначе он успевает мигнуть и сходить в БД за данными без прав. */}
              {lockedPage ? <div style={{ padding: '40px 0' }}><Spinner compact /></div> : children}
            </main>
          </div>
        </div>

        {/* Нижний таб-бар (mobile): 4 главных раздела + «Ещё» (остальное в шите).
            Заменил горизонтальные пилюли из 12 пунктов (аудит-находка 24). */}
        {(() => {
          const mainIds = ['overview', 'shifts', 'menu', 'bookings']
          const mainItems = mainIds.map(id => NAV_MODULES.find(m => m.id === id)!).filter(Boolean)
          const moreItems = [
            ...NAV_MODULES.filter(m => !mainIds.includes(m.id)),
            ...NAV_SERVICE,
            { id: 'account', label: 'dash.account', href: '/dashboard/account' },
          ]
          const labelOf = (item: { label: string }) => item.label.startsWith('dash.') ? tr(item.label) : item.label
          const moreActive = moreItems.some(m => isCurrent(m.href))
          const tab = (on: boolean, locked: boolean): React.CSSProperties => ({
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            padding: '5px 0 3px', border: 'none', background: 'none', fontFamily: 'inherit', cursor: 'pointer',
            fontSize: '.6rem', fontWeight: on ? 700 : 500,
            color: on ? 'var(--tx)' : locked ? 'var(--tx3)' : 'var(--tx2)',
          })
          return (
            <>
              <nav className="dash-bottombar" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 120, display: 'flex', background: 'var(--glass-bg)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)', borderTop: 'var(--hairline)', padding: '4px 4px calc(4px + env(safe-area-inset-bottom))' }}>
                {mainItems.map(item => {
                  const locked = isLocked(item.module)
                  return (
                    <button key={item.id} onClick={() => go(item)} style={tab(isCurrent(item.href), locked)}>
                      <TabIcon id={locked ? 'lock' : item.id} size={19} />
                      {labelOf(item)}
                    </button>
                  )
                })}
                <button onClick={() => setMoreOpen(true)} style={tab(moreActive, false)}>
                  <TabIcon id="more" size={19} />
                  {tr('dash.navMore')}
                </button>
              </nav>
              {moreOpen && (
                <div className="dash-moresheet" onClick={() => setMoreOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 130, background: 'rgba(0,0,0,.42)' }}>
                  <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: 'var(--surface)', borderRadius: '20px 20px 0 0', padding: '10px 16px calc(20px + env(safe-area-inset-bottom))', animation: 'dashSheetIn .24s cubic-bezier(.32,.72,0,1)' }}>
                    <div style={{ width: 38, height: 4, borderRadius: 2, background: 'var(--fill)', margin: '0 auto 14px' }} />
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                      {moreItems.map(item => {
                        const locked = isLocked((item as any).module)
                        const on = isCurrent(item.href)
                        return (
                          <button key={item.id} onClick={() => { setMoreOpen(false); go(item) }} className="ui-press" style={{
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                            padding: '12px 4px 10px', borderRadius: 14, border: 'none', fontFamily: 'inherit', cursor: 'pointer',
                            fontSize: '.66rem', fontWeight: on ? 700 : 500,
                            background: on ? 'var(--fill)' : 'transparent',
                            color: locked ? 'var(--tx3)' : 'var(--tx)', position: 'relative',
                          }}>
                            <span style={{ position: 'relative', display: 'flex' }}>
                              <TabIcon id={locked ? 'lock' : item.id} size={20} />
                              {item.id === 'notifications' && unseen > 0 && <span style={{ position: 'absolute', top: -3, right: -5, width: 8, height: 8, borderRadius: '50%', background: 'var(--danger)' }} />}
                            </span>
                            {labelOf(item)}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
            </>
          )
        })()}
      </div>
    </>
  )
}

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardProvider>
      <Shell>{children}</Shell>
    </DashboardProvider>
  )
}
