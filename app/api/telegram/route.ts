import { NextRequest, NextResponse } from 'next/server'
import { MISE_KNOWLEDGE } from '@/lib/miseKnowledge'

// Telegram-бот поддержки Mise. Webhook принимает апдейты, отвечает через GROQ
// строго по базе знаний (lib/miseKnowledge.ts). Публичный (для гостей/сотрудников),
// без Pro-гейта. Env: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, GROQ_API_KEY.

const TG = (token: string, method: string, body: any) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })

async function ask(question: string): Promise<string> {
  const key = process.env.GROQ_API_KEY
  if (!key) return 'Бот временно недоступен. Напишите на hello@misesuite.com.'
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: MISE_KNOWLEDGE },
          { role: 'user', content: question },
        ],
        temperature: 0.4,
        max_tokens: 600,
      }),
    })
    const d = await r.json()
    if (!r.ok) return 'Не получилось ответить. Попробуйте позже или напишите на hello@misesuite.com.'
    return d.choices?.[0]?.message?.content?.trim() || 'Не понял вопрос — переформулируйте, пожалуйста.'
  } catch {
    return 'Сервис временно недоступен. Напишите на hello@misesuite.com.'
  }
}

export async function POST(req: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  // Защита webhook: Telegram присылает заданный секрет в заголовке.
  // Если секрет не задан — блокируем все запросы (fail-closed).
  if (!secret) {
    console.error('TELEGRAM_WEBHOOK_SECRET not set — rejecting all requests')
    return NextResponse.json({ ok: false }, { status: 500 })
  }
  if (req.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  if (!token) return NextResponse.json({ ok: true }) // не настроен — молча 200

  try {
    const update = await req.json()
    const msg = update.message || update.edited_message
    const chatId = msg?.chat?.id
    const text: string = (msg?.text || '').trim()
    if (!chatId || !text) return NextResponse.json({ ok: true })

    let reply: string
    if (text === '/start') {
      reply = 'Привет! Я ассистент Mise — система управления рестораном. Спросите что угодно: тарифы, как открыть смену, добавить сотрудника, настроить QR-меню и т.д. Я отвечу на вашем языке.'
    } else if (text === '/help') {
      reply = 'Просто напишите вопрос своими словами. Примеры:\n• Что входит в тариф Business?\n• Как добавить сотрудника?\n• Как работает геоявка?\n• Где посмотреть зарплаты?'
    } else {
      reply = await ask(text)
    }

    await TG(token, 'sendMessage', { chat_id: chatId, text: reply })
  } catch {
    // Никогда не отдаём не-2xx, иначе Telegram будет ретраить
  }
  return NextResponse.json({ ok: true })
}

// Telegram бьёт POST'ом; GET — для быстрой проверки, что роут жив
export async function GET() {
  return NextResponse.json({ ok: true, bot: 'mise-support' })
}
