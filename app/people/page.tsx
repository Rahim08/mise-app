'use client'
export const dynamic = 'force-dynamic'
import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { notify as pushNotify } from '@/lib/notifyClient'
import { renderNotify, renderCategory, renderSegments } from '@/lib/notifyStrings'
import { useTheme } from '@/hooks/useTheme'
import { AuthGate } from '@/components/AuthGate'
import { AppSwitchBrand } from '@/components/AppSwitchBrand'
import { useI18n } from '@/lib/i18n'
import { fmtDate } from '@/lib/format'
import { tCurrent } from '@/lib/i18n'
import { ScheduleTab } from '@/components/people/ScheduleTab'
import { ShiftsHub } from './tabs-shifts'
import { TasksTab } from './tabs-tasks'
import { OpsTab, PurchaseTab } from './tabs-ops'
import { SalaryTab, NotificationsTab, NotificationSettings } from './tabs-salary'
import { mondayOf, addDays, hhmm, timeRange, dayLabel, navBtn, roleLabel, getMe, Sheet, Placeholder, DOW_SHORT, DOW_FULL, MON } from '@/components/people/helpers'


// ── MAIN ─────────────────────────────────────────────────────────────────────────

// embedded: рендер внутри дашборд-shell (/dashboard/people) — без фикс-хрома,
// тема дашборда, вошедший всегда owner (staff-выбора mise_me_ у него нет).
export function PeopleApp({ restaurantId, embedded = false }: { restaurantId: string; embedded?: boolean }) {
  const { t: tr } = useI18n()
  const router = useRouter()
  const t = useTheme(embedded ? 'mise_dash_dark' : 'mise_people_dark')
  // Desktop-режим внутри shell: шире мобильных 640px. Staff-приложение не трогаем.
  const contentMaxWidth = embedded ? 1100 : 640
  const accent = t.dark ? '#5e5ce6' : '#5856d6'
  const me = embedded ? { is_owner: true } as ReturnType<typeof getMe> : getMe(restaurantId)
  const isManager = !!me.is_owner || me.role === 'manager' || me.role === 'admin'
  const [tab, setTab] = useState<string>('shifts')
  const [toast, setToast] = useState('')
  const [showNotif, setShowNotif] = useState(false)
  const [showNotifSettings, setShowNotifSettings] = useState(false)
  const [unread, setUnread] = useState(0)
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2500) }

  useEffect(() => {
    if (!me.id) return // у владельца нет staff-записи — уведомления адресуются сотрудникам
    db.from('notifications').select('id').eq('staff_id', me.id).is('read_at', null)
      .then(({ data }: any) => setUnread((data || []).length))
  }, [me.id])

  // Бейдж новых заказов на табе «Зал» — официант видит заказ, не открывая вкладку.
  const [newOrders, setNewOrders] = useState(0)
  useEffect(() => {
    const poll = () => db.from('menu_orders').select('id').eq('status', 'new')
      .then(({ data }: any) => setNewOrders((data || []).length))
    poll()
    const iv = setInterval(poll, 30000)
    return () => clearInterval(iv)
  }, [])

  if (!t.mounted) return (
    <div style={{ minHeight: embedded ? 240 : '100vh', background: embedded ? 'transparent' : t.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 24, height: 24, border: `2.5px solid ${accent}33`, borderTopColor: accent, borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  // Первый таб зависит от роли; «Зал» (стоп-лист/заказы/чек-листы/техкарты) — у всех.
  // Уведомления переехали в колокольчик хедера.
  const TABS = [
    { id: 'shifts', label: isManager ? tr('pe.schedule') : tr('pe.shiftsTab'), icon: (a: boolean) => <svg fill="none" stroke="currentColor" strokeWidth={a ? 2.2 : 1.8} viewBox="0 0 24 24" width="25" height="25"><rect x="3" y="4" width="18" height="18" rx="3" /><path d="M16 2v4M8 2v4M3 10h18" /></svg> },
    { id: 'tasks', label: tr('pe.tasks'), icon: (a: boolean) => <svg fill="none" stroke="currentColor" strokeWidth={a ? 2.2 : 1.8} viewBox="0 0 24 24" width="25" height="25"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="M9 13l2 2 4-4" /></svg> },
    { id: 'ops', label: tr('pe.hall'), icon: (a: boolean) => <svg fill="none" stroke="currentColor" strokeWidth={a ? 2.2 : 1.8} viewBox="0 0 24 24" width="25" height="25"><path d="M3 9l1.2-5h15.6L21 9" /><path d="M4 9v11a1 1 0 001 1h14a1 1 0 001-1V9" /><path d="M3 9h18" /><path d="M9 21v-6h6v6" /></svg> },
    { id: 'purchase', label: tr('pe.pTab'), icon: (a: boolean) => <svg fill="none" stroke="currentColor" strokeWidth={a ? 2.2 : 1.8} viewBox="0 0 24 24" width="25" height="25"><circle cx="9" cy="21" r="1.5" /><circle cx="18" cy="21" r="1.5" /><path d="M2 3h2.2l2.2 12.4a1.5 1.5 0 001.5 1.2h9.1a1.5 1.5 0 001.5-1.2L21 7H5.3" /></svg> },
    { id: 'salary', label: tr('pe.salaryTab'), icon: (a: boolean) => <svg fill="none" stroke="currentColor" strokeWidth={a ? 2.2 : 1.8} viewBox="0 0 24 24" width="25" height="25"><rect x="2" y="6" width="20" height="13" rx="2.5" /><path d="M2 10h20" /><circle cx="17.5" cy="14.5" r="1.4" fill="currentColor" stroke="none" /></svg> },
  ]

  return (
    <div style={embedded
      ? { display: 'flex', flexDirection: 'column', fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif", WebkitFontSmoothing: 'antialiased', color: t.text }
      : { height: '100vh', overflow: 'hidden', background: t.bg, fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif", WebkitFontSmoothing: 'antialiased', color: t.text }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}} @keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}} *{box-sizing:border-box} input[type=time]{ -webkit-appearance:none }`}</style>

      {/* HEADER: standalone — фикс-шапка; embedded — строка контролов в потоке */}
      <div style={embedded
        ? { order: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginBottom: 12, maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center', boxSizing: 'border-box' as const }
        : { position: 'fixed', top: 0, left: 0, right: 0, zIndex: 300, height: 56, background: t.hbg, backdropFilter: 'saturate(200%) blur(24px)', WebkitBackdropFilter: 'saturate(200%) blur(24px)', borderBottom: `0.5px solid ${t.sep2}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px' }}>
        {!embedded && <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AppSwitchBrand name="People" accent={accent} color={t.text} muted={t.text3} size={18} />
          <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.4, color: accent, background: `${accent}1a`, padding: '2px 6px', borderRadius: 6, textTransform: 'uppercase' }}>Beta</span>
        </div>}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {me.id && (
            <button onClick={() => setShowNotif(true)} style={{ position: 'relative', width: 36, height: 36, borderRadius: '50%', background: t.fill, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.text }}>
              <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" /></svg>
              {unread > 0 && <span style={{ position: 'absolute', top: 2, right: 2, minWidth: 16, height: 16, borderRadius: 8, background: t.red, color: '#fff', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>{unread > 9 ? '9+' : unread}</span>}
            </button>
          )}
          <button onClick={() => setShowNotifSettings(true)} style={{ width: 36, height: 36, borderRadius: '50%', background: t.fill, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.text }} aria-label={tr('pe.nsTitle')}>
            <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>
          </button>
          {!embedded && <button onClick={t.toggle} style={{ width: 36, height: 36, borderRadius: '50%', background: t.fill, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.text }}>
            {t.dark
              ? <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" /></svg>
              : <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z" /></svg>}
          </button>}
          {!embedded && <button onClick={() => supabase.auth.signOut().then(() => { localStorage.removeItem('mise_restaurant_id'); router.replace('/auth/login') })} style={{ width: 36, height: 36, borderRadius: '50%', background: `${t.red}18`, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" fill="none" stroke={t.red} strokeWidth="2" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" /></svg>
          </button>}
        </div>
      </div>

      {/* CONTENT */}
      <div style={embedded
        ? { order: 2 }
        : { position: 'fixed', top: 56, left: 0, right: 0, bottom: 82, overflowY: 'auto', background: t.bg }}>
        <div style={{ padding: embedded ? '0 0 28px' : '16px 16px 28px', maxWidth: contentMaxWidth, margin: '0 auto', animation: 'fadeUp .22s ease' }}>
          {tab === 'shifts' && <ShiftsHub me={me} isManager={isManager} restaurantId={restaurantId} accent={accent} t={t} toast={showToast} />}
          {tab === 'tasks' && <TasksTab isManager={isManager} myId={me.id || ''} accent={accent} t={t} toast={showToast} />}
          {tab === 'ops' && <OpsTab me={me} isManager={isManager} restaurantId={restaurantId} accent={accent} t={t} toast={showToast} />}
          {tab === 'purchase' && <PurchaseTab me={me} isManager={isManager} accent={accent} t={t} toast={showToast} />}
          {tab === 'salary' && <SalaryTab me={me} accent={accent} t={t} />}
        </div>
      </div>

      {/* NOTIFICATIONS SHEET */}
      {showNotif && me.id && (
        <Sheet onClose={() => { setShowNotif(false); setUnread(0) }} t={t}>
          <div style={{ padding: '14px 16px 32px' }}>
            <div style={{ fontSize: 18, fontWeight: 700, textAlign: 'center', color: t.text, marginBottom: 16 }}>{tr('pe.notifications')}</div>
            <NotificationsTab myId={me.id} accent={accent} t={t} />
          </div>
        </Sheet>
      )}

      {/* NOTIFICATION SETTINGS SHEET */}
      {showNotifSettings && (
        <Sheet onClose={() => setShowNotifSettings(false)} t={t}>
          <div style={{ padding: '14px 16px 32px' }}>
            <div style={{ fontSize: 18, fontWeight: 700, textAlign: 'center', color: t.text, marginBottom: 16 }}>{tr('pe.nsTitle')}</div>
            <NotificationSettings me={me} isManager={isManager} accent={accent} t={t} />
          </div>
        </Sheet>
      )}

      {/* NAV: standalone — фикс-бар снизу; embedded — сегмент-строка над контентом */}
      <div style={embedded
        ? { order: 1, display: 'flex', gap: 2, background: t.fill, borderRadius: 12, padding: 3, marginBottom: 16, maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center', boxSizing: 'border-box' as const }
        : { position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 300, height: 82, background: t.nbg, backdropFilter: 'saturate(200%) blur(24px)', WebkitBackdropFilter: 'saturate(200%) blur(24px)', borderTop: `0.5px solid ${t.sep2}`, display: 'flex', alignItems: 'flex-start', paddingTop: 10, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        {TABS.map(tb => (
          embedded ? (
            <button key={tb.id} onClick={() => setTab(tb.id)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '8px 0', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: tab === tb.id ? 700 : 500, cursor: 'pointer', background: tab === tb.id ? t.surface : 'transparent', color: tab === tb.id ? accent : t.text3, boxShadow: tab === tb.id ? t.sh2 : 'none', transition: 'all .18s' }}>
              {tb.label}
              {tb.id === 'ops' && newOrders > 0 && <span style={{ minWidth: 15, height: 15, borderRadius: 8, background: t.red, color: '#fff', fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>{newOrders > 9 ? '9+' : newOrders}</span>}
            </button>
          ) : (
            <button key={tb.id} onClick={() => setTab(tb.id)} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, cursor: 'pointer', color: tab === tb.id ? accent : t.text3, border: 'none', background: 'none', fontFamily: 'inherit', padding: 0, fontSize: 10, fontWeight: tab === tb.id ? 700 : 500 }}>
              <span style={{ position: 'relative', transform: tab === tb.id ? 'scale(1.08)' : 'scale(1)', transition: 'transform .18s', display: 'flex' }}>
                {tb.icon(tab === tb.id)}
                {tb.id === 'ops' && newOrders > 0 && <span style={{ position: 'absolute', top: -3, right: -7, minWidth: 15, height: 15, borderRadius: 8, background: t.red, color: '#fff', fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>{newOrders > 9 ? '9+' : newOrders}</span>}
              </span>
              {tb.label}
            </button>
          )
        ))}
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)', background: t.dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.85)', backdropFilter: 'blur(16px)', color: '#fff', padding: '12px 22px', borderRadius: 22, fontSize: 14, fontWeight: 600, zIndex: 600, whiteSpace: 'nowrap', animation: 'toastIn .25s ease' }}>{toast}</div>
      )}
    </div>
  )
}

// ── ROOT ─────────────────────────────────────────────────────────────────────────

export default function PeoplePage() {
  const [restaurantId, setRestaurantId] = useState<string | null>(null)
  if (!restaurantId) return <AuthGate appId="people" appName="Mise People" onAuth={setRestaurantId} />
  return <PeopleApp restaurantId={restaurantId} />
}
