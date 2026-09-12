import { useEditor } from '@pascal-app/editor'
import { findNearestPort3D, findNearestPortXZ, type ScenePort } from './ports'

export function subscribeAccessorySnapping(refresh: () => void): () => void {
  return useEditor.subscribe((state, previous) => {
    if (
      state.snappingModeByContext !== previous.snappingModeByContext ||
      state.gridSnapStep !== previous.gridSnapStep
    ) {
      refresh()
    }
  })
}

export function snapAccessoryPoint(
  point: [number, number, number],
  step: number,
  normal?: readonly [number, number, number],
): [number, number, number] {
  if (step <= 0) return [...point]
  const snapped: [number, number, number] = [
    Math.round(point[0] / step) * step,
    normal ? Math.round(point[1] / step) * step : point[1],
    Math.round(point[2] / step) * step,
  ]
  if (normal) {
    const lengthSq = normal[0] ** 2 + normal[1] ** 2 + normal[2] ** 2
    if (lengthSq > 0) {
      // Project back onto the picked face so rounding never pushes a fitting into its host.
      const distance =
        ((snapped[0] - point[0]) * normal[0] +
          (snapped[1] - point[1]) * normal[1] +
          (snapped[2] - point[2]) * normal[2]) /
        lengthSq
      return [
        snapped[0] - distance * normal[0],
        snapped[1] - distance * normal[1],
        snapped[2] - distance * normal[2],
      ]
    }
  }
  return snapped
}

export function findAccessoryPort(
  point: [number, number, number],
  ports: ScenePort[],
  enabled: boolean,
  onSurface: boolean,
): ScenePort | null {
  if (!enabled) return null
  return (onSurface ? findNearestPort3D : findNearestPortXZ)(point, ports, 0.5)
}
