import type {
  SnapshotCaptureFailedEvent,
  SnapshotCapturePose,
  SnapshotSavedEvent,
  ThumbnailGenerateEvent,
} from '@pascal-app/core'
import { MathUtils, type PerspectiveCamera } from 'three'

export function isOverlaySnapshotSave(event: SnapshotSavedEvent | undefined, projectId: string) {
  return !event?.requestId && (!event?.projectId || event.projectId === projectId)
}

export function createSnapshotQueue() {
  let tail = Promise.resolve()
  let pendingCount = 0
  return (
    event: Pick<ThumbnailGenerateEvent, 'requestId' | 'captureMode'>,
    capture: () => Promise<void>,
  ) => {
    if (pendingCount > 0 && !event.requestId && !event.captureMode) return Promise.resolve()
    pendingCount += 1
    const pending = tail.then(capture).finally(() => {
      pendingCount -= 1
    })
    tail = pending.catch(() => {})
    return pending
  }
}

export function enqueueSnapshotCapture(
  enqueue: ReturnType<typeof createSnapshotQueue>,
  version: { current: number },
  event: ThumbnailGenerateEvent,
  capture: (event: ThumbnailGenerateEvent) => Promise<void>,
  reportFailure: (failure: SnapshotCaptureFailedEvent) => void,
) {
  const requestedVersion = version.current
  return enqueue(event, async () => {
    if (requestedVersion !== version.current) {
      if (event.requestId) {
        reportFailure({
          requestId: event.requestId,
          error: 'The scene changed before capture. Try again.',
        })
      }
      return
    }
    await capture(event)
  })
}

export async function captureSnapshotScene<T>(
  capture: (restore: (callback: () => void) => void) => T | Promise<T>,
): Promise<T> {
  const restorers: Array<() => void> = []
  const errors: unknown[] = []
  let result: T | Promise<T> | undefined
  try {
    result = capture((restore) => restorers.push(restore))
  } catch (error) {
    errors.push(error)
  }
  // The offscreen render is synchronous. Restore before adopting its promise,
  // so GPU readback never leaves the interactive scene in its capture pose.
  for (const restore of restorers.reverse()) {
    try {
      restore()
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length > 0) {
    void Promise.resolve(result).catch(() => {})
    throw errors.length === 1
      ? errors[0]
      : new AggregateError(errors, 'Snapshot restoration failed')
  }
  return result as T | Promise<T>
}

export function applySnapshotCapturePose(
  camera: PerspectiveCamera,
  pose: SnapshotCapturePose,
  viewport: { width: number; height: number },
  output: { w: number; h: number },
) {
  if (
    ![...pose.position, ...pose.quaternion, pose.fov].every(Number.isFinite) ||
    pose.fov <= 0 ||
    pose.fov >= 180 ||
    ![viewport.width, viewport.height, output.w, output.h].every(
      (dimension) => Number.isFinite(dimension) && dimension >= 1,
    ) ||
    Math.abs(pose.quaternion.reduce((sum, value) => sum + value * value, 0) - 1) > 0.001
  ) {
    throw new Error('Invalid snapshot camera pose or dimensions')
  }

  const aspect = viewport.width / viewport.height
  const outputAspect = output.w / output.h
  const cropHeight =
    aspect < outputAspect ? Math.round(viewport.width / outputAspect) : viewport.height
  if (cropHeight < 1) throw new Error('Snapshot crop is too small')

  camera.position.fromArray(pose.position)
  camera.quaternion.fromArray(pose.quaternion)
  camera.aspect = aspect
  // The snapshot pipeline center-crops a viewport-sized render. Expand its
  // vertical FOV so that the cropped image keeps the authored lens framing.
  camera.fov = MathUtils.radToDeg(
    2 * Math.atan(Math.tan(MathUtils.degToRad(pose.fov) / 2) * (viewport.height / cropHeight)),
  )
  camera.zoom = 1
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld()
}

export async function runSnapshotCapture(
  requestId: string | undefined,
  busy: { current: boolean },
  capture: () => Promise<void>,
  reportFailure: (failure: SnapshotCaptureFailedEvent) => void,
) {
  if (busy.current) {
    if (requestId)
      reportFailure({ requestId, error: 'Another snapshot is being captured. Try again.' })
    return
  }

  busy.current = true
  try {
    await capture()
  } catch (error) {
    if (requestId) {
      reportFailure({
        requestId,
        error: error instanceof Error ? error.message : 'Snapshot capture failed',
      })
    } else {
      console.error('Failed to generate thumbnail:', error)
    }
  } finally {
    busy.current = false
  }
}
