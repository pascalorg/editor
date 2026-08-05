import type { SlabNode } from '@pascal-app/core/schema'
import { BoxGeometry, Group, Mesh, type MeshStandardMaterial } from 'three'
import { slabPourDesign } from './design'
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
 * The spacings are not chosen here. `falseworkDesign` solves the chain — load →
 * sheathing → joists → bearers → props — and this places what it returns, the way
 * the column builder places `clampSchedule`'s rows. It matters that the chain is
 * ordered: the joist centres *are* the deck's allowable span, so a builder that
 * picked its own spacing would be drawing members checked against a load none of
 * them carries. It also means the grid tightens with slab thickness on its own,
 * which a pair of constants cannot do.
 *
 * Built in level-space X/Z, because a slab has no `position` of its own and its
 * polygon is already in level coordinates. Y is the soffit level: the solid
 * occupies `[elevation − thickness, elevation]`, so the deck sits just under
 * `elevation − thickness`.
 */

/** Deck sheet width, m — the module boards are cut from, not a structural span. */
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

/**
 * Member lines across a run of `spanM`, at no more than `spacingM` apart.
 *
 * Both ends carry a line and the interior is divided into equal bays — but the bay
 * count is rounded *up*, so the actual pitch comes out at or below the spacing the
 * check allowed. Rounding to the nearest count is the tempting version and it is
 * wrong in one direction: a 2.5 m run at a 0.6 m limit rounds to 4 bays of 0.625 m,
 * over capacity on every bay, where 5 bays of 0.5 m is merely one member dearer.
 */
function stations(startM: number, spanM: number, spacingM: number): number[] {
  if (!(spanM > 0)) return [startM]
  if (!(spacingM > 0)) return [startM, startM + spanM]
  const bays = Math.max(1, Math.ceil(spanM / spacingM - 1e-9))
  const step = spanM / bays
  return Array.from({ length: bays + 1 }, (_, i) => startM + i * step)
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

  // Falsework lines sit *on* the rim — the edge of a deck is where it most needs
  // bearing — and an even-odd ray cast is half-open, so a station exactly on the
  // boundary reads as outside and the whole far edge of the grid goes unpropped.
  // So a member counts as needed if any point within a millimetre of its station is
  // over concrete. A millimetre is finer than any real setting-out tolerance and far
  // coarser than the boundary case being rescued.
  const NUDGE = 1e-3
  const nearSlab = (x: number, z: number) =>
    inSlab(x, z) ||
    inSlab(x + NUDGE, z + NUDGE) ||
    inSlab(x - NUDGE, z - NUDGE) ||
    inSlab(x + NUDGE, z - NUDGE) ||
    inSlab(x - NUDGE, z + NUDGE)

  // Decking: boards running in X, split into bays across Z, each trimmed to
  // the part of the bay that is over concrete. A slab cast on ground takes no
  // deck at all, which is why this reads the solver rather than the polygon.
  if (isFormed('soffit')) {
    // Solved once and shared with the design report: a panel printing its own chain
    // could disagree with the falsework on screen.
    const { design: falsework, soffitHeightM } = slabPourDesign(slab)

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

    // Joists run in X directly under the deck, at the centres the sheathing check
    // allowed. Stations are laid on the solved spacing from `minZ` rather than
    // divided evenly into the bounding box: the spacing is a capacity limit, and
    // rounding a bay up to make the division come out widens it past what the deck
    // can span. The last bay comes out short instead, which is how a deck is built.
    const spanZ = bounds.maxZ - bounds.minZ
    const spanX = bounds.maxX - bounds.minX
    const joistY = deckY - PANEL_THICKNESS / 2 - WALER_HEIGHT / 2
    const joistZs = stations(bounds.minZ, spanZ, falsework.joist.adoptedM)
    for (const [i, z] of joistZs.entries()) {
      const midX = (bounds.minX + bounds.maxX) / 2
      if (!nearSlab(midX, z)) continue
      const joist = new Mesh(new BoxGeometry(spanX, WALER_HEIGHT, WALER_DEPTH), walerMaterial)
      joist.name = `waler-joist-${i}`
      joist.position.set(midX, joistY, z)
      group.add(joist)
    }

    // Bearers cross under the joists in Z, carrying them to the props. This is the
    // layer the props actually stand under — a joist bears on a bearer, not on a
    // prop head — so it is what sets the prop grid's other dimension.
    const bearerY = joistY - WALER_HEIGHT / 2 - WALER_HEIGHT / 2
    const bearerXs = stations(bounds.minX, spanX, falsework.bearer.adoptedM)
    for (const [i, x] of bearerXs.entries()) {
      const midZ = (bounds.minZ + bounds.maxZ) / 2
      if (!nearSlab(x, midZ)) continue
      const bearer = new Mesh(new BoxGeometry(WALER_DEPTH, WALER_HEIGHT, spanZ), walerMaterial)
      bearer.name = `waler-bearer-${i}`
      bearer.position.set(x, bearerY, midZ)
      group.add(bearer)
    }

    // Props stand under the bearers at the solved pitch along each one, from the
    // floor the deck is erected off. The grid is bearer spacing one way and prop
    // pitch the other, which is the tributary cell the prop was checked against.
    const propTop = bearerY - WALER_HEIGHT / 2
    const propLength = Math.max(0, propTop - (slab.elevation - slab.thickness - soffitHeightM))
    const propY = propTop - propLength / 2
    const propZs = stations(bounds.minZ, spanZ, falsework.propSpacing.adoptedM)
    for (const [xi, x] of bearerXs.entries()) {
      for (const [zi, z] of propZs.entries()) {
        if (!nearSlab(x, z)) continue
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
