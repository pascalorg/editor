import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { listConversations, saveConversation } from '@/lib/ai-harness-runs/run-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function conversationId() {
  return `conv_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`
}

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams
  const limitParam = searchParams.get('limit')
  const cursorParam = searchParams.get('cursor')
  const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : undefined
  const parsedCursor = cursorParam ? Number.parseInt(cursorParam, 10) : 0
  const limit =
    parsedLimit != null && Number.isFinite(parsedLimit)
      ? Math.min(100, Math.max(1, parsedLimit))
      : 15
  const cursor =
    parsedCursor != null && Number.isFinite(parsedCursor) ? Math.max(0, parsedCursor) : 0
  const page = await listConversations(limit + 1, cursor)
  const conversations = page.slice(0, limit)
  const nextCursor = page.length > limit ? String(cursor + conversations.length) : null
  return NextResponse.json({ conversations, nextCursor })
}

export async function POST() {
  const now = new Date().toISOString()
  const id = conversationId()
  await saveConversation({
    id,
    messages: [],
    activeRunIds: [],
    createdAt: now,
    updatedAt: now,
  })
  return NextResponse.json({ conversationId: id })
}
