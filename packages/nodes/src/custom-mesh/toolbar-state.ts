export type CustomMeshToolbarMode = 'vertex' | 'edge' | 'face'
export type CustomMeshScaleAxis = 'uniform' | 'x' | 'y' | 'z'

export type CustomMeshOperationAvailability = {
  extrude: boolean
  inset: boolean
  merge: boolean
  dissolve: boolean
  bevel: boolean
}

export function customMeshOperationAvailability(
  mode: CustomMeshToolbarMode,
  selectedCount: number,
): CustomMeshOperationAvailability {
  return {
    extrude: mode === 'face' && selectedCount === 1,
    inset: mode === 'face' && selectedCount === 1,
    merge: mode === 'vertex' && selectedCount >= 2,
    dissolve: mode === 'edge' && selectedCount === 1,
    bevel: mode === 'edge',
  }
}

export function formatCustomMeshSelectionStatus(
  mode: CustomMeshToolbarMode,
  selectedCount: number,
): string {
  const label = selectedCount === 1 ? mode : mode === 'vertex' ? 'vertices' : `${mode}s`
  return `${selectedCount} ${label}`.toUpperCase()
}

export function customMeshScaleFactors(
  axis: CustomMeshScaleAxis,
  factor: number,
): [number, number, number] {
  if (axis === 'uniform') return [factor, factor, factor]
  return [axis === 'x' ? factor : 1, axis === 'y' ? factor : 1, axis === 'z' ? factor : 1]
}

export function customMeshScaleFactorFromDrag(
  distance: number,
  handleLength: number,
  snapStep = 0,
): number {
  const safeLength = Math.max(Math.abs(handleLength), 1e-6)
  let factor = 1 + distance / safeLength
  if (Number.isFinite(snapStep) && snapStep > 0) {
    factor = Math.round(factor / snapStep) * snapStep
  }
  return Math.max(0.01, factor)
}

export function customMeshBevelWidthFromDrag(
  deltaX: number,
  deltaY: number,
  topologyExtent: number,
  viewportHeight: number,
): number {
  const safeExtent = Math.max(Math.abs(topologyExtent), 0.001)
  const safeViewportHeight = Math.max(Math.abs(viewportHeight), 1)
  return (Math.hypot(deltaX, deltaY) * safeExtent) / safeViewportHeight
}
