import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function normalizeApiKey(value: string | undefined) {
  return value?.trim().replace(/^bearer\s+/i, '') || undefined
}

function aiBaseUrl() {
  return (process.env.AI_BASE_URL || process.env.NEXT_PUBLIC_AI_BASE_URL || '').replace(/\/+$/, '')
}

function aiApiKey() {
  return normalizeApiKey(process.env.AI_API_KEY || process.env.NEXT_PUBLIC_AI_API_KEY)
}

function aiModel() {
  return process.env.AI_MODEL || process.env.NEXT_PUBLIC_AI_MODEL
}

function aiThinking() {
  const value = (process.env.AI_THINKING || 'disabled').trim().toLowerCase()
  if (value === 'enabled' || value === 'true' || value === '1') return { type: 'enabled' }
  return { type: 'disabled' }
}

export async function POST(req: NextRequest) {
  const baseUrl = aiBaseUrl()
  const apiKey = aiApiKey()
  if (!baseUrl || !apiKey) {
    return NextResponse.json(
      { error: 'AI_BASE_URL and AI_API_KEY are not configured on the server' },
      { status: 500 },
    )
  }

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const model = aiModel()
  const upstreamBody = {
    ...body,
    ...(model ? { model } : {}),
    ...(body.thinking ? {} : { thinking: aiThinking() }),
  }
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(upstreamBody),
    signal: req.signal,
  })
  const text = await res.text()

  const contentType = res.headers.get('Content-Type') || ''
  if (!contentType.toLowerCase().includes('json')) {
    return NextResponse.json(
      {
        error: `AI upstream returned non-JSON response (${res.status} ${res.statusText}). Check AI_BASE_URL.`,
        preview: text.slice(0, 500),
      },
      { status: res.ok ? 502 : res.status },
    )
  }

  return new NextResponse(text, {
    status: res.status,
    statusText: res.statusText,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'application/json',
    },
  })
}
