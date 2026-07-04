import { NextResponse } from 'next/server'
import { resolveArticraftMaxTurns } from '@/lib/ai-harness-runs/articraft-turn-budget'
import { buildAiIntentPreview } from '@/lib/ai-harness-runs/intent-preview-service'
import { createRun, listRecentRuns } from '@/lib/ai-harness-runs/run-store'
import type {
  AiConversationPurpose,
  AiHarnessRun,
  AiHarnessRunIntentRouteEvidence,
  AiHarnessRunMode,
} from '@/lib/ai-harness-runs/types'
import { listInstalledProfilePacks } from '@/lib/profile-packs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decodeJsonBody(bytes: ArrayBuffer) {
  const decoders = [
    new TextDecoder('utf-8', { fatal: true }),
    new TextDecoder('gb18030', { fatal: true }),
  ]

  for (const decoder of decoders) {
    try {
      return decoder.decode(bytes)
    } catch {
      // Try the next likely JSON body encoding.
    }
  }

  return new TextDecoder().decode(bytes)
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

export function parseRunIntentRouteEvidence(
  value: unknown,
): AiHarnessRunIntentRouteEvidence | undefined {
  if (!isRecord(value)) return undefined
  const kind = typeof value.kind === 'string' ? value.kind : ''
  const reason = typeof value.reason === 'string' ? value.reason : ''
  const confidence = typeof value.confidence === 'number' ? value.confidence : Number.NaN
  if (!kind || !reason || !Number.isFinite(confidence)) return undefined
  const requiredPack = isRecord(value.requiredPack)
    ? {
        id: typeof value.requiredPack.id === 'string' ? value.requiredPack.id : '',
        version:
          typeof value.requiredPack.version === 'string' ? value.requiredPack.version : undefined,
        installed: value.requiredPack.installed === true,
        reason:
          typeof value.requiredPack.reason === 'string' ? value.requiredPack.reason : undefined,
      }
    : undefined

  return {
    kind,
    confidence,
    reason,
    previewId: typeof value.previewId === 'string' ? value.previewId : undefined,
    requiredPack: requiredPack?.id ? requiredPack : undefined,
  }
}

export async function parseAiHarnessRunRequestBody(request: Request): Promise<unknown> {
  return JSON.parse(decodeJsonBody(await request.arrayBuffer()))
}

async function ensureRunRunning(run: AiHarnessRun) {
  if (run.mode === 'articraft') {
    const { ensureArticraftRunRunning } = await import('@/lib/ai-harness-runs/articraft-runner')
    ensureArticraftRunRunning(run.id)
  } else if (run.mode === 'image-to-3d') {
    const { ensureImageTo3DRunRunning } = await import('@/lib/ai-harness-runs/image-to-3d-runner')
    ensureImageTo3DRunRunning(run.id)
  } else if (run.mode === 'primitive') {
    const { ensurePrimitiveRunRunning } = await import('@/lib/ai-harness-runs/primitive-runner')
    ensurePrimitiveRunRunning(run.id)
  } else if (run.mode === 'factory') {
    const { ensureFactoryRunRunning } = await import('@/lib/ai-harness-runs/factory-runner')
    ensureFactoryRunRunning(run.id)
  }
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await parseAiHarnessRunRequestBody(request)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!isRecord(body)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const mode = body.mode
  if (
    !(mode === 'articraft' || mode === 'image-to-3d' || mode === 'primitive' || mode === 'factory')
  ) {
    return NextResponse.json({ error: 'Unsupported run mode' }, { status: 400 })
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!prompt && mode !== 'image-to-3d') {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
  }

  const image = isRecord(body.image)
    ? {
        name: typeof body.image.name === 'string' ? body.image.name : 'reference',
        type: typeof body.image.type === 'string' ? body.image.type : 'image/png',
        dataUrl: typeof body.image.dataUrl === 'string' ? body.image.dataUrl : '',
      }
    : undefined

  try {
    const installedPacks = await listInstalledProfilePacks()
    const preview = buildAiIntentPreview({
      request: {
        prompt: prompt || 'Generate a 3D model from the reference image',
        imageAttached: Boolean(image),
        generationMode: asRunMode(mode),
        conversationPurpose: asConversationPurpose(body.conversationPurpose),
      },
      installedPacks,
    })
    if (preview.route.kind === 'create-factory' && preview.preview.applyMode === 'blocked') {
      return NextResponse.json(
        {
          error: 'intent_blocked',
          message: preview.preview.summary,
          route: preview.route,
          preview: preview.preview,
        },
        { status: 409 },
      )
    }
    const providedIntentRoute = parseRunIntentRouteEvidence(body.intentRoute)
    const intentRoute: AiHarnessRunIntentRouteEvidence = providedIntentRoute ?? {
      kind: preview.route.kind,
      confidence: preview.route.confidence,
      reason: preview.route.reason,
      previewId: preview.preview.id,
      requiredPack: preview.route.requiredPack
        ? {
            id: preview.route.requiredPack.id,
            version: preview.route.requiredPack.version,
            installed: preview.route.requiredPack.installed,
            reason: preview.route.requiredPack.reason,
          }
        : undefined,
    }
    const run = await createRun({
      conversationId: typeof body.conversationId === 'string' ? body.conversationId : 'default',
      mode: mode as AiHarnessRunMode,
      prompt: prompt || 'Generate a 3D model from the reference image',
      articraftMode: body.articraftMode === 'static' ? 'static' : 'articulated',
      maxTurns: mode === 'articraft' ? resolveArticraftMaxTurns(prompt, body.maxTurns) : undefined,
      params: isRecord(body.params) ? body.params : undefined,
      context: body.context,
      intentRoute,
      image,
    })

    await ensureRunRunning(run)

    return NextResponse.json({ runId: run.id, conversationId: run.conversationId, run })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function GET() {
  return NextResponse.json({ runs: await listRecentRuns() })
}
