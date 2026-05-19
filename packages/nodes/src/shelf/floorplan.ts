import type { FloorplanGeometry } from '@pascal-app/core'
import type { ShelfNode } from './schema'

/**
 * 2D floor-plan representation of a shelf. The unit's outer footprint
 * projects to a rectangle of `width × depth` centered on the shelf's
 * position, rotated by its Y angle. For `bookshelf` / `cubby` with
 * columns > 1, vertical column dividers project as thin lines so the
 * grid is legible from above.
 *
 * Brackets / posts / individual boards are intentionally omitted — they
 * stack vertically under the topmost board from a top-down view and
 * adding them clutters the plan without conveying useful information.
 *
 * Coordinates are level-local meters; the floor-plan panel applies the
 * world→SVG transform via its viewBox. Rotation is radians (three.js
 * convention); the renderer converts to SVG degrees.
 */
export function buildShelfFloorplan(node: ShelfNode): FloorplanGeometry {
  const [px, , pz] = node.position
  const ry = node.rotation[1] ?? 0
  const halfW = node.width / 2
  const halfD = node.depth / 2

  // Floor-plan fill: a single neutral fill regardless of `material`.
  // 2D doesn't render the actual paint material — surfaces in plan view
  // read as outline + tone, not photoreal texture. Using a fixed light
  // gray keeps the plan visually consistent with the other furniture
  // kinds (item / column / etc.) which also render as neutral fills.
  const children: FloorplanGeometry[] = [
    {
      kind: 'rect',
      x: -halfW,
      y: -halfD,
      width: node.width,
      height: node.depth,
      fill: '#d6d3d1',
      stroke: '#1f2937',
      strokeWidth: 0.015,
      opacity: 0.9,
    },
  ]

  // Show column dividers for grid-style shelves so the cubby / bookshelf
  // grid is visible from above.
  if ((node.style === 'bookshelf' || node.style === 'cubby') && node.columns > 1) {
    const innerWidth = node.width - 2 * node.thickness
    const colStep = innerWidth / node.columns
    for (let c = 1; c < node.columns; c++) {
      const x = -innerWidth / 2 + c * colStep
      children.push({
        kind: 'line',
        x1: x,
        y1: -halfD + node.thickness,
        x2: x,
        y2: halfD - node.thickness,
        stroke: '#1f2937',
        strokeWidth: 0.012,
        opacity: 0.7,
      })
    }
  }

  return {
    kind: 'group',
    transform: { translate: [px, pz], rotate: ry },
    children,
  }
}
