import { type NextRequest } from 'next/server'
import { convertToModelMessages, streamText, isStepCount, type UIMessage } from 'ai'
import { z } from 'zod'
import { buildTools, MODEL, SYSTEM_PROMPT } from '@/lib/chat-ai'
import { guardSceneApiRequest, sceneApiJson, sceneApiPreflight, withSceneApiHeaders } from '@/lib/scene-api-security'
import { getSceneStore } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'

const chatRequestSchema = z.object({
  sceneId: z.string().min(1).max(64),
  messages: z.array(z.any()).min(1).max(80),
})

export function OPTIONS(request: NextRequest) {
  return sceneApiPreflight(request)
}

export async function POST(request: NextRequest) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return sceneApiJson(request, { error: 'invalid_request', details: 'body must be valid JSON' }, { status: 400 })
  }

  const parsed = chatRequestSchema.safeParse(body)
  if (!parsed.success) {
    return sceneApiJson(request, { error: 'invalid_request', details: parsed.error.issues }, { status: 400 })
  }
  const { sceneId, messages } = parsed.data

  // Store-only, same as the GET/PUT scene routes — no live SceneBridge.
  // @pascal-app/core's zustand store is 'use client', which Next's Route
  // Handler bundler turns into a client-reference stub when actually
  // touched server-side, so the chat tools operate on the plain JSON graph
  // instead (see lib/chat-ai.ts).
  const store = await getSceneStore()
  const stored = await store.load(sceneId)
  if (!stored) {
    return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
  }

  let mutated = false
  const result = streamText({
    model: MODEL,
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages as UIMessage[]),
    tools: buildTools(stored.graph, [], () => {
      mutated = true
    }),
    stopWhen: isStepCount(6),
    onFinish: async () => {
      if (!mutated) return
      try {
        const meta = await store.save({
          id: stored.id,
          name: stored.name,
          projectId: stored.projectId,
          ownerId: stored.ownerId,
          thumbnailUrl: stored.thumbnailUrl,
          graph: stored.graph,
          expectedVersion: stored.version,
          saveMode: 'draft',
          publish: false,
          operation: 'ai_chat',
        })
        if (store.appendSceneEvent) {
          await store.appendSceneEvent({ sceneId: meta.id, version: meta.version, kind: 'ai_chat', graph: stored.graph })
        }
      } catch (error) {
        // Scene changed under us (another editor/MCP session saved first).
        // The AI's answer already streamed to the client either way.
        console.error('POST /api/chat: failed to persist mutation:', error)
      }
    },
  })

  return withSceneApiHeaders(request, result.toUIMessageStreamResponse())
}
