import { type NextRequest, NextResponse } from 'next/server'

const AI_AGENT_URL = (process.env.AI_AGENT_URL ?? 'http://127.0.0.1:8788').replace(/\/+$/, '')

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params
  const target = `${AI_AGENT_URL}/${path.map(encodeURIComponent).join('/')}`
  try {
    const response = await fetch(target, {
      method: request.method,
      headers:
        request.method === 'GET' || request.method === 'DELETE'
          ? undefined
          : { 'Content-Type': request.headers.get('content-type') ?? 'application/json' },
      body:
        request.method === 'GET' || request.method === 'DELETE' ? undefined : await request.text(),
      cache: 'no-store',
    })
    // Buffer the full upstream body before responding. Streaming
    // `response.body` through for a multi-minute /chat generation risked the
    // client receiving a truncated/empty body (then failing `response.json()`
    // with "Unexpected end of JSON input") even though the agent finished and
    // saved the session. Reading it fully here avoids that truncation.
    const bodyText = await response.text()
    return new NextResponse(bodyText, {
      status: response.status,
      headers: { 'Content-Type': response.headers.get('content-type') ?? 'application/json' },
    })
  } catch (error) {
    console.error('[ai-proxy] agent unavailable:', error)
    return NextResponse.json(
      { error: 'AI agent is unavailable. Start pascal-ai-mcp and try again.' },
      { status: 503 },
    )
  }
}

export const GET = proxy
export const POST = proxy
export const DELETE = proxy
