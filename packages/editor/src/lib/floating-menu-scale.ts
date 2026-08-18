import { type Camera, OrthographicCamera, type Vector3 } from 'three'

const MIN_MENU_SCALE = 0.5
const MAX_MENU_SCALE = 1
const REF_ORTHO_ZOOM = 20
const REF_CAMERA_DISTANCE = 12

export function getFloatingMenuScale(camera: Camera, anchor: Vector3): number {
  const raw =
    camera instanceof OrthographicCamera
      ? camera.zoom / REF_ORTHO_ZOOM
      : REF_CAMERA_DISTANCE / Math.max(camera.position.distanceTo(anchor), 0.001)
  return Math.min(MAX_MENU_SCALE, Math.max(MIN_MENU_SCALE, raw))
}
