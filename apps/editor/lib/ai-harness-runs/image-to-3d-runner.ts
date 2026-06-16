import fs from 'node:fs/promises'
import {
  generateImageTo3DAsset,
  ImageTo3DGenerateError,
} from '@/lib/image-to-3d/generate-service'
import { appendRunEvent, isTerminalStatus, loadRun, updateRun } from './run-store'

const runningRuns = new Set<string>()
const activeControllers = new Map<string, AbortController>()

function stringParam(params: Record<string, unknown> | undefined, key: string) {
  const value = params?.[key]
  return typeof value === 'string' ? value : undefined
}

function booleanParam(params: Record<string, unknown> | undefined, key: string, fallback: boolean) {
  const value = params?.[key]
  return typeof value === 'boolean' ? value : fallback
}

async function markRunCancelled(runId: string, message = 'cancelled') {
  const run = await loadRun(runId)
  if (!run || isTerminalStatus(run.status)) return
  await updateRun(runId, {
    status: 'cancelled',
    completedAt: new Date().toISOString(),
    error: message,
  })
  await appendRunEvent(runId, {
    type: 'status',
    message,
    data: { status: 'cancelled' },
  })
}

async function shouldStopRun(runId: string, signal: AbortSignal) {
  if (signal.aborted) return true
  const run = await loadRun(runId)
  return !run || run.status === 'cancelled'
}

export function ensureImageTo3DRunRunning(runId: string) {
  if (runningRuns.has(runId)) return
  runningRuns.add(runId)
  void runImageTo3DRun(runId).finally(() => {
    runningRuns.delete(runId)
  })
}

export async function cancelImageTo3DRun(runId: string) {
  activeControllers.get(runId)?.abort()
  await markRunCancelled(runId, 'Image-to-3D generation cancelled')
}

async function runImageTo3DRun(runId: string) {
  const run = await loadRun(runId)
  if (!run || run.mode !== 'image-to-3d' || isTerminalStatus(run.status)) return
  const controller = new AbortController()
  activeControllers.set(runId, controller)

  const startedRun = await updateRun(runId, {
    status: 'running',
    startedAt: run.startedAt ?? new Date().toISOString(),
  })
  if (isTerminalStatus(startedRun.status)) {
    activeControllers.delete(runId)
    return
  }
  await appendRunEvent(runId, {
    type: 'status',
    message: 'running',
    data: { status: 'running' },
  })

  try {
    if (!run.image) throw new ImageTo3DGenerateError('image file is required', 400)
    await appendRunEvent(runId, {
      type: 'progress',
      message: 'Reference image restored; starting image-to-3D generation...',
    })

    const result = await generateImageTo3DAsset({
      image: {
        name: run.image.name,
        type: run.image.type,
        buffer: await fs.readFile(run.image.path),
      },
      prompt: run.prompt,
      displayName: stringParam(run.params, 'displayName') ?? run.prompt,
      category: stringParam(run.params, 'category') ?? 'equipment',
      provider: stringParam(run.params, 'provider'),
      save: booleanParam(run.params, 'save', false),
      onProgress: (message) => {
        void appendRunEvent(runId, { type: 'progress', message })
      },
    })

    if (await shouldStopRun(runId, controller.signal)) return
    await appendRunEvent(runId, { type: 'result', data: result })
    await updateRun(runId, {
      status: 'succeeded',
      completedAt: new Date().toISOString(),
      result,
    })
    await appendRunEvent(runId, {
      type: 'status',
      message: 'succeeded',
      data: { status: 'succeeded' },
    })
  } catch (error) {
    if (controller.signal.aborted) {
      await markRunCancelled(runId, 'Image-to-3D generation cancelled')
      return
    }
    const message = error instanceof Error ? error.message : String(error)
    await appendRunEvent(runId, { type: 'error', message })
    await updateRun(runId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: message,
    })
    await appendRunEvent(runId, { type: 'status', message: 'failed', data: { status: 'failed' } })
  } finally {
    activeControllers.delete(runId)
  }
}
