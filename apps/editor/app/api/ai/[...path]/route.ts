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
    return new NextResponse(response.body, {
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
