import type { SlabNode } from '@pascal-app/core/schema'
import { BoxGeometry, Group, Mesh, type MeshStandardMaterial } from 'three'
import {
  type FormworkScope,
  PANEL_GAP,
  PANEL_THICKNESS,
  SCAFFOLD_POST_SIZE,
  scaffoldMaterial,
  WALER_DEPTH,
  WALER_HEIGHT,
  walerMaterial,
} from './geometry-shared'
import type { FormworkAssemblyNode } from './schema'

/**
 * Slab table form: a decked soffit on joists and bearers, propped off the floor
 * below, with edge forms standing around the rim.
 *
 * This is the one kind whose formwork is loaded downwards rather than sideways.
 * Nothing clamps or ties; the deck carries the wet concrete's dead weight to
 * props, so the parts are props and bearers, and the soffit — not the sides —
 * is the big number in the bill.
 *
 * Built in level-space X/Z, because a slab has no `position` of its own and its
 * polygon is already in level coordinates. Y is the soffit level: the solid
 * occupies `[elevation − thickness, elevation]`, so the deck sits just under
 * `elevation − thickness`.
 */

/** Prop grid spacing, m — the default falsework layout under a decked soffit. */
const PROP_SPACING = 1.2
const DECK_BAY = 0.6

interface Point {
  x: number
  z: number
}

function polygonOf(slab: SlabNode): Point[] {
  return slab.polygon.map(([x, z]) => ({ x, z }))
}

function boundsOf(points: Point[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const p of points) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minZ = Math.min(minZ, p.z)
    maxZ = Math.max(maxZ, p.z)
  }
  return { minX, maxX, minZ, maxZ }
}

/** Even-odd ray cast — the deck and prop grids are clipped to the real outline, not its bounding box. */
function contains(points: Point[], x: number, z: number): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i] as Point
    const b = points[j] as Point
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside
  }
  return inside
}

export function buildSlabFormwork(
  slab: SlabNode,
  node: FormworkAssemblyNode,
  scope: FormworkScope,
  material: MeshStandardMaterial,
): Group {
  const group = new Group()
  const { isFormed } = scope

  const outline = polygonOf(slab)
  if (outline.length < 3 || slab.thickness <= 0) return group
  const holes = slab.holes
    .filter((hole) => hole.length >= 3)
    .map((hole) => hole.map(([x, z]) => ({ x, z })))

  // The deck bears the soffit, so its top face is the soffit level itself.
  const soffitY = slab.elevation - slab.thickness
  const deckY = soffitY - PANEL_THICKNESS / 2
  const bounds = boundsOf(outline)

  const inSlab = (x: number, z: number) =>
    contains(outline, x, z) && !holes.some((hole) => contains(hole, x, z))

  // Decking: boards running in X, split into bays across Z, each trimmed to
  // the part of the bay that is over concrete. A slab cast on ground takes no
  // deck at all, which is why this reads the solver rather than the polygon.
  if (isFormed('soffit')) {
    const panelWidth = node.panelWidth || DECK_BAY
    const zCount = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / panelWidth))
    const zStep = (bounds.maxZ - bounds.minZ) / zCount
    const xCount = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / panelWidth))
    const xStep = (bounds.maxX - bounds.minX) / xCount
    for (let zi = 0; zi < zCount; zi++) {
      const z = bounds.minZ + (zi + 0.5) * zStep
      for (let xi = 0; xi < xCount; xi++) {
        const x = bounds.minX + (xi + 0.5) * xStep
        if (!inSlab(x, z)) continue
        const board = new Mesh(
          new BoxGeometry(xStep - PANEL_GAP, PANEL_THICKNESS, zStep - PANEL_GAP),
          material,
        )
        board.name = `panel-soffit-${zi}-${xi}`
        board.position.set(x, deckY, z)
        group.add(board)
      }
    }

    // Bearers under the deck, then props off the floor below. `walerSpacing`
    // names the joist centres and `tieSpacing` the bearer centres — the slab
    // reading of the same two fields a wall uses for walers and ties.
    const joistSpacing = slab.walerSpacing ?? 0.4
    const joistY = deckY - PANEL_THICKNESS / 2 - WALER_HEIGHT / 2
    const joistCount = Math.max(1, Math.round((bounds.maxZ - bounds.minZ) / joistSpacing))
    for (let i = 0; i <= joistCount; i++) {
      const z = bounds.minZ + (i / joistCount) * (bounds.maxZ - bounds.minZ)
      const midX = (bounds.minX + bounds.maxX) / 2
      if (!inSlab(midX, Math.min(z + 1e-3, bounds.maxZ - 1e-3))) continue
      const joist = new Mesh(
        new BoxGeometry(bounds.maxX - bounds.minX, WALER_HEIGHT, WALER_DEPTH),
        walerMaterial,
      )
      joist.name = `waler-joist-${i}`
      joist.position.set(midX, joistY, z)
      group.add(joist)
    }

    // Props stand from the floor the deck is erected off. Without a stated
    // soffit height there is no floor to reach, so a nominal storey is used —
    // the length is the estimator's number, and it lives on the node.
    const propSpacing = slab.tieSpacing ?? PROP_SPACING
    const propTop = joistY - WALER_HEIGHT / 2
    const propLength = slab.soffitHeightAboveSupport ?? Math.max(0.5, slab.elevation + 2.4)
    const propY = propTop - propLength / 2
    const xProps = Math.max(1, Math.round((bounds.maxX - bounds.minX) / propSpacing))
    const zProps = Math.max(1, Math.round((bounds.maxZ - bounds.minZ) / propSpacing))
    for (let xi = 0; xi <= xProps; xi++) {
      for (let zi = 0; zi <= zProps; zi++) {
        const x = bounds.minX + (xi / xProps) * (bounds.maxX - bounds.minX)
        const z = bounds.minZ + (zi / zProps) * (bounds.maxZ - bounds.minZ)
        if (!inSlab(x, z)) continue
        const prop = new Mesh(
          new BoxGeometry(SCAFFOLD_POST_SIZE, propLength, SCAFFOLD_POST_SIZE),
          scaffoldMaterial,
        )
        prop.name = `prop-${xi}-${zi}`
        prop.position.set(x, propY, z)
        group.add(prop)
      }
    }
  }

  // Edge forms around the rim and around every hole. `edgeFaceCount: 2` is an
  // upstand or downstand edge beam — concrete pushes on both sides of the rim,
  // so the board is doubled outside and in.
  if (isFormed('edge')) {
    const faceCount = slab.edgeFaceCount ?? 1
    const centreY = soffitY + slab.thickness / 2
    const rims: Array<{ name: string; points: Point[]; outward: 1 | -1 }> = [
      { name: 'rim', points: outline, outward: 1 },
      ...holes.map((hole, i) => ({ name: `hole-${i}`, points: hole, outward: -1 as const })),
    ]
    for (const rim of rims) {
      for (let i = 0; i < rim.points.length; i++) {
        const a = rim.points[i] as Point
        const b = rim.points[(i + 1) % rim.points.length] as Point
        const dx = b.x - a.x
        const dz = b.z - a.z
        const length = Math.hypot(dx, dz)
        if (length <= PANEL_GAP) continue
        // Offsets stack outward from the concrete face, so a doubled edge beam
        // board is not drawn inside the slab it is forming.
        for (let layer = 0; layer < faceCount; layer++) {
          const offset = rim.outward * (PANEL_THICKNESS / 2 + layer * PANEL_THICKNESS)
          const nx = (-dz / length) * offset
          const nz = (dx / length) * offset
          const board = new Mesh(new BoxGeometry(length, slab.thickness, PANEL_THICKNESS), material)
          board.name = faceCount > 1 ? `panel-${rim.name}-${i}-${layer}` : `panel-${rim.name}-${i}`
          board.position.set(a.x + dx / 2 + nx, centreY, a.z + dz / 2 + nz)
          board.rotation.y = Math.atan2(-dz, dx)
          group.add(board)
        }
      }
    }
  }

  return group
}
