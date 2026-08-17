import type { NavigationSyncPose } from '../../store/use-editor'
import type { FloorplanViewBox } from './floorplan-preview-geometry'

export type FloorplanPreviewViewportSize = {
  width: number
  height: number
}

export function nearestEquivalentDegrees(angle: number, reference: number) {
  let next = angle
  while (next - reference > 180) next -= 360
  while (next - reference < -180) next += 360
  return next
}

export function floorplanRotationFromCameraAzimuth(azimuth: number, reference: number) {
  return nearestEquivalentDegrees((azimuth * 180) / Math.PI, reference)
}

export function cameraAzimuthFromFloorplanRotation(rotationDeg: number) {
  return (rotationDeg * Math.PI) / 180
}

export function rotateFloorplanPoint(
  point: { x: number; y: number },
  rotationDeg: number,
): { x: number; y: number } {
  if (rotationDeg === 0) return point
  const radians = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  }
}

export function visibleFloorplanViewWidth(
  viewBox: FloorplanViewBox,
  viewport: FloorplanPreviewViewportSize,
) {
  const aspect = Math.max(viewport.width, 1) / Math.max(viewport.height, 1)
  return Math.max(viewBox.width, viewBox.height * aspect)
}

export function floorplanViewBoxFromNavigationPose(
  pose: NavigationSyncPose,
  localCenter: { x: number; y: number },
  sceneRotationDeg: number,
  viewport: FloorplanPreviewViewportSize,
): FloorplanViewBox {
  const center = rotateFloorplanPoint(localCenter, sceneRotationDeg)
  const aspect = Math.max(viewport.width, 1) / Math.max(viewport.height, 1)
  const width = Math.max(pose.viewWidth, 0.001)
  const height = width / aspect
  return {
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height,
  }
}
