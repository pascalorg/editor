import {
  emitter,
  type SnapshotCaptureFailedEvent,
  type SnapshotCapturePose,
  type SnapshotSavedEvent,
  type ThumbnailGenerateEvent,
} from '@pascal-app/core'
import { type Camera, MathUtils, type Mesh, type Object3D, type PerspectiveCamera } from 'three'

/**
 * Pause the actual host controller without snapping its transition endpoint
 * or reconstructing private velocity/options state. Works for public controls
 * hosts too, independently of the editor's frame-loop wrapper.
 */
export function holdSnapshotControls(controller: unknown): () => void {
  if (!controller || typeof (controller as { update?: unknown }).update !== 'function')
    return () => {}
  const descriptor = Object.getOwnPropertyDescriptor(controller, 'update')
  Object.defineProperty(controller, 'update', {
    configurable: true,
    writable: true,
    value: () => false,
  })
  let restored = false
  return () => {
    if (restored) return
    if (descriptor) Object.defineProperty(controller, 'update', descriptor)
    else if (!Reflect.deleteProperty(controller as object, 'update'))
      throw new Error('Snapshot controls restoration failed')
    restored = true
  }
}

/**
 * Render updates matrices even for untouched objects. Preserve the live values,
 * not just a pose from which a different matrix could later be reconstructed.
 */
export function preserveSnapshotObjectState(root: Object3D): () => void {
  const saved = new Map<Object3D, () => void>()
  const visit = (object: Object3D) => {
    if (saved.has(object)) return
    const position = object.position.clone()
    const quaternion = object.quaternion.clone()
    const scale = object.scale.clone()
    const matrix = object.matrix.clone()
    const matrixWorld = object.matrixWorld.clone()
    const needsUpdate = object.matrixWorldNeedsUpdate
    const visible = object.visible
    const mask = object.layers.mask
    const mesh = object as Mesh
    const material = mesh.material
    const camera = object as Camera
    const inverse = camera.isCamera ? camera.matrixWorldInverse.clone() : null
    saved.set(object, () => {
      object.position.copy(position)
      if (!object.quaternion.equals(quaternion)) object.quaternion.copy(quaternion)
      object.scale.copy(scale)
      object.matrix.copy(matrix)
      object.matrixWorld.copy(matrixWorld)
      object.matrixWorldNeedsUpdate = needsUpdate
      object.visible = visible
      object.layers.mask = mask
      if (mesh.isMesh) mesh.material = material
      if (inverse) camera.matrixWorldInverse.copy(inverse)
    })
    const light = object as Object3D & { target?: Object3D; shadow?: { camera?: Object3D } }
    light.target?.traverse(visit)
    light.shadow?.camera?.traverse(visit)
  }
  root.traverse(visit)
  return () => {
    for (const restore of saved.values()) restore()
  }
}

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

/**
 * Where a captured frame goes: to the host, which stores it (a snapshot, the project's
 * thumbnail), or for an ephemeral capture straight back to its caller, stored nowhere.
 */
export function deliverSnapshot<T extends object & { resolution?: { w: number; h: number } }>(
  event: Pick<ThumbnailGenerateEvent, 'requestId' | 'ephemeral'>,
  blob: Blob,
  cameraData: T,
  onCapture: (blob: Blob, cameraData: T) => void | Promise<void>,
): void | Promise<void> {
  // An ephemeral frame is never stored: with no caller to answer, it is dropped.
  if (event.ephemeral) {
    if (event.requestId)
      emitter.emit('snapshot:captured', {
        requestId: event.requestId,
        blob,
        width: cameraData.resolution?.w ?? 0,
        height: cameraData.resolution?.h ?? 0,
      })
    return
  }
  return onCapture(blob, cameraData)
}
