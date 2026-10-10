import { levelIdOf } from '../agent-operations/scene-queries'
import { getOpeningFloorDatum, wallSupportForNodes } from '../lib/opening-floor-datum'
import {
  type AnyNode,
  type AnyNodeId,
  type DoorNode,
  type DormerNode,
  getDormerWallOpeningVerticalBounds,
  type WallNode,
  type WindowNode,
} from '../schema'
import { getLevelElevations } from '../services/storey'
import { DEFAULT_WALL_THICKNESS } from '../systems/wall/wall-footprint'
import { sideOf } from './compass'
import { midpoint, wallTopOf } from './enclosure'
import { type RoofBody, resolveRoofBody, sampleRoofBody } from './roof-body'
import { COHERENCE_TOLERANCES } from './tolerances'
import type { CoherenceSeverity, CoherenceViewSide, HostingIssue } from './types'

type SceneNodes = Readonly<Record<string, AnyNode>>
type Vec2 = [number, number]
type Opening = DoorNode | WindowNode

/** Per kind: its code, severity and the principle it measures. The one place severities live. */
export const HOSTING_KINDS = {
  outsideFace: {
    slug: 'outside-face',
    code: 'hosting_outside_face',
    severity: 'error' as CoherenceSeverity,
    principle:
      'An opening is a void cut in the face of its host, and lies inside that face: a window whose head stands in the roof above its wall, or above the wall of its dormer, is cut in nothing.',
  },
  noLintel: {
    slug: 'no-lintel',
    code: 'hosting_no_lintel',
    severity: 'check' as CoherenceSeverity,
    principle:
      'An opening leaves material above its head for a lintel: the face it is cut in goes on at least 0.05 m past it.',
  },
} as const

/** One opening against the face that hosts it, measured. */
export type OpeningReading = {
  opening: Opening
  hostId: string
  hostKind: 'wall' | 'dormer'
  levelId: string
  /** Heights above the host's own base (m). */
  head: number
  sill: number
  /** The effective top of the face over the opening's span, and what sets it. */
  top: number
  clippedBy: string
  /** top − head at the tightest point. */
  margin: number
  /** How far the host wall's own top stands over the roof's underside there (wall hosts, else 0). */
  wallOver: number
  view: { from: CoherenceViewSide }
}

const eps = COHERENCE_TOLERANCES.contact
const m = (value: number) => Math.abs(value).toFixed(2)
const SAMPLE_STEP = 0.1

/**
 * Every door and window against the face that hosts it. A wall's face is clipped from above by the
 * roof over it: the roof's underside at each point of the opening's span, and a little beyond it
 * for the jambs. The opening clashes where its own span intersects the roof body's band at that
 * wall, from the underside up to the covering: under the roof passes, wholly above the covering
 * passes, straddling it is in the roof, whatever height the wall goes on to. A window in a dormer's wall is bounded by the dormer's own wall profile. Only
 * what a roof or a dormer takes from a face is measured here: an opening past a wall's own top or
 * ends is the older opening checks'.
 */
export function measureHosting(
  nodes: SceneNodes,
  options: { levelIds?: ReadonlySet<string> } = {},
): OpeningReading[] {
  const elevations = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>)
  const scope = options.levelIds
  const near = (levelId: string) => {
    if (!scope) return true
    if (scope.has(levelId)) return true
    const mine = elevations.get(levelId)
    if (!mine) return false
    return [...scope].some(
      (id) => Math.abs((elevations.get(id)?.ordinal ?? 1e6) - mine.ordinal) <= 1,
    )
  }

  const bodies: RoofBody[] = []
  const bodiesOf = () => {
    if (!bodies.length) {
      for (const node of Object.values(nodes)) {
        if (node.type !== 'roof') continue
        const levelId = levelIdOf(nodes, node.id)
        if (!levelId || nodes[levelId]?.type !== 'level') continue
        const body = resolveRoofBody(node, levelId, nodes, elevations)
        if (body.segments.length) bodies.push(body)
      }
    }
    return bodies
  }

  const readings: OpeningReading[] = []
  for (const node of Object.values(nodes)) {
    if (node.type !== 'door' && node.type !== 'window') continue
    if (node.type === 'window' && node.dormerId) {
      const reading = dormerWindow(nodes, node, near)
      if (reading) readings.push(reading)
      continue
    }
    const wall = nodes[node.wallId ?? node.parentId ?? '']
    if (wall?.type !== 'wall' || wall.curveOffset) continue
    const levelId = levelIdOf(nodes, wall.id)
    if (!levelId || !near(levelId)) continue
    const reading = wallOpening(nodes, node, wall, levelId, elevations, bodiesOf())
    if (reading) readings.push(reading)
  }
  return readings
}

function wallOpening(
  nodes: SceneNodes,
  opening: Opening,
  wall: WallNode,
  levelId: string,
  elevations: ReturnType<typeof getLevelElevations>,
  bodies: readonly RoofBody[],
): OpeningReading | null {
  const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
  if (length < eps || !bodies.length) return null
  const baseY = elevations.get(levelId)?.baseY ?? 0
  const support = wallSupportForNodes(wall, nodes as Record<string, AnyNode>)
  const datum = getOpeningFloorDatum(wall, opening, nodes as Record<string, AnyNode>, support)
  const wallBase = baseY + support.elevation
  const sill = baseY + datum + opening.position[1] - opening.height / 2
  const head = baseY + datum + opening.position[1] + opening.height / 2

  const from = opening.position[0] - opening.width / 2 - COHERENCE_TOLERANCES.lintel
  const to = opening.position[0] + opening.width / 2 + COHERENCE_TOLERANCES.lintel
  const count = Math.max(1, Math.ceil((Math.min(to, length) - Math.max(from, 0)) / SAMPLE_STEP))
  const reach = (wall.thickness ?? DEFAULT_WALL_THICKNESS) / 2

  const wallTop = wallTopOf(nodes, wall, levelId)
  let worst: { margin: number; underside: number; solid: number; roof: RoofBody } | null = null
  for (const body of bodies) {
    for (let index = 0; index <= count; index++) {
      const u = Math.max(from, 0) + ((Math.min(to, length) - Math.max(from, 0)) * index) / count
      const t = u / length
      const hit = sampleRoofBody(
        body,
        [
          wall.start[0] + (wall.end[0] - wall.start[0]) * t,
          wall.start[1] + (wall.end[1] - wall.start[1]) * t,
        ],
        reach,
      )
      if (!hit) continue
      // Wholly above the roof's covering, on a wall that goes on past it: clear of the roof.
      if (sill >= hit.covering - eps) continue
      // The roof body begins on the seat, its own knee wall included: an opening reaching into that
      // wall is hidden behind it, which is how a transom disappears under a roof.
      const margin = hit.underside - head
      if (!worst || margin < worst.margin)
        worst = { margin, underside: hit.underside, solid: hit.solid, roof: body }
    }
  }
  if (!worst) return null

  return {
    opening,
    hostId: wall.id,
    hostKind: 'wall',
    levelId,
    head: head - wallBase,
    sill: sill - wallBase,
    top: worst.underside - wallBase,
    clippedBy: worst.roof.roof.id,
    margin: worst.margin,
    // How far the wall itself reaches into the deck here: what the roof–wall item reports.
    wallOver: wallTop - worst.solid,
    view: { from: sideOf(worst.roof.center, midpoint(wall) as Vec2) },
  }
}

function dormerWindow(
  nodes: SceneNodes,
  window: WindowNode,
  near: (levelId: string) => boolean,
): OpeningReading | null {
  const dormer = nodes[window.dormerId ?? ''] as DormerNode | undefined
  if (dormer?.type !== 'dormer') return null
  const levelId = levelIdOf(nodes, dormer.id)
  if (!levelId || !near(levelId)) return null
  const face = window.dormerFace ?? 'front'
  const bounds = getDormerWallOpeningVerticalBounds(dormer, face, window.position[0], window.width)
  const head = window.position[1] + window.height / 2
  const sill = window.position[1] - window.height / 2
  // Below the skirt is as outside as above the eave: report whichever is tighter.
  const margin = Math.min(bounds.max - head, sill - bounds.min)
  return {
    opening: window,
    hostId: dormer.id,
    hostKind: 'dormer',
    levelId,
    head,
    sill,
    top: bounds.max,
    clippedBy: dormer.id,
    margin,
    wallOver: 0,
    view: { from: 'south-west' },
  }
}

const issueId = (slug: string, ...ids: string[]) => `hosting/${slug}/${[...ids].sort().join('+')}`

/** The issues of openings against their hosts' faces. */
export function hostingIssues(readings: readonly OpeningReading[]): HostingIssue[] {
  const issues: HostingIssue[] = []
  for (const reading of readings) {
    const outside = reading.margin < -COHERENCE_TOLERANCES.rounding
    // A dormer's own window is cut up to its eave line by default (3.5 cm of wall above it), so only
    // an opening past the face is reported there; a lintel is asked of openings in a wall under a roof.
    const tight =
      reading.hostKind === 'dormer'
        ? outside
        : reading.margin < COHERENCE_TOLERANCES.lintel - COHERENCE_TOLERANCES.rounding
    if (!tight) continue
    const kind = outside ? HOSTING_KINDS.outsideFace : HOSTING_KINDS.noLintel
    const { opening } = reading
    const where =
      reading.hostKind === 'dormer'
        ? `the top of the wall of ${reading.hostId}, ${m(reading.top)} m from its eave line`
        : `the underside of ${reading.clippedBy} over it, ${m(reading.top)} m from the wall base`
    issues.push({
      id: issueId(kind.slug, opening.id),
      group: `hosting/${kind.slug}/${reading.hostId}`,
      family: 'hosting',
      code: kind.code,
      severity: kind.severity,
      principle: kind.principle,
      measured: {
        quantity: `room between the head of a ${opening.type} and the face it is cut in`,
        expected: `at least ${COHERENCE_TOLERANCES.lintel} m of face above the head (a lintel)`,
        actual: outside
          ? `the head, ${m(reading.head)} m from the base, is ${m(reading.margin)} m past ${where}`
          : `the head, ${m(reading.head)} m from the base, leaves ${m(reading.margin)} m under ${where}`,
      },
      nodeIds: [opening.id, reading.hostId],
      levelIds: [reading.levelId],
      carrierId: opening.id,
      figures: { margin: reading.margin, top: reading.top, head: reading.head, sill: reading.sill },
    })
  }
  return issues
}
