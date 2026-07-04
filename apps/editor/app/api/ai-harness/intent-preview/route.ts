import { NextResponse } from 'next/server'
import {
  type AiIntentPreviewRequest,
  buildAiIntentPreview,
} from '@/lib/ai-harness-runs/intent-preview-service'
import type { AiConversationPurpose, AiHarnessRunMode } from '@/lib/ai-harness-runs/types'
import { listInstalledProfilePacks } from '@/lib/profile-packs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asRunMode(value: unknown): AiHarnessRunMode | undefined {
  return value === 'articraft' ||
    value === 'image-to-3d' ||
    value === 'primitive' ||
    value === 'factory'
    ? value
    : undefined
}

function asConversationPurpose(value: unknown): AiConversationPurpose | undefined {
  return value === 'factory' || value === 'asset' ? value : undefined
}

function asSelection(value: unknown): AiIntentPreviewRequest['selection'] {
  if (!isRecord(value)) return undefined
  const nodeIds = Array.isArray(value.nodeIds)
    ? value.nodeIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : []
  if (!nodeIds.length) return undefined
  return {
    nodeIds,
    nodeType: typeof value.nodeType === 'string' ? value.nodeType : undefined,
    assemblyId: typeof value.assemblyId === 'string' ? value.assemblyId : undefined,
    semanticRole: typeof value.semanticRole === 'string' ? value.semanticRole : undefined,
    sourcePartKind: typeof value.sourcePartKind === 'string' ? value.sourcePartKind : undefined,
  }
}

export function parseIntentPreviewRequestBody(body: unknown): AiIntentPreviewRequest | null {
  if (!isRecord(body)) return null
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  const imageAttached =
    body.imageAttached === true ||
    (isRecord(body.image) &&
      typeof body.image.dataUrl === 'string' &&
      body.image.dataUrl.length > 0)
  if (!prompt && !imageAttached) return null

  return {
    prompt,
    imageAttached,
    generationMode: asRunMode(body.generationMode ?? body.mode),
    conversationPurpose: asConversationPurpose(body.conversationPurpose),
    selection: asSelection(body.selection),
  }
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const previewRequest = parseIntentPreviewRequestBody(body)
  if (!previewRequest) {
    return NextResponse.json({ error: 'prompt or image is required' }, { status: 400 })
  }

  const installedPacks = await listInstalledProfilePacks()
  return NextResponse.json(
    buildAiIntentPreview({
      request: previewRequest,
      installedPacks,
    }),
  )
}
