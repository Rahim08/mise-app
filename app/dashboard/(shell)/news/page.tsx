'use client'
// Новости (лента объявлений). Порт native/Mise/Mise/NewsView.swift на web.
// Публикует owner/manager (на этом дашборде — всегда owner), читают все сотрудники.
// priority — колонка из отдельной миграции (news-priority-2026-06.sql); если её нет,
// insert с priority получит 400 — тогда сохраняем без неё и прячем контрол (см. save()).
import { useEffect, useState } from 'react'
import { db } from '@/lib/db'
import { notify as pushNotify } from '@/lib/notifyClient'
import { useI18n } from '@/lib/i18n'
import { Card, Btn, Badge, Field, Spinner, Container, inputStyle, type Tone } from '@/components/ui'
import { useDash } from '@/components/dash/context'
import { timeAgo } from '@/components/dash/shared'
import './news-web.css'

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
  const [loadError, setLoadError] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'urgent' | 'important'>('all')
  const [priorityOk, setPriorityOk] = useState(true)
  const [kind, setKind] = useState('info')
  const [priority, setPriority] = useState('normal')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    const { data, error } = await db.from('news_posts').select('*').eq('restaurant_id', restaurantId)
      .order('created_at', { ascending: false }).limit(100)
    setLoading(false)
    // Ошибка сети/RLS не должна стирать уже показанную ленту (была бы ложная "Новостей нет").
    if (error) { console.error('[news] load failed', error); setLoadError(true); return }
    setLoadError(false)
    const rows = (data || []) as Post[]
    rows.sort((a, b) => (PRIORITY[b.priority || 'normal']?.rank ?? 0) - (PRIORITY[a.priority || 'normal']?.rank ?? 0) || b.created_at.localeCompare(a.created_at))
    setPosts(rows)
  }

  useEffect(() => { if (restaurantId) load() }, [restaurantId])

  const publish = async () => {
    if (!body.trim()) return
    setPublishing(true)
    // created_by/created_by_name — тот же паттерн, что NewsCompose на iOS (NewsView.swift:195):
    // owner-дашборд не имеет staff-строки, поэтому фиксированный id "owner".
    const base = { restaurant_id: restaurantId, kind, title: title.trim() || null, body: body.trim(), created_by: 'owner', created_by_name: tr('role.owner') }
    let { error } = priorityOk
      ? await db.from('news_posts').insert({ ...base, priority })
      : await db.from('news_posts').insert(base)
    if (error && /priority/.test(error.message)) {
      // Миграция news-priority-2026-06.sql не применена — сохраняем без priority и прячем контрол.
      setPriorityOk(false)
      ;({ error } = await db.from('news_posts').insert(base))
    }
    setPublishing(false)
    if (error) { alert(tr('dash.notSaved') + error.message); return }
    const pfx = priority === 'urgent' ? tr('nw.pUrgent') + ' · ' : priority === 'important' ? tr('nw.pImportant') + ' · ' : ''
    const head = pfx + (title.trim() || tr(KIND[kind]?.label || 'nw.kInfo'))
    pushNotify({ type: 'news', title: head, body: base.body, audience: { all: true }, data: { module: 'news' } })
    setTitle(''); setBody(''); setKind('info'); setPriority('normal')
    await load()
  }

  const removePost = async (id: string) => {
    const { error } = await db.from('news_posts').delete().eq('id', id)
    setDeleteConfirm(null)
    if (error) { alert(tr('dash.notSaved') + error.message); return }
    await load()
  }

  const kindOptions = Object.entries(KIND).map(([value, k]) => ({ value, label: tr(k.label) }))
  const priorityOptions = Object.entries(PRIORITY).map(([value, p]) => ({ value, label: tr(p.label) }))
  const visiblePosts = posts.filter(post => {
    if (filter !== 'all' && post.priority !== filter) return false
    const text = `${post.title || ''} ${post.body} ${post.created_by_name || ''}`.toLocaleLowerCase(locale)
    return text.includes(search.trim().toLocaleLowerCase(locale))
  })

  return (
    <Container size="wide" style={{ maxWidth: 1320 }}>
      <header className="news-web-header"><h1>{tr('dash.navNews')}</h1><p>{tr('nw.sub')}</p></header>
      <div className="news-web-grid">
        <section className="news-web-feed" aria-label={tr('nw.webFeed')}>
          <div className="news-web-toolbar">
            <div className="news-web-toolbar-title"><h2>{tr('nw.webFeed')}</h2><span>{posts.length}</span></div>
            <div className="news-web-controls">
              <label className="news-web-search">
                <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
                <input value={search} onChange={event => setSearch(event.target.value)} placeholder={tr('nw.webSearch')} aria-label={tr('nw.webSearch')} />
              </label>
              <div className="news-web-filters" role="group" aria-label={tr('nw.webFilter')}>
                {(['all', 'urgent', 'important'] as const).map(value => <button key={value} type="button" aria-pressed={filter === value} className={filter === value ? 'is-active' : undefined} onClick={() => setFilter(value)}>{value === 'all' ? tr('nw.webAll') : tr(PRIORITY[value].label)}</button>)}
              </div>
            </div>
          </div>
          {loadError && <div className="news-web-error" role="alert">{tr(posts.length ? 'nw.loadFailed' : 'nw.webLoadError')} <button type="button" onClick={load}>{tr('nw.webRetry')}</button></div>}
          {loading ? <div className="news-web-loading"><Spinner /></div> : !loadError && posts.length === 0 ? (
            <Card><div className="news-web-empty">{tr('nw.empty')}</div></Card>
          ) : visiblePosts.length === 0 ? (
            !loadError && <Card><div className="news-web-empty">{tr('nw.webNoMatch')}</div></Card>
          ) : <div className="news-web-posts">
          {visiblePosts.map(p => {
            const k = KIND[p.kind] || KIND.info
            const pr = p.priority ? PRIORITY[p.priority] : null
            return (
              <Card key={p.id} style={{ borderLeft: pr?.rank ? `3px solid ${pr.tone === 'danger' ? 'var(--danger)' : 'var(--warn)'}` : undefined }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Badge tone={k.tone}>{tr(k.label)}</Badge>
                    {pr && pr.rank > 0 && <Badge tone={pr.tone}>{tr(pr.label)}</Badge>}
                  </div>
                  <button onClick={() => setDeleteConfirm(p.id)} aria-label={tr('nw.deleteConfirm')} className="ui-press" style={{ background: 'none', border: 'none', color: 'var(--tx3)', cursor: 'pointer', padding: 4 }}>
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
          </div>}
        </section>

        <aside className="news-web-compose">
          <Card>
            <h2>{tr('nw.webCompose')}</h2>
            <p>{tr('nw.webComposeHint')}</p>
            <div className="news-web-compose-selects" style={{ gridTemplateColumns: priorityOk ? '1fr 1fr' : '1fr' }}>
              <Field label={tr('nw.kind')} value={kind} onChange={setKind} select options={kindOptions} />
              {priorityOk && <Field label={tr('nw.priority')} value={priority} onChange={setPriority} select options={priorityOptions} />}
            </div>
            <Field label={tr('nw.title')} value={title} onChange={setTitle} placeholder={tr('nw.titlePh')} />
            <label className="news-web-body-label" htmlFor="news-web-body">{tr('nw.body')}</label>
            <textarea id="news-web-body" className="ui-input news-web-body" value={body} onChange={event => setBody(event.target.value)} placeholder={tr('nw.bodyPh')} style={inputStyle} rows={7} />
            <Btn onClick={publish} disabled={publishing || !body.trim()} full>{publishing ? tr('dash.saving') : tr('nw.publish')}</Btn>
          </Card>
        </aside>
      </div>
    </Container>
  )
}
