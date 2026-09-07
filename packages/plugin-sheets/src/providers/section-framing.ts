/**
 * THE FRAMING IN THE BUILDING SECTION.
 *
 * The Sections plugin cuts the ARCHITECTURE — wall assemblies, slabs, the
 * roof deck, openings, the grade. What a permit section also shows is the
 * STRUCTURE: the joists the floor is built of, the rafters or truss chords
 * over the ceiling, the plates the studs land on, the stemwall and its
 * footing under the mudsill. Bones already frames all of it for the
 * structural sheets, so this module cuts those same members with the same
 * plane the section drawing used and draws what the plane passes through.
 *
 * Nothing here is invented: every rectangle is a member Bones generated,
 * cut where the plane crosses it, and every callout names that member's own
 * size and the spec's spacing (Steve, 2026-09-07: "building sections missing
 * colors and framing and notes, and framing call outs … ensure all the
 * Pascal systems come in clearly on these vector sections and are what's
 * actually there").
 *
 * FRAME. The section's drawing space (plugin-sections `types.ts`): x is the
 * distance along the cut line from its start, measured along the view's
 * right axis; y is NEGATED elevation. Bones members are level-local metres
 * with y up, so a member at elevation e draws at −(e + the level's base).
 */
import type { FloorplanGeometry } from '@pascal-app/core'
import type { Member } from '../../../plugin-bones/src/core/types'
import type { AnyNodeLike, NodeMap } from '../model'
import { prescriptiveRequirements } from '../notes/prescriptive'
import { resolveJurisdiction } from '../notes/jurisdiction'
import { formatInchFraction, structuralModel } from './structural/model'

type Vec2 = [number, number]
type Vec3 = [number, number, number]

/** The cut line and the way the section looks, as the marker records it. */
export type CutPlane = {
  start: Vec2
  end: Vec2
  lookDirection: 'left' | 'right'
  depth: number
}

/* --------------------------------------------------------------- palette */

/**
 * The S5 details' palette (plugin-bones `plans/details.ts`), so a member cut
 * in the section reads the same colour as the same member in a detail.
 */
const WOOD = '#d8b98a'
const WOOD_PT = '#c9a36b'
const ENGINEERED = '#c9c3b8'
const CONCRETE = '#8a8f96'
const STEEL = '#1f2a36'
const BATT = '#f4e3c1'
const INK = '#111111'

/** Members whose cut is drawn, and how they are drawn. */
const STRUCTURAL_SYSTEMS = new Set(['wall-framing', 'floor-framing', 'roof-framing', 'foundation'])

/**
 * The wall's own skin — the Sections plugin already draws these as the
 * assembly's poché bands, straight off the wall node, so drawing Bones'
 * copies over them would double every line.
 */
const SKIN_ROLES = new Set(['drywall', 'wrb', 'cladding'])

/** Hardware too small to read at a section's scale — its own detail shows it. */
const HARDWARE_ROLES = new Set([
  'uplift-connector',
  'uplift-strap',
  'foundation-strap',
  'plate-washer',
  'post-base',
  'post-cap',
  'hanger',
  'drip-edge',
  'rebar',
  'vapor-retarder',
])

function fillFor(member: Member): string {
  switch (member.material) {
    case 'concrete':
      return CONCRETE
    case 'steel':
      return STEEL
    case 'pt-lumber':
      return WOOD_PT
    case 'engineered':
      return ENGINEERED
    default:
      return member.role === 'insulation' ? BATT : WOOD
  }
}

/* -------------------------------------------------------------- geometry */

/** Rotate a member-local point by the member's XYZ euler (three.js order: Z, then Y, then X). */
function rotate(p: Vec3, r: readonly [number, number, number]): Vec3 {
  const [rx, ry, rz] = r
  // Rz
  let x = p[0] * Math.cos(rz) - p[1] * Math.sin(rz)
  let y = p[0] * Math.sin(rz) + p[1] * Math.cos(rz)
  let z = p[2]
  // Ry
  const x1 = x * Math.cos(ry) + z * Math.sin(ry)
  const z1 = -x * Math.sin(ry) + z * Math.cos(ry)
  x = x1
  z = z1
  // Rx
  const y1 = y * Math.cos(rx) - z * Math.sin(rx)
  const z2 = y * Math.sin(rx) + z * Math.cos(rx)
  y = y1
  z = z2
  return [x, y, z]
}

/** The member's eight corners in level-local metres. */
function corners(member: Member, levelBase: number): Vec3[] {
  const [dx, dy, dz] = member.dims
  const [px, py, pz] = member.position
  const out: Vec3[] = []
  for (const sx of [-0.5, 0.5]) {
    for (const sy of [-0.5, 0.5]) {
      for (const sz of [-0.5, 0.5]) {
        const local: Vec3 = [dx * sx, dy * sy, dz * sz]
        const r = rotate(local, member.rotation)
        out.push([px + r[0], py + r[1] + levelBase, pz + r[2]])
      }
    }
  }
  return out
}

/** The twelve edges of the corner array `corners` builds (bit order sx, sy, sz). */
const BOX_EDGES: readonly [number, number][] = [
  [0, 1],
  [0, 2],
  [0, 4],
  [1, 3],
  [1, 5],
  [2, 3],
  [2, 6],
  [3, 7],
  [4, 5],
  [4, 6],
  [5, 7],
  [6, 7],
]

export type Projector = {
  /** Signed distance from the cut plane, in plan metres. */
  side: (x: number, z: number) => number
  /** Drawing x — distance along the view's right axis from the cut's start. */
  u: (x: number, z: number) => number
}

/** The section's own projector: the same axes `buildSectionDrawing` derives from the marker. */
export function projectorFor(plane: CutPlane): Projector | null {
  const dx = plane.end[0] - plane.start[0]
  const dz = plane.end[1] - plane.start[1]
  const length = Math.hypot(dx, dz)
  if (length < 1e-6) return null
  const unit: Vec2 = [dx / length, dz / length]
  // plugin-sections: forward is the left normal of travel for a left-looking
  // cut, its negation for a right-looking one; right = (−f.z, f.x).
  const forward: Vec2 =
    plane.lookDirection === 'left' ? [unit[1], -unit[0]] : [-unit[1], unit[0]]
  const right: Vec2 = [-forward[1], forward[0]]
  return {
    side: (x, z) => (x - plane.start[0]) * forward[0] + (z - plane.start[1]) * forward[1],
    u: (x, z) => (x - plane.start[0]) * right[0] + (z - plane.start[1]) * right[1],
  }
}

/**
 * The member's cross-section where the plane passes through it, in drawing
 * coordinates — or null when the plane misses it. A box is convex, so the
 * cut is the convex polygon through the points where the plane crosses its
 * edges; the points are ordered around their centroid.
 */
export function cutMember(member: Member, view: Projector, levelBase: number): Vec2[] | null {
  const pts = corners(member, levelBase)
  const d = pts.map((p) => view.side(p[0], p[2]))
  const hits: Vec2[] = []
  for (const [a, b] of BOX_EDGES) {
    const da = d[a] as number
    const db = d[b] as number
    if ((da > 0 && db > 0) || (da < 0 && db < 0)) continue
    if (Math.abs(da - db) < 1e-12) continue
    const t = da / (da - db)
    if (t < -1e-9 || t > 1 + 1e-9) continue
    const pa = pts[a] as Vec3
    const pb = pts[b] as Vec3
    const x = pa[0] + (pb[0] - pa[0]) * t
    const y = pa[1] + (pb[1] - pa[1]) * t
    const z = pa[2] + (pb[2] - pa[2]) * t
    hits.push([view.u(x, z), -y])
  }
  if (hits.length < 3) return null
  const cx = hits.reduce((s, p) => s + p[0], 0) / hits.length
  const cy = hits.reduce((s, p) => s + p[1], 0) / hits.length
  const ordered = hits
    .map((p) => ({ p, a: Math.atan2(p[1] - cy, p[0] - cx) }))
    .sort((m, n) => m.a - n.a)
    .map((m) => m.p)
  // drop the duplicates a corner-crossing produces
  const unique: Vec2[] = []
  for (const p of ordered) {
    const last = unique[unique.length - 1]
    if (last && Math.abs(last[0] - p[0]) < 1e-9 && Math.abs(last[1] - p[1]) < 1e-9) continue
    unique.push(p)
  }
  return unique.length >= 3 ? unique : null
}

/* -------------------------------------------------------------- callouts */

const IN = 0.0254

function spacingLabel(metres: number): string {
  return `${Math.round(metres / IN)}" O.C.`
}

/**
 * One callout per structural family the cut actually passes through, keyed
 * to the member it points at. Every value is the member's own (its size, the
 * spec's spacing) or the energy code's (the insulation R) — never invented.
 */
type Callout = { at: Vec2; text: string; order: number }

const NOTE_SIZE = 0.12
const NOTE_LEAD = 0.16
/** Characters that fit the right-hand note column at NOTE_SIZE. */
const NOTE_CHARS = 30

/** Break a callout onto lines that fit the note column, on word breaks. */
function wrapNote(text: string, max: number): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > max) {
      out.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line) out.push(line)
  return out
}

function calloutsFor(
  cuts: { member: Member; poly: Vec2[] }[],
  spec: { studSpacing: number; joistSpacing: number; rafterSpacing: number; ceilingJoistSpacing: number },
  insulation: { ceiling: string; wall: string; floor: string },
  roofSystem: 'stick' | 'truss',
): Callout[] {
  const out: Callout[] = []
  const seen = new Set<string>()
  /** The widest cut of a role — the one a leader can point at without landing on a sliver. */
  const pick = (test: (m: Member) => boolean) => {
    let best: { member: Member; poly: Vec2[]; area: number } | null = null
    for (const cut of cuts) {
      if (!test(cut.member)) continue
      const xs = cut.poly.map((p) => p[0])
      const ys = cut.poly.map((p) => p[1])
      const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))
      if (!best || area > best.area) best = { ...cut, area }
    }
    return best
  }
  const add = (key: string, test: (m: Member) => boolean, text: (m: Member) => string, order: number) => {
    if (seen.has(key)) return
    const hit = pick(test)
    if (!hit) return
    seen.add(key)
    const xs = hit.poly.map((p) => p[0])
    const ys = hit.poly.map((p) => p[1])
    out.push({
      at: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2],
      text: text(hit.member),
      order,
    })
  }

  add(
    'roof',
    (m) => m.role === 'truss-chord' || m.role === 'rafter',
    (m) =>
      roofSystem === 'truss'
        ? `${m.size ?? '2x4'} PRE-ENGINEERED TRUSSES @ ${spacingLabel(spec.rafterSpacing)} — DEFERRED SUBMITTAL (R802.10.1)`
        : `${m.size ?? '2x6'} RAFTERS @ ${spacingLabel(spec.rafterSpacing)} (R802.4)`,
    1,
  )
  add(
    'roof-sheathing',
    (m) => m.system === 'roof-framing' && m.role === 'sheathing',
    (m) => `${formatInchFraction(Math.min(...m.dims))} WSP ROOF SHEATHING — 8d @ 6"/12" (R803.2)`,
    2,
  )
  add(
    'ceiling',
    (m) => m.role === 'ceiling-joist' || m.role === 'truss-web',
    () => `${insulation.ceiling} CEILING INSULATION, VENTED ATTIC (R806)`,
    3,
  )
  add(
    'plate',
    (m) => m.role === 'cap-plate' || m.role === 'top-plate',
    (m) => `DOUBLE ${m.size ?? '2x6'} TOP PLATE (R602.3.2)`,
    4,
  )
  add(
    'stud',
    (m) => m.role === 'stud' && m.system === 'wall-framing',
    (m) => `${m.size ?? '2x6'} STUDS @ ${spacingLabel(spec.studSpacing)} + ${insulation.wall} CAVITY (R602.3, N1102.1.3)`,
    5,
  )
  add(
    'joist',
    (m) => m.role === 'joist' && m.system === 'floor-framing',
    (m) => `${m.size ?? '2x10'} FLOOR JOISTS @ ${spacingLabel(spec.joistSpacing)} (R502.3)`,
    6,
  )
  add(
    'girder',
    (m) => m.role === 'girder' && m.system === 'floor-framing',
    (m) => `${m.size ?? '4x8'} GIRDER ON POSTS & PADS (R502.5, R403.1)`,
    7,
  )
  add(
    'mudsill',
    (m) => m.role === 'mudsill',
    (m) => `${m.size ?? '2x6'} PT MUDSILL — 5/8" A.B. @ 6'-0" O.C. (R403.1.6, R317.1)`,
    8,
  )
  add(
    'stemwall',
    (m) => m.role === 'stemwall',
    (m) => `${formatInchFraction(Math.min(m.dims[0], m.dims[2]))} CONCRETE STEMWALL (R404)`,
    9,
  )
  add(
    'footing',
    (m) => m.role === 'footing',
    (m) =>
      `${formatInchFraction(Math.min(m.dims[0], m.dims[2]))} × ${formatInchFraction(m.dims[1])} CONT. FOOTING, (2) #4 (R403.1)`,
    10,
  )
  add('slab', (m) => m.role === 'slab', () => `CONC. SLAB ON GRADE O/ VAPOR RETARDER (R506)`, 11)
  return out.sort((a, b) => a.order - b.order)
}

/* -------------------------------------------------------------- the pass */

export type SectionFraming = {
  primitives: FloorplanGeometry[]
  warnings: string[]
}

/** The section-marker node's cut line, level-local. */
export function planeFromMarker(nodes: NodeMap, markerId: string | undefined): CutPlane | null {
  const marker = markerId ? nodes[markerId] : undefined
  if (!marker || marker.type !== 'section-marker') return null
  const start = marker.start
  const end = marker.end
  if (!Array.isArray(start) || !Array.isArray(end)) return null
  return {
    start: [Number(start[0]) || 0, Number(start[1]) || 0],
    end: [Number(end[0]) || 0, Number(end[1]) || 0],
    lookDirection: marker.lookDirection === 'right' ? 'right' : 'left',
    depth: typeof marker.depth === 'number' ? marker.depth : 12,
  }
}

/**
 * Everything Bones framed, cut by this section's plane and drawn in the
 * section's own coordinates: the members as filled cross-sections, a leader
 * and a note on each structural family the cut passes through, and a key
 * naming the colours.
 */
export function sectionFraming(
  nodes: NodeMap,
  markerId: string | undefined,
  levelId: string | undefined,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
): SectionFraming {
  const plane = planeFromMarker(nodes, markerId)
  if (!plane) return { primitives: [], warnings: [] }
  const view = projectorFor(plane)
  if (!view) return { primitives: [], warnings: [] }
  const model = structuralModel(nodes, levelId)
  if (!model) {
    return {
      primitives: [],
      warnings: ['No level to frame — the section shows the architecture only.'],
    }
  }
  const level = nodes[model.levelId] as AnyNodeLike | undefined
  const levelBase = typeof level?.baseElevation === 'number' ? level.baseElevation : 0

  const cuts: { member: Member; poly: Vec2[] }[] = []
  for (const member of model.members) {
    if (!STRUCTURAL_SYSTEMS.has(member.system)) continue
    if (SKIN_ROLES.has(member.role) || HARDWARE_ROLES.has(member.role)) continue
    const poly = cutMember(member, view, levelBase)
    if (poly) cuts.push({ member, poly })
  }
  if (cuts.length === 0) {
    return {
      primitives: [],
      warnings: ['The cut line passes through no framing — check the section marker.'],
    }
  }

  const primitives: FloorplanGeometry[] = []
  // the members themselves, sheet-goods first so the sticks read over them
  const order = (m: Member) => (m.role === 'sheathing' || m.role === 'insulation' ? 0 : 1)
  for (const cut of [...cuts].sort((a, b) => order(a.member) - order(b.member))) {
    primitives.push({
      kind: 'polygon',
      points: cut.poly.map(([x, y]) => [x, y] as const),
      fill: fillFor(cut.member),
      stroke: INK,
      strokeWidth: 0.01,
      strokeLinejoin: 'miter',
      metadata: { sheets: 'section-framing', role: cut.member.role, sourceId: cut.member.sourceId },
    } as FloorplanGeometry)
  }

  // the callouts, stacked down the right margin the section already reserves
  const j = resolveJurisdiction(nodes)
  const requirements = prescriptiveRequirements(j)
  const req = (component: string): string =>
    requirements.rows.find((r) => r.component === component)?.value ?? '(verify)'
  const callouts = calloutsFor(
    cuts,
    model.spec,
    {
      ceiling: req('Ceiling / attic'),
      wall: j.wallInsulation ? j.wallInsulation.value.replace(/^R(\d)/, 'R-$1') : '(verify)',
      floor: req('Floor'),
    },
    model.roofSystem,
  )
  // The notes stack down the right margin the section already reserves for
  // its datum labels, wrapped to that column's width so nothing runs off the
  // paper; each carries a leader back to the member it describes.
  const textX = bounds.maxX - 2.5
  let textY = bounds.minY + 0.6
  for (const callout of callouts) {
    const lines = wrapNote(callout.text, NOTE_CHARS)
    primitives.push(
      {
        kind: 'polyline',
        points: [
          [callout.at[0], callout.at[1]],
          [textX - 0.35, textY + 0.05],
          [textX - 0.06, textY + 0.05],
        ],
        fill: 'none',
        stroke: INK,
        strokeWidth: 0.006,
      } as FloorplanGeometry,
      {
        kind: 'circle',
        cx: callout.at[0],
        cy: callout.at[1],
        r: 0.035,
        fill: INK,
        stroke: 'none',
      } as FloorplanGeometry,
    )
    lines.forEach((line, i) => {
      primitives.push({
        kind: 'text',
        x: textX,
        y: textY + 0.09 + i * NOTE_LEAD,
        text: line,
        fontSize: NOTE_SIZE,
        fill: INK,
        fontFamily: 'Helvetica, Arial, sans-serif',
        textAnchor: 'start',
      } as FloorplanGeometry)
    })
    textY += lines.length * NOTE_LEAD + 0.14
  }

  return {
    primitives,
    warnings: [
      `Framing shown is the Bones model cut by this section — ${cuts.length} members. Sizes and spacings are the framing plan's; the engineer of record verifies them.`,
    ],
  }
}
