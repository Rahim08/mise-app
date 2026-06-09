import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { messages, context } = await req.json()
  const key = process.env.GEMINI_API_KEY
  if (!key) return NextResponse.json({ error: 'No API key' }, { status: 500 })
  
  const prompt = `${context}\n\nВопрос: ${messages[messages.length-1].text}`
  
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  })
  const d = await r.json()
  const text = d.candidates?.[0]?.content?.parts?.[0]?.text || 'Нет ответа'
  return NextResponse.json({ text })
}
