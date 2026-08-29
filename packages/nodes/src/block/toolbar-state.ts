export type BlockToolbarMode = 'vertex' | 'edge' | 'face'
export type BlockScaleAxis = 'uniform' | 'x' | 'y' | 'z'
export type BlockTransformTool = 'transform' | 'loop-cut' | 'bevel'

export type BlockOperationAvailability = {
  extrude: boolean
  inset: boolean
  merge: boolean
  dissolve: boolean
  bevel: boolean
}

export type BlockGizmoDimensions = {
  length: number
  radius: number
  rotationRadius: number
  planeHandleSize: number
  planeHandleOffset: number
}

export type BlockGizmoHitDimensions = {
  axisRadius: number
  scaleRadius: number
  planeSize: number
  rotationTube: number
  rotationArc: number
  rotationStart: number
}

const FIXED_BLOCK_GIZMO_DIMENSIONS: BlockGizmoDimensions = {
  length: 0.7,
  radius: 0.022,
  rotationRadius: 0.455,
  planeHandleSize: 0.14,
  planeHandleOffset: 0.175,
}

export function blockOperationAvailability(
  mode: BlockToolbarMode,
  selectedCount: number,
): BlockOperationAvailability {
  return {
    extrude: mode === 'face' && selectedCount >= 1,
    inset: mode === 'face' && selectedCount >= 1,
    merge: mode === 'vertex' && selectedCount >= 2,
    dissolve: (mode === 'edge' && selectedCount >= 1) || (mode === 'face' && selectedCount >= 2),
    bevel: mode === 'edge',
  }
}

export function formatBlockSelectionStatus(mode: BlockToolbarMode, selectedCount: number): string {
  const label = selectedCount === 1 ? mode : mode === 'vertex' ? 'vertices' : `${mode}s`
  return `${selectedCount} ${label}`.toUpperCase()
}

export function blockComponentStatus({
  mode,
  selectedCount,
  tool,
  loopCutCount,
  loopCutFactor,
  bevelSegments,
  bevelWidth,
}: {
  mode: BlockToolbarMode
  selectedCount: number
  tool: BlockTransformTool
  loopCutCount: number
  loopCutFactor: number
  bevelSegments: number
  bevelWidth: number
}): string | null {
  if (tool === 'loop-cut') {
    return `Loop Cut · ${loopCutCount} cut${loopCutCount === 1 ? '' : 's'} · factor ${loopCutFactor.toFixed(2)} · click or drag an edge · release applies · wheel changes count`
  }
  if (tool === 'bevel') {
    const width = String(Math.round(bevelWidth * 1000) / 1000)
    return `Bevel · width ${width} m · ${bevelSegments} segments · drag changes width · wheel changes segments`
  }
  return selectedCount === 0 ? `Click a ${mode} to select it` : null
}

export function blockScaleFactors(axis: BlockScaleAxis, factor: number): [number, number, number] {
  if (axis === 'uniform') return [factor, factor, factor]
  return [axis === 'x' ? factor : 1, axis === 'y' ? factor : 1, axis === 'z' ? factor : 1]
}

export function blockScaleFactorFromDrag(
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

export function blockGizmoDimensions(_topologyExtent: number): BlockGizmoDimensions {
  return FIXED_BLOCK_GIZMO_DIMENSIONS
}

export function blockGizmoHitDimensions(
  radius: number,
  planeHandleSize: number,
): BlockGizmoHitDimensions {
  const rotationStart = Math.PI / 15
  return {
    axisRadius: radius * 3,
    scaleRadius: radius * 3.2,
    planeSize: planeHandleSize * 1.1,
    rotationTube: radius * 1.5,
    rotationArc: Math.PI / 2 - rotationStart * 2,
    rotationStart,
  }
}

export function blockToolbarOffset(topologyExtent: number, gizmoLength: number): number {
  const meshRelativeOffset = Math.min(1.4, Math.max(0.9, topologyExtent * 0.25))
  const scaleHandleReach = gizmoLength * 1.2
  return Math.max(meshRelativeOffset, scaleHandleReach + 0.31)
}

export function blockBevelWidthFromDrag(
  deltaX: number,
  deltaY: number,
  {
    topologyExtent,
    projectedExtentPixels,
  }: {
    topologyExtent: number
    projectedExtentPixels: number
  },
): number {
  const safeExtent = Math.max(Math.abs(topologyExtent), 0.001)
  const safeProjectedExtent = Math.max(Math.abs(projectedExtentPixels), 1)
  return (Math.hypot(deltaX, deltaY) * safeExtent) / safeProjectedExtent
}
