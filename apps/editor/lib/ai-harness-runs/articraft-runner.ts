import { generateModel } from '@pascal-app/articraft-bridge'
import { appendRunEvent, isTerminalStatus, loadRun, updateRun } from './run-store'

const runningRuns = new Set<string>()
const activeControllers = new Map<string, AbortController>()

function isAbortError(error: unknown) {
  return (
    error instanceof DOMException && error.name === 'AbortError'
  ) || (error instanceof Error && error.name === 'AbortError')
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

export function ensureArticraftRunRunning(runId: string) {
  if (runningRuns.has(runId)) return
  runningRuns.add(runId)
  void runArticraftRun(runId).finally(() => {
    runningRuns.delete(runId)
  })
}

export async function cancelArticraftRun(runId: string) {
  activeControllers.get(runId)?.abort()
  await markRunCancelled(runId, 'Articraft generation cancelled')
}

async function runArticraftRun(runId: string) {
  const run = await loadRun(runId)
  if (!run || run.mode !== 'articraft' || isTerminalStatus(run.status)) return
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
  await appendRunEvent(runId, { type: 'status', message: 'running', data: { status: 'running' } })

  try {
    const result = await generateModel({
      prompt: run.prompt,
      mode: run.articraftMode === 'static' ? 'static' : 'articulated',
      imagePath: run.image?.path,
      signal: controller.signal,
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
    if (isAbortError(error) || controller.signal.aborted) {
      await markRunCancelled(runId, 'Articraft generation cancelled')
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
