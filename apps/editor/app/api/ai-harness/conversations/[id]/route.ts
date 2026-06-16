import { NextResponse } from 'next/server'
import {
  deleteConversation,
  listActiveRuns,
  loadConversation,
  saveConversation,
} from '@/lib/ai-harness-runs/run-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params
  const conversation = await loadConversation(id)
  const activeRuns = await listActiveRuns(id)
  return NextResponse.json({ conversation, activeRuns })
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!isRecord(body)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const conversation = await loadConversation(id)
  await saveConversation({
    ...conversation,
    messages: Array.isArray(body.messages) ? body.messages : conversation.messages,
    activeRunIds: Array.isArray(body.activeRunIds)
      ? body.activeRunIds.filter((value): value is string => typeof value === 'string')
      : conversation.activeRunIds,
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params
  await deleteConversation(id)
  return NextResponse.json({ ok: true })
}
