'use client'
// Новости (лента объявлений). Порт native/Mise/Mise/NewsView.swift на web.
// Публикует owner/manager (на этом дашборде — всегда owner), читают все сотрудники.
// priority — колонка из отдельной миграции (news-priority-2026-06.sql); если её нет,
// insert с priority получит 400 — тогда сохраняем без неё и прячем контрол (см. save()).
import { useEffect, useState } from 'react'
import { db } from '@/lib/db'
import { useI18n } from '@/lib/i18n'
import { Card, Btn, Badge, Field, SectionTitle, Spinner, Container, type Tone } from '@/components/ui'
import { useDash } from '@/components/dash/context'
import { timeAgo } from '@/components/dash/shared'

type Post = {
  id: string; kind: string; title?: string | null; body: string; priority?: string | null
  created_by_name?: string | null; created_at: string
}

const KIND: Record<string, { label: string; tone: Tone }> = {
  info:   { label: 'nw.kInfo',   tone: 'accent' },
  stop:   { label: 'nw.kStop',   tone: 'danger' },
  promo:  { label: 'nw.kPromo',  tone: 'ok' },
  update: { label: 'nw.kUpdate', tone: 'warn' },
}
const PRIORITY: Record<string, { label: string; tone: Tone; rank: number }> = {
  normal:    { label: 'nw.pNormal',    tone: 'neutral', rank: 0 },
  important: { label: 'nw.pImportant', tone: 'warn',    rank: 1 },
  urgent:    { label: 'nw.pUrgent',    tone: 'danger',  rank: 2 },
}

export default function NewsPage() {
  const { t: tr, locale } = useI18n()
  const { restaurant } = useDash()
  const restaurantId = restaurant?.id || ''

  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [priorityOk, setPriorityOk] = useState(true)
  const [kind, setKind] = useState('info')
  const [priority, setPriority] = useState('normal')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    const { data } = await db.from('news_posts').select('*').eq('restaurant_id', restaurantId)
      .order('created_at', { ascending: false }).limit(100)
    const rows = (data || []) as Post[]
    rows.sort((a, b) => (PRIORITY[b.priority || 'normal']?.rank ?? 0) - (PRIORITY[a.priority || 'normal']?.rank ?? 0) || b.created_at.localeCompare(a.created_at))
    setPosts(rows)
    setLoading(false)
  }

  useEffect(() => { if (restaurantId) load() }, [restaurantId])

  const publish = async () => {
    if (!body.trim()) return
    setPublishing(true)
    const base = { restaurant_id: restaurantId, kind, title: title.trim() || null, body: body.trim() }
    const { error } = priorityOk
      ? await db.from('news_posts').insert({ ...base, priority })
      : await db.from('news_posts').insert(base)
    if (error && /priority/.test(error.message)) {
      // Миграция news-priority-2026-06.sql не применена — сохраняем без priority и прячем контрол.
      setPriorityOk(false)
      await db.from('news_posts').insert(base)
    }
    setTitle(''); setBody(''); setKind('info'); setPriority('normal')
    setPublishing(false)
    await load()
  }

  const removePost = async (id: string) => {
    await db.from('news_posts').delete().eq('id', id)
    setDeleteConfirm(null)
    await load()
  }

  const kindOptions = Object.entries(KIND).map(([value, k]) => ({ value, label: tr(k.label) }))
  const priorityOptions = Object.entries(PRIORITY).map(([value, p]) => ({ value, label: tr(p.label) }))

  return (
    <Container size="normal">
      <SectionTitle title={tr('dash.navNews')} sub={tr('nw.sub')} />

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: priorityOk ? '1fr 1fr' : '1fr', gap: 4, marginBottom: 4 }}>
          <Field label={tr('nw.kind')} value={kind} onChange={setKind} select options={kindOptions} />
          {priorityOk && <Field label={tr('nw.priority')} value={priority} onChange={setPriority} select options={priorityOptions} />}
        </div>
        <Field label={tr('nw.title')} value={title} onChange={setTitle} placeholder={tr('nw.titlePh')} />
        <Field label={tr('nw.body')} value={body} onChange={setBody} placeholder={tr('nw.bodyPh')} />
        <Btn onClick={publish} disabled={publishing || !body.trim()}>{publishing ? tr('dash.saving') : tr('nw.publish')}</Btn>
      </Card>

      {loading ? <Spinner /> : posts.length === 0 ? (
        <Card><div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--tx2)', fontSize: '.88rem' }}>{tr('nw.empty')}</div></Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {posts.map(p => {
            const k = KIND[p.kind] || KIND.info
            const pr = p.priority ? PRIORITY[p.priority] : null
            return (
              <Card key={p.id} style={{ borderLeft: pr?.rank ? `3px solid ${pr.tone === 'danger' ? 'var(--danger)' : 'var(--warn)'}` : undefined }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Badge tone={k.tone}>{tr(k.label)}</Badge>
                    {pr && pr.rank > 0 && <Badge tone={pr.tone}>{tr(pr.label)}</Badge>}
                  </div>
                  <button onClick={() => setDeleteConfirm(p.id)} className="ui-press" style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', padding: 4 }}>
                    <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" /></svg>
                  </button>
                </div>
                {p.title && <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--tx)', marginBottom: 4 }}>{p.title}</div>}
                <div style={{ fontSize: '.88rem', color: 'var(--tx)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{p.body}</div>
                <div style={{ fontSize: '.74rem', color: 'var(--tx3)', marginTop: 8 }}>
                  {[p.created_by_name, timeAgo(p.created_at)].filter(Boolean).join(' · ')}
                </div>
                {deleteConfirm === p.id && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: 'var(--hairline)', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: '.8rem', color: 'var(--danger)', fontWeight: 600 }}>{tr('nw.deleteConfirm')}</span>
                    <Btn small variant="danger" onClick={() => removePost(p.id)}>{tr('bk.yesDelete')}</Btn>
                    <Btn small variant="ghost" onClick={() => setDeleteConfirm(null)}>{tr('dash.cancel')}</Btn>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </Container>
  )
}
