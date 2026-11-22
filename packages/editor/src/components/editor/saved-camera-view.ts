import type { AnyNode } from '@pascal-app/core'

type SavedCameraData = NonNullable<AnyNode['camera']>

import type { CameraControlsImpl } from '@react-three/drei'
import { type Camera, type OrthographicCamera, type PerspectiveCamera, Vector3 } from 'three'

export type SavedCameraMode = 'perspective' | 'orthographic'

export type SavedCameraView = {
  position: [number, number, number]
  target: [number, number, number]
  mode?: SavedCameraMode
  fov?: number
  zoom?: number
}

const MIN_PERSPECTIVE_FOV = 1
const MAX_PERSPECTIVE_FOV = 179
const capturePosition = new Vector3()
const captureTarget = new Vector3()

function isPerspective(camera: Camera): camera is PerspectiveCamera {
  return (camera as PerspectiveCamera).isPerspectiveCamera === true
}

function isOrthographic(camera: Camera): camera is OrthographicCamera {
  return (camera as OrthographicCamera).isOrthographicCamera === true
}

function clampFinite(value: number, min: number, max: number): number {
  const lo = Number.isFinite(min) ? min : Number.NEGATIVE_INFINITY
  const hi = Number.isFinite(max) ? max : Number.POSITIVE_INFINITY
  return Math.min(Math.max(value, lo), hi)
}

function finitePositive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * Reads a saved camera (node.camera), preserving optional projection and lens
 * fields while keeping older saved views with only position and target valid.
 */
export function readSavedCameraView(raw: unknown): SavedCameraView | null {
  if (!(typeof raw === 'object' && raw !== null)) return null
  const candidate = raw as {
    position?: unknown
    target?: unknown
    mode?: unknown
    fov?: unknown
    zoom?: unknown
  }
  const { position, target } = candidate
  if (!(Array.isArray(position) && Array.isArray(target))) return null
  if (position.length < 3 || target.length < 3) return null
  const tuple = [...position.slice(0, 3), ...target.slice(0, 3)]
  if (
    !tuple.every((value): value is number => typeof value === 'number' && Number.isFinite(value))
  ) {
    return null
  }

  const mode =
    candidate.mode === 'perspective' || candidate.mode === 'orthographic'
      ? candidate.mode
      : undefined
  const fov = finitePositive(candidate.fov)
  const zoom = finitePositive(candidate.zoom)

  return {
    position: [tuple[0]!, tuple[1]!, tuple[2]!],
    target: [tuple[3]!, tuple[4]!, tuple[5]!],
    ...(mode === undefined ? {} : { mode }),
    ...(fov === undefined ? {} : { fov }),
    ...(zoom === undefined ? {} : { zoom }),
  }
}

export function savedCameraMatchesInstance(camera: Camera, mode: SavedCameraMode): boolean {
  return mode === 'orthographic' ? isOrthographic(camera) : isPerspective(camera)
}

/**
 * Captures the current orbit pose together with the active projection and lens
 * (fov in perspective, settled zoom in orthographic).
 */
export function captureSavedCameraView(
  control: CameraControlsImpl,
  camera: Camera,
  fallbackMode: SavedCameraMode,
): SavedCameraData {
  control.getPosition(capturePosition)
  control.getTarget(captureTarget)
  const mode: SavedCameraMode = isOrthographic(camera)
    ? 'orthographic'
    : isPerspective(camera)
      ? 'perspective'
      : fallbackMode

  const fov =
    mode === 'perspective' && isPerspective(camera) ? finitePositive(camera.fov) : undefined
  const endZoom = finitePositive((control as unknown as { _zoomEnd?: unknown })._zoomEnd)
  const zoom =
    mode === 'orthographic' && isOrthographic(camera)
      ? (endZoom ?? finitePositive(camera.zoom))
      : undefined

  return {
    position: [capturePosition.x, capturePosition.y, capturePosition.z],
    target: [captureTarget.x, captureTarget.y, captureTarget.z],
    mode,
    ...(fov === undefined ? {} : { fov }),
    ...(zoom === undefined ? {} : { zoom }),
  }
}

/**
 * Applies a saved camera view to matching controls and camera. Missing fov
 * or zoom fields leave the current lens untouched for backwards compatibility.
 */
export function applySavedCameraView(
  control: CameraControlsImpl,
  camera: Camera,
  view: SavedCameraView,
  enableTransition: boolean,
): void {
  if (isPerspective(camera) && view.mode !== 'orthographic' && view.fov !== undefined) {
    camera.fov = clampFinite(view.fov, MIN_PERSPECTIVE_FOV, MAX_PERSPECTIVE_FOV)
    camera.updateProjectionMatrix()
  }

  void control.setLookAt(
    view.position[0],
    view.position[1],
    view.position[2],
    view.target[0],
    view.target[1],
    view.target[2],
    enableTransition,
  )

  if (isOrthographic(camera) && view.mode !== 'perspective' && view.zoom !== undefined) {
    const bounds = control as { minZoom?: number; maxZoom?: number }
    const appliedZoom = clampFinite(
      view.zoom,
      bounds.minZoom ?? Number.NEGATIVE_INFINITY,
      bounds.maxZoom ?? Number.POSITIVE_INFINITY,
    )
    void control.zoomTo(appliedZoom, enableTransition)
  }

  if (!enableTransition) {
    control.update(0)
  }
}
