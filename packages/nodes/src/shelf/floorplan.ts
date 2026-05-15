import type { FloorplanGeometry } from '@pascal-app/core'
import type { ShelfNode } from './schema'

/**
 * 2D floor-plan representation of a shelf. The top board (the largest
 * visible surface from above) projects to a rectangle of `width × depth`
 * centered on `(position.x, position.z)`, rotated by the shelf's Y angle.
 *
 * Brackets are intentionally omitted — they're hidden under the top
 * board from a top-down view, and adding them as separate rects clutters
 * the plan without conveying useful information at typical zoom levels.
 *
 * Coordinates are level-local meters; the floor-plan panel applies the
 * world→SVG transform via its viewBox. Rotation is radians (three.js
 * convention); the renderer converts to SVG degrees.
 *
 * Pairs with `buildShelfGeometry(node)` — the 3D builder. Same shape,
 * different output projection.
 */
export function buildShelfFloorplan(node: ShelfNode): FloorplanGeometry {
  const [px, , pz] = node.position
  const ry = node.rotation[1] ?? 0
  const halfW = node.width / 2
  const halfD = node.depth / 2

  return {
    kind: 'group',
    transform: { translate: [px, pz], rotate: ry },
    children: [
      {
        kind: 'rect',
        x: -halfW,
        y: -halfD,
        width: node.width,
        height: node.depth,
        fill: node.color,
        stroke: '#1f2937',
        strokeWidth: 0.015,
        opacity: 0.9,
      },
    ],
  }
}
