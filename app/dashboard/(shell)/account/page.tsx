'use client'
// Аккаунт: профиль, выход, cookie/legal, удаление аккаунта.
// Перенесено из AccountTab старого dashboard/page.tsx.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/lib/i18n'
import { openCookieSettings } from '@/components/CookieConsent'
import { Card, Btn, SectionTitle, Badge, Container } from '@/components/ui'
import { useDash } from '@/components/dash/context'
import { PLANS } from '@/components/dash/shared'

export default function AccountPage() {
  const { t: tr } = useI18n()
  const router = useRouter()
  const { restaurant, user } = useDash()
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const planName = PLANS.find(p => p.id === restaurant?.subscription_plan)?.name

  const deleteAccount = async () => {
    setDeleting(true)
    try {
      const res = await fetch('/api/account/delete', { method: 'POST' })
      const data = await res.json()
      if (data.error) { alert(data.error); return }
      await supabase.auth.signOut()
      router.replace('/auth/login')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Container size="normal">
      <SectionTitle title={tr('dash.account')} sub={tr('dash.accountSub')} />

      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: 'var(--fill)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '1.4rem', fontWeight: 700, color: 'var(--tx2)' }}>
            {restaurant?.logo_url
              ? <img src={restaurant.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : (restaurant?.name || 'M')[0].toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--tx)' }}>{restaurant?.name || tr('dash.myRestaurant')}</div>
            <div style={{ fontSize: '.8rem', color: 'var(--tx2)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.email}</div>
          </div>
          {planName && <Badge tone="accent">{planName}</Badge>}
        </div>
      </Card>

      <Card style={{ marginBottom: 14 }}>
        <button onClick={async () => { await supabase.auth.signOut(); router.replace('/auth/login') }}
          style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: '.88rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
          {tr('dash.signOut')}
        </button>
      </Card>

      <Card style={{ marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
        <button onClick={openCookieSettings}
          style={{ background: 'none', border: 'none', color: 'var(--tx2)', fontSize: '.84rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
          {tr('dash.cookieSettings')}
        </button>
        <a href="/privacy.html" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--tx2)', fontSize: '.84rem', fontWeight: 600, textDecoration: 'none' }}>{tr('dash.privacy')}</a>
        <a href="/terms.html" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--tx2)', fontSize: '.84rem', fontWeight: 600, textDecoration: 'none' }}>{tr('dash.terms')}</a>
      </Card>

      <Card style={{ border: '1px solid rgba(255,59,48,.15)' }}>
        <div style={{ fontWeight: 600, fontSize: '.9rem', marginBottom: 4, color: 'var(--tx)' }}>{tr('dash.dangerZone')}</div>
        <div style={{ fontSize: '.82rem', color: 'var(--tx2)', marginBottom: 14 }}>{tr('dash.deleteAccountNote')}</div>
        {!deleteConfirm ? (
          <Btn variant="danger" onClick={() => setDeleteConfirm(true)}>{tr('dash.deleteAccount')}</Btn>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: '.82rem', color: 'var(--danger)', fontWeight: 600 }}>{tr('dash.sureIrreversible')}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn variant="danger" small onClick={deleteAccount} disabled={deleting}>
                {deleting ? tr('dash.deleting') : tr('dash.yesDeleteAll')}
              </Btn>
              <Btn variant="ghost" small onClick={() => setDeleteConfirm(false)}>{tr('dash.cancel')}</Btn>
            </div>
          </div>
        )}
      </Card>
    </Container>
  )
}
