import { type NextRequest, NextResponse } from 'next/server'
import { callConfiguredAi } from '@/lib/ai-provider'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  let upstream
  try {
    upstream = await callConfiguredAi(body, req.signal)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }

  const { res, text } = upstream
  const contentType = res.headers.get('Content-Type') || ''
  if (!contentType.toLowerCase().includes('json')) {
    const preview = text.replace(/\s+/g, ' ').trim().slice(0, 300)
    return NextResponse.json(
      {
        error: `AI upstream returned non-JSON response (${res.status} ${res.statusText}). Check AI provider configuration.`,
        preview,
      },
      { status: res.ok ? 502 : res.status },
    )
  }

  return new NextResponse(text, {
    status: res.status,
    statusText: res.statusText,
    headers: {
      'Content-Type': contentType || 'application/json',
    },
  })
}
