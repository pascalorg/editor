import { type AnyNode, type PointCamera, sceneRegistry, useScene } from '@pascal-app/core'
import {
  ID_BUFFER_MAX_EDGE,
  type IdPassResult,
  renderIdBuffer,
  SNAPSHOT_MAX_EDGE,
} from '@pascal-app/viewer'
import * as THREE from 'three'

/** Correlated with the ephemeral picture, captured before the thumbnail setup is restored. */
export type EnrichedIdPass = IdPassResult & {
  camera: PointCamera
  nodes: Readonly<Record<string, AnyNode>>
  worldToLevels: ReadonlyMap<string, number[]>
  canvasRect: { left: number; top: number }
}
type Pending = {
  resolve: (result: EnrichedIdPass) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  taken: boolean
}
const pending = new Map<string, Pending>()
const cancelled = new Set<string>()
const ID_PASS_TIMEOUT_MS = 12_000
const CANCELLED_LIMIT = 64

export function isIdPassCancelled(requestId: string | undefined): boolean {
  return Boolean(requestId && cancelled.has(requestId))
}

export function expectIdPass(requestId: string): Promise<EnrichedIdPass> {
  cancelled.delete(requestId)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => cancelIdPass(requestId, 'No id buffer came back from the 3D view'),
      ID_PASS_TIMEOUT_MS,
    )
    pending.set(requestId, { resolve, reject, timer, taken: false })
  })
}

export function cancelIdPass(requestId: string, reason: string) {
  cancelled.delete(requestId)
  cancelled.add(requestId)
  if (cancelled.size > CANCELLED_LIMIT) {
    const oldest = cancelled.values().next().value
    if (oldest !== undefined) cancelled.delete(oldest)
  }
  const waiting = pending.get(requestId)
  if (!waiting) return
  clearTimeout(waiting.timer)
  pending.delete(requestId)
  waiting.reject(new Error(reason))
}

export function takeIdPass(requestId: string | undefined) {
  const waiting = requestId ? pending.get(requestId) : undefined
  if (!waiting || waiting.taken || !requestId) return null
  waiting.taken = true
  const settle = (result: EnrichedIdPass) => {
    if (pending.get(requestId) !== waiting) return
    clearTimeout(waiting.timer)
    pending.delete(requestId)
    waiting.resolve(result)
  }
  return {
    fail: (reason: string) => cancelIdPass(requestId, reason),
    run: ({
      renderer,
      scene,
      camera,
      target,
      width,
      height,
      cropRegion,
      canvasRect,
    }: {
      renderer: unknown
      scene: THREE.Scene
      camera: THREE.PerspectiveCamera | THREE.OrthographicCamera
      target: [number, number, number] | null
      width: number
      height: number
      cropRegion: { x: number; y: number; width: number; height: number }
      canvasRect: { left: number; top: number }
    }) => {
      if (pending.get(requestId) !== waiting) return
      // Same integer crop, snapshot clamp, then JPEG downscale as the picture encoder.
      const x = Math.round(cropRegion.x * width)
      const y = Math.round(cropRegion.y * height)
      const sourceW = Math.round(cropRegion.width * width)
      const sourceH = Math.round(cropRegion.height * height)
      const clamp = Math.min(1, SNAPSHOT_MAX_EDGE / Math.max(sourceW, sourceH))
      const clampedW = Math.round(sourceW * clamp)
      const clampedH = Math.round(sourceH * clamp)
      const scale = Math.min(1, ID_BUFFER_MAX_EDGE / Math.max(clampedW, clampedH))
      try {
        const position = camera.getWorldPosition(new THREE.Vector3())
        const look = camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(8).add(position)
        const pointCamera: PointCamera = {
          position: position.toArray(),
          target: target ?? look.toArray(),
          fov: camera instanceof THREE.PerspectiveCamera ? camera.fov : 50,
          aspect: width / height,
          projection: camera instanceof THREE.OrthographicCamera ? 'orthographic' : 'perspective',
          ...(camera instanceof THREE.OrthographicCamera
            ? { viewWidth: (camera.right - camera.left) / camera.zoom }
            : {}),
        }
        const nodes = useScene.getState().nodes as Readonly<Record<string, AnyNode>>
        const worldToLevels = new Map<string, number[]>()
        for (const node of Object.values(nodes)) {
          if (node.type !== 'level') continue
          const object = sceneRegistry.nodes.get(node.id)
          if (!object) continue
          object.updateWorldMatrix(true, false)
          worldToLevels.set(
            node.id,
            new THREE.Matrix4().copy(object.matrixWorld).invert().toArray(),
          )
        }
        const read = renderIdBuffer(renderer, scene, camera, {
          width: Math.max(1, Math.round(clampedW * scale)),
          height: Math.max(1, Math.round(clampedH * scale)),
          viewOffset: {
            fullWidth: width,
            fullHeight: height,
            x,
            y,
            width: sourceW,
            height: sourceH,
          },
        })
        read.then(
          (result) => settle({ ...result, camera: pointCamera, nodes, worldToLevels, canvasRect }),
          (error) => cancelIdPass(requestId, String(error)),
        )
      } catch (error) {
        cancelIdPass(requestId, error instanceof Error ? error.message : String(error))
      }
    },
  }
}
