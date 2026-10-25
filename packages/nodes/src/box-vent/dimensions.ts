import type { BoxVentNode } from '@pascal-app/core'

/** Keep editable subparts inside the housing's physical envelope. */
export function boxVentDimensions(node: BoxVentNode) {
  const width = Math.max(0.01, node.width)
  const depth = Math.max(0.01, node.depth)
  const height = Math.max(0.015, node.height)
  const baseInset = Math.max(
    0,
    Math.min(node.baseInset ?? 0.06, Math.min(width, depth) / 2 - 0.005),
  )
  const capHeight = Math.max(0.005, Math.min(node.capHeight ?? 0.07, height - 0.01))
  return {
    width,
    depth,
    height,
    baseInset,
    capHeight,
    baseHeight: Math.max(0.005, Math.min(node.baseHeight ?? 0.04, height - 0.005)),
    cornerBevel: Math.max(
      0,
      Math.min(node.cornerBevel ?? 0.012, (Math.min(width, depth) - 2 * baseInset) / 2 - 0.001),
    ),
    capGap: Math.max(0, Math.min(node.capGap ?? 0, height - 0.01 - capHeight)),
  }
}

export function boxVentDimensionPatch(
  node: BoxVentNode,
  patch: Partial<BoxVentNode>,
): Partial<BoxVentNode> {
  const dimensions = boxVentDimensions(node)
  return Object.keys(patch).some((key) => key in dimensions) ? dimensions : {}
}
