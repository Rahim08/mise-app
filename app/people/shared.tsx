'use client'
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
import { mondayOf, addDays, hhmm, timeRange, dayLabel, navBtn, roleLabel, getMe, Sheet, Placeholder, DOW_SHORT, DOW_FULL, MON } from '@/components/people/helpers'


// Общие стили-хелперы вкладок и список истории выплат
// Распил page.tsx (Д2, 2026-07-18): секция вынесена без изменений логики.
export function btnB2(t: any): React.CSSProperties {
  return { padding: '8px 14px', borderRadius: 10, border: 'none', background: t.fill, color: t.text, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }
}

export function inp(t: any): React.CSSProperties {
  return { width: '100%', padding: '12px 14px', borderRadius: 12, border: `1px solid ${t.sep2}`, fontSize: 16, color: t.text, background: t.surface, fontFamily: 'inherit', outline: 'none', marginBottom: 12 }
}
export function lbl(t: any): React.CSSProperties {
  return { display: 'block', fontSize: 11, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: .4, marginBottom: 6 }
}

export function hoursOf(r: any) {
  if (!r.check_in_at || !r.check_out_at) return 0
  return Math.max(0, (new Date(r.check_out_at).getTime() - new Date(r.check_in_at).getTime()) / 3600000)
}
export function fmtHours(h: number, tr: (k: string) => string) {
  const H = Math.floor(h); const M = Math.round((h - H) * 60)
  return M ? `${H} ${tr('pe.hUnit')} ${M} ${tr('pe.mUnit')}` : `${H} ${tr('pe.hUnit')}`
}

export function clock(iso: string | null) { return iso ? new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '' }
export function HistoryList({ records, withName, name, t, accent }: { records: any[]; withName?: boolean; name?: (id: string) => string; t: any; accent: string }) {
  const { t: tr } = useI18n()
  if (records.length === 0) return null
  return (
    <>
      <div style={{ fontSize: 12, fontWeight: 600, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, padding: '8px 4px 8px' }}>{tr('pe.history')}</div>
      <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', boxShadow: t.sh }}>
        {records.map((r, i) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: i < records.length - 1 ? `0.5px solid ${t.sep2}` : 'none' }}>
            <div>
              <div style={{ fontSize: 14, color: t.text }}>{dayLabel(r.date)}{withName && name ? ` · ${name(r.staff_id)}` : ''}</div>
              <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>{clock(r.check_in_at)}{r.check_out_at ? `–${clock(r.check_out_at)}` : ''}</div>
            </div>
            {r.status === 'late'
              ? <span style={{ fontSize: 11, fontWeight: 700, color: t.orange, background: `${t.orange}1a`, padding: '3px 9px', borderRadius: 8 }}>{tr('pe.lateBadge', { n: r.late_minutes })}</span>
              : <span style={{ fontSize: 11, fontWeight: 700, color: t.green, background: `${t.green}1a`, padding: '3px 9px', borderRadius: 8 }}>{tr('pe.onTime')}</span>}
          </div>
        ))}
      </div>
    </>
  )
}

