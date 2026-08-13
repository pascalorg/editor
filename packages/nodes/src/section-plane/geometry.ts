import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from 'three'
import type { SectionPlaneNode } from './schema'

const ACTIVE_COLOR = 0x6366f1
const INACTIVE_COLOR = 0x94a3b8

/**
 * How far the widget sits off the mathematical plane, toward the half-space
 * that survives the cut.
 *
 * The widget renders *inside* the scene's `ClippingGroup`, so it is cut by its
 * own plane. Lying exactly on it leaves every vertex at signed distance zero —
 * a coin flip per fragment that makes the widget strobe in and out. One
 * millimetre to the kept side is below the smallest dimension anyone models
 * and puts the whole quad safely on the surviving side.
 */
const KEPT_SIDE_OFFSET = 0.001

/** Length of the stalk showing which way the cut faces. */
const NORMAL_ARROW_LENGTH = 0.6

function cornerBracketPoints(half: number, arm: number, y: number): number[] {
  const points: number[] = []
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    // Two arms meeting at the corner. The trailing hop back to the corner
    // keeps all four brackets in one Line without drawing a visible diagonal
    // across the quad between them.
    points.push(
      sx * (half - arm),
      y,
      sz * half,
      sx * half,
      y,
      sz * half,
      sx * half,
      y,
      sz * (half - arm),
      sx * half,
      y,
      sz * half,
    )
  }
  return points
}

/**
 * The section-plane widget: a translucent square lying on the cutting plane,
 * a bright outline, corner brackets, and a short stalk pointing into the
 * half-space that gets removed.
 *
 * Everything is built in the node's local frame — `<ParametricNodeRenderer>`
 * applies `position` / `rotation`. At rest the cut normal is local -Y, so the
 * surviving half is below the quad.
 */
export function buildSectionPlaneGeometry(node: SectionPlaneNode): Group {
  const group = new Group()
  const size = Number.isFinite(node.size) ? Math.max(node.size, 0.5) : 12
  const half = size / 2
  const color = node.active ? ACTIVE_COLOR : INACTIVE_COLOR

  // Local +Y is the removed side at rest; `flipped` swaps which half survives,
  // so the widget and its arrow follow.
  const keptDirection = node.flipped ? 1 : -1
  const offset = KEPT_SIDE_OFFSET * keptDirection

  const fill = new Mesh(
    new PlaneGeometry(size, size),
    new MeshBasicMaterial({
      color,
      opacity: node.active ? 0.08 : 0.04,
      transparent: true,
      side: DoubleSide,
      depthWrite: false,
    }),
  )
  fill.name = 'section-plane-fill'
  // PlaneGeometry is built in XY; lay it into the XZ plane.
  fill.rotation.x = -Math.PI / 2
  fill.position.y = offset
  group.add(fill)

  const outlineMaterial = new LineBasicMaterial({
    color,
    transparent: true,
    opacity: node.active ? 0.9 : 0.5,
  })

  const outline = new Line(
    new BufferGeometry().setAttribute(
      'position',
      new Float32BufferAttribute(
        [
          -half,
          offset,
          -half,
          half,
          offset,
          -half,
          half,
          offset,
          half,
          -half,
          offset,
          half,
          -half,
          offset,
          -half,
        ],
        3,
      ),
    ),
    outlineMaterial,
  )
  outline.name = 'section-plane-outline'
  group.add(outline)

  const brackets = new Line(
    new BufferGeometry().setAttribute(
      'position',
      new Float32BufferAttribute(cornerBracketPoints(half, Math.min(half * 0.35, 1.2), offset), 3),
    ),
    outlineMaterial,
  )
  brackets.name = 'section-plane-brackets'
  group.add(brackets)

  // Stalk pointing into the half-space that is cut away, so the user can read
  // which side disappears before committing.
  const arrow = new Line(
    new BufferGeometry().setAttribute(
      'position',
      new Float32BufferAttribute([0, offset, 0, 0, -NORMAL_ARROW_LENGTH * keptDirection, 0], 3),
    ),
    outlineMaterial,
  )
  arrow.name = 'section-plane-normal'
  group.add(arrow)

  return group
}
