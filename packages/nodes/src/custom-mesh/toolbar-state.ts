export type CustomMeshToolbarMode = 'vertex' | 'edge' | 'face'
export type CustomMeshScaleAxis = 'uniform' | 'x' | 'y' | 'z'
export type CustomMeshTransformTool = 'transform' | 'loop-cut' | 'bevel'

export type CustomMeshOperationAvailability = {
  extrude: boolean
  inset: boolean
  merge: boolean
  dissolve: boolean
  bevel: boolean
}

export type CustomMeshGizmoDimensions = {
  length: number
  radius: number
  rotationRadius: number
  planeHandleSize: number
  planeHandleOffset: number
}

const FIXED_CUSTOM_MESH_GIZMO_DIMENSIONS: CustomMeshGizmoDimensions = {
  length: 0.7,
  radius: 0.022,
  rotationRadius: 0.455,
  planeHandleSize: 0.14,
  planeHandleOffset: 0.175,
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

export function customMeshComponentStatus({
  mode,
  selectedCount,
  tool,
  loopCutCount,
  loopCutFactor,
  bevelSegments,
}: {
  mode: CustomMeshToolbarMode
  selectedCount: number
  tool: CustomMeshTransformTool
  loopCutCount: number
  loopCutFactor: number
  bevelSegments: number
}): string | null {
  if (tool === 'loop-cut') {
    return `Loop Cut · ${loopCutCount} cut${loopCutCount === 1 ? '' : 's'} · factor ${loopCutFactor.toFixed(2)} · click or drag an edge · release applies · wheel changes count`
  }
  if (tool === 'bevel') {
    return `Bevel · drag an edge to peel it · wheel changes segments (${bevelSegments}) · release to apply`
  }
  return selectedCount === 0 ? `Click a ${mode} to select it` : null
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

export function customMeshGizmoDimensions(_topologyExtent: number): CustomMeshGizmoDimensions {
  return FIXED_CUSTOM_MESH_GIZMO_DIMENSIONS
}

export function customMeshToolbarOffset(topologyExtent: number, gizmoLength: number): number {
  const meshRelativeOffset = Math.min(1.4, Math.max(0.9, topologyExtent * 0.25))
  const scaleHandleReach = gizmoLength * 1.2
  return Math.max(meshRelativeOffset, scaleHandleReach + 0.31)
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
