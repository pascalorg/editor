import {
  getActiveRoofHeight,
  getPitchFromActiveRoofHeight,
  type RoofSegmentNode,
} from './roof-segment'

/** Resize one footprint edge while keeping its opposite edge and the crown height fixed. */
export function getRoofSegmentResizePatch(
  node: RoofSegmentNode,
  axis: 'x' | 'z',
  side: 1 | -1,
  dimension: number,
): Partial<RoofSegmentNode> {
  const initial = axis === 'x' ? node.width : node.depth
  const offset = (side * (dimension - initial)) / 2
  const rotation = node.rotation ?? 0
  const position: [number, number, number] = [
    node.position[0] + offset * (axis === 'x' ? Math.cos(rotation) : Math.sin(rotation)),
    node.position[1],
    node.position[2] + offset * (axis === 'x' ? -Math.sin(rotation) : Math.cos(rotation)),
  ]
  if (node.roofType === 'conical') return { width: dimension, depth: dimension, position }
  if (axis === 'x') return { width: dimension, position }
  const rise = getActiveRoofHeight(node)
  if (node.roofType === 'barrel')
    return { depth: dimension, barrelRise: Math.min(dimension / 2, rise), position }
  const pitch = getPitchFromActiveRoofHeight({ ...node, depth: dimension, roofHeight: rise })
  return { depth: dimension, pitch: Math.max(0, Math.min(85, pitch)), position }
}
