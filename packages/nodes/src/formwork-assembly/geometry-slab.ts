import type { FalseworkDesign, FormworkPartSpec } from '@pascal-app/core/formwork'
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
import { type BuiltFormwork, collectParts } from './parts'
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

/**
 * A joist or a bearer off the falsework chain.
 *
 * Both are the same catalog beam at different centres carrying different loads, so
 * the member that governs is the one whose `MemberDesign` this reads — a bearer
 * reported at the joist's utilisation would look comfortable while carrying four
 * times the line load. The length is the run drawn rather than a stock length: a
 * deck is laid out to the slab and the beams are cut or lapped to suit, and rounding
 * up to the next stock length here would put a beam through the rim.
 */
function beamSpec(
  falsework: FalseworkDesign,
  member: 'joist' | 'bearer',
  lengthM: number,
  locus: Extract<FormworkPartSpec['locus'], { on: 'grid' }>,
): FormworkPartSpec {
  const beam = falsework.beam
  const design = member === 'joist' ? falsework.joist : falsework.bearer
  const label = member === 'joist' ? 'Joist' : 'Bearer'
  return {
    kind: 'joist',
    member,
    locus,
    ...(beam ? { catalogId: beam.id, verification: beam.verification } : {}),
    description: beam
      ? `${beam.label}, ${Math.round(lengthM * 1000)} mm`
      : `${label} ${Math.round(lengthM * 1000)} mm`,
    provenance: beam ? 'standard' : 'bespoke',
    ...(beam ? { weightKg: beam.kgPerM * lengthM } : {}),
    lengthMm: lengthM * 1000,
    structure: { utilisation: design.utilisation, governingCheck: design.governedBy },
  }
}

export function buildSlabFormwork(
  slab: SlabNode,
  node: FormworkAssemblyNode,
  scope: FormworkScope,
  material: MeshStandardMaterial,
): BuiltFormwork {
  const group = new Group()
  const parts = collectParts(group, node)
  const { isFormed, settings } = scope

  const outline = polygonOf(slab)
  if (outline.length < 3 || slab.thickness <= 0) return parts.finish()
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
    const { design: falsework, soffitHeightM } = slabPourDesign(settings, slab)

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
        // Set out from the sheet's own near corner, so a sheet keeps its mark when
        // the deck is re-bayed around it. The soffit is the big number in a slab's
        // bill and it is an area rather than a count of identical boards, so the
        // stated size is the trimmed bay rather than a nominal sheet.
        parts.emit(
          {
            kind: 'ply-piece',
            use: 'deck-sheet',
            locus: { on: 'grid', xMm: (x - xStep / 2) * 1000, zMm: (z - zStep / 2) * 1000 },
            widthMm: xStep * 1000,
            heightMm: zStep * 1000,
            ...(falsework.sheathing
              ? {
                  catalogId: falsework.sheathing.id,
                  verification: falsework.sheathing.verification,
                }
              : {}),
            description: falsework.sheathing
              ? `${falsework.sheathing.label}, ${Math.round(xStep * 1000)} × ${Math.round(zStep * 1000)} mm`
              : `Deck sheet ${Math.round(xStep * 1000)} × ${Math.round(zStep * 1000)} mm`,
            // Cut to the bay, so it is carpentry whatever sheet it came off.
            provenance: 'bespoke',
            structure: {
              utilisation: falsework.joist.utilisation,
              governingCheck: falsework.joist.governedBy,
            },
          },
          board,
        )
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
      parts.emit(
        beamSpec(falsework, 'joist', spanX, {
          on: 'grid',
          xMm: bounds.minX * 1000,
          zMm: z * 1000,
        }),
        joist,
      )
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
      parts.emit(
        beamSpec(falsework, 'bearer', spanZ, {
          on: 'grid',
          xMm: x * 1000,
          zMm: bounds.minZ * 1000,
        }),
        bearer,
      )
    }

    // Props stand under the bearers at the solved pitch along each one, from the
    // floor the deck is erected off. The grid is bearer spacing one way and prop
    // pitch the other, which is the tributary cell the prop was checked against.
    const propTop = bearerY - WALER_HEIGHT / 2
    const propLength = Math.max(0, propTop - (slab.elevation - slab.thickness - soffitHeightM))
    const propY = propTop - propLength / 2
    const propZs = stations(bounds.minZ, spanZ, falsework.propSpacing.adoptedM)
    const propPositions: Array<{ x: number; z: number }> = []
    for (const [xi, x] of bearerXs.entries()) {
      for (const [zi, z] of propZs.entries()) {
        if (!nearSlab(x, z)) continue
        // Recorded for the validator, which finds what each prop stands on and
        // checks the slab below can take it — see `propsOntoSlabBelow`. Collected
        // here because the falsework grid is this design pass and nobody should
        // re-derive it.
        propPositions.push({ x, z })
        const prop = new Mesh(
          new BoxGeometry(SCAFFOLD_POST_SIZE, propLength, SCAFFOLD_POST_SIZE),
          scaffoldMaterial,
        )
        prop.name = `prop-${xi}-${zi}`
        prop.position.set(x, propY, z)
        // The extended length is what a prop is ordered and set at, and the capacity
        // is the one read off the table at that extension — a prop is weakest long, so
        // a nominal capacity would be the wrong figure to divide by.
        parts.emit(
          {
            kind: 'prop',
            locus: { on: 'grid', xMm: x * 1000, zMm: z * 1000 },
            ...(falsework.props
              ? { catalogId: falsework.props.id, verification: falsework.props.verification }
              : {}),
            description: falsework.props
              ? `${falsework.props.label}, extended ${Math.round(propLength * 1000)} mm`
              : `Prop ${Math.round(propLength * 1000)} mm`,
            provenance: falsework.props ? 'standard' : 'bespoke',
            ...(falsework.props && falsework.props.weightKg > 0
              ? { weightKg: falsework.props.weightKg }
              : {}),
            extendedLengthMm: propLength * 1000,
            loadKn: falsework.propLoadKn,
            capacityKn: falsework.propCapacityKn ?? 0,
            ...(falsework.propCapacityKn
              ? {
                  structure: {
                    utilisation: falsework.propLoadKn / falsework.propCapacityKn,
                    governingCheck: falsework.propSpacing.governedBy,
                  },
                }
              : {}),
          },
          prop,
        )
      }
    }
    if (propPositions.length > 0) {
      parts.evidence({
        falsework: {
          props: propPositions,
          loadKn: falsework.propLoadKn,
          // The tributary cell the prop was checked against — the check compares
          // the reaction over this cell against the slab below's capacity.
          cellM2: falsework.bearer.adoptedM * falsework.propSpacing.adoptedM,
        },
      })
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
          // Marked from the edge's own start corner, which is a plan position — two
          // layers of a doubled edge beam are at the same one, so the outer board is
          // offset by its own thickness to keep them apart in the mark as they are on
          // site. A hole's edge form is the same part as the rim's; only the outline
          // it follows differs, and the position says which.
          parts.emit(
            {
              kind: 'ply-piece',
              use: 'cut-board',
              locus: { on: 'grid', xMm: (a.x + nx) * 1000, zMm: (a.z + nz) * 1000 },
              widthMm: length * 1000,
              heightMm: slab.thickness * 1000,
              description: `Edge form ${Math.round(length * 1000)} × ${Math.round(slab.thickness * 1000)} mm`,
              provenance: 'bespoke',
            },
            board,
          )
        }
      }
    }
  }

  return parts.finish()
}
