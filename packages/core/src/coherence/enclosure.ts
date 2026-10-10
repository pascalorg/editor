import { levelIdOf, nodesOnLevel } from '../agent-operations/scene-queries'
import type { AnyNode, AnyNodeId, SlabNode, WallNode } from '../schema'
import { findLevelBelowId, getLevelElevations, getWallPlaneTop } from '../services/storey'
import { computeWallSlabSupport } from '../systems/slab/slab-support'
import { DEFAULT_WALL_THICKNESS } from '../systems/wall/wall-footprint'
import { resolveWallTop } from '../systems/wall/wall-top'
import { type RoofBody, resolveRoofBody, sampleRoofBody } from './roof-body'
import { COHERENCE_TOLERANCES } from './tolerances'
import type { CoherenceIssue, CoherenceSeverity, RoofWallFigures } from './types'

type SceneNodes = Readonly<Record<string, AnyNode>>
type Vec2 = [number, number]

/** Per kind: its code, severity and the principle it measures. The one place severities live. */
export const ENCLOSURE_KINDS = {
  pierce: {
    slug: 'pierce',
    code: 'roof_wall_pierce',
    severity: 'error' as CoherenceSeverity,
    principle:
      'A wall meets a roof in one of two ways: it stops under the roof and carries it, or it rises past the roof as a parapet. A wall that ends inside the roof does neither.',
  },
  gap: {
    slug: 'gap',
    code: 'roof_wall_gap',
    severity: 'check' as CoherenceSeverity,
    principle:
      "An exterior wall reaches the roof above it, so the building's rain and air barrier stays continuous where roof and wall meet.",
  },
  parapetShort: {
    slug: 'parapet-short',
    code: 'roof_wall_parapet_short',
    severity: 'check' as CoherenceSeverity,
    principle:
      'A wall declared a parapet rises past the roof: its top stands clear of the roof covering along its whole length, so the roof can turn up against it.',
  },
  parapetUncapped: {
    slug: 'parapet-uncapped',
    code: 'roof_wall_parapet_uncapped',
    severity: 'check' as CoherenceSeverity,
    principle:
      'A parapet is capped: a coping with a membrane under it keeps rain out of the top of the wall.',
  },
} as const

export type WallRoofSample = {
  /** Distance along the wall (m). */
  at: number
  /** Wall top − roof underside (m). */
  over: number
  /** Wall top − roof covering (m). */
  aboveCovering: number
  underside: number
  /** Wall top − where the roof's own wall ends there (m): positive means into the deck. */
  pastSolid: number
  covering: number
  insetFromEdge: number
}

/** One wall under one roof, measured; the issues, if any, come from it. */
export type WallRoofContact = {
  wall: WallNode
  body: RoofBody
  levelId: string
  /** The wall's top and its base under it, in world metres. */
  top: number
  base: number
  samples: WallRoofSample[]
  step: number
  wallLength: number
  coveredLength: number
  exterior: boolean
  /** The maker declared the wall a parapet: it is tested as one. */
  declaredParapet: boolean
  capped: boolean
  figures: RoofWallFigures
}

type LevelFacts = { slabs: SlabNode[]; walls: WallNode[]; baseY: number }

const eps = COHERENCE_TOLERANCES.contact
const m = (value: number) => Math.abs(value).toFixed(2)
const signed = (value: number) => `${value < 0 ? '−' : '+'}${m(value)}`

export const midpoint = (wall: WallNode): Vec2 => [
  (wall.start[0] + wall.end[0]) / 2,
  (wall.start[1] + wall.end[1]) / 2,
]

/**
 * Every wall under a roof, measured along its length. The walls a roof can meet are those of its
 * own level and the level below, as the roof's own seat election reads them. `levelIds` limits the
 * check to roofs on, or over, those levels.
 */
export function measureEnclosure(
  nodes: SceneNodes,
  options: { levelIds?: ReadonlySet<string> } = {},
): WallRoofContact[] {
  const elevations = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>)
  const facts = new Map<string, LevelFacts>()
  const levelFacts = (levelId: string): LevelFacts => {
    let known = facts.get(levelId)
    if (!known) {
      const content = nodesOnLevel(nodes, levelId)
      known = {
        slabs: content.filter((node): node is SlabNode => node.type === 'slab'),
        walls: content.filter((node): node is WallNode => node.type === 'wall'),
        baseY: elevations.get(levelId)?.baseY ?? 0,
      }
      facts.set(levelId, known)
    }
    return known
  }

  const contacts: WallRoofContact[] = []
  for (const node of Object.values(nodes)) {
    if (node.type !== 'roof' || node.support?.kind === 'roof') continue
    const roofLevelId = levelIdOf(nodes, node.id)
    if (!roofLevelId || nodes[roofLevelId]?.type !== 'level') continue
    const belowId = findLevelBelowId(roofLevelId, elevations)
    const scope = options.levelIds
    if (scope && !(scope.has(roofLevelId) || (belowId && scope.has(belowId)))) continue
    const body = resolveRoofBody(node, roofLevelId, nodes, elevations)
    if (!body.segments.length) continue

    for (const levelId of [roofLevelId, belowId]) {
      if (!levelId) continue
      const level = levelFacts(levelId)
      for (const wall of level.walls) {
        if (wall.curveOffset) continue
        const contact = measureWall(nodes, body, wall, levelId, level)
        if (contact) contacts.push(contact)
      }
    }
  }
  return contacts
}

/** Where a wall ends, in world metres, as the viewer stands it on the level it belongs to. */
export function wallTopOf(nodes: SceneNodes, wall: WallNode, levelId: string): number {
  const content = nodesOnLevel(nodes, levelId)
  const slabs = content.filter((node): node is SlabNode => node.type === 'slab')
  const walls = content.filter((node): node is WallNode => node.type === 'wall')
  const support = computeWallSlabSupport(
    wall,
    slabs,
    walls,
    wall.supportSlabId,
    undefined,
    0,
    nodes,
  )
  const baseY = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>).get(levelId)?.baseY ?? 0
  const planeTop = getWallPlaneTop(wall, levelId, nodes as Record<AnyNodeId, AnyNode>)
  return baseY + resolveWallTop(wall, planeTop, support.elevation)
}

function measureWall(
  nodes: SceneNodes,
  body: RoofBody,
  wall: WallNode,
  levelId: string,
  level: LevelFacts,
): WallRoofContact | null {
  const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
  if (length < eps) return null
  const count = Math.min(
    COHERENCE_TOLERANCES.maxSamplesPerWall,
    Math.max(1, Math.ceil(length / COHERENCE_TOLERANCES.sampleSpacing)),
  )
  const step = length / count

  const support = computeWallSlabSupport(
    wall,
    level.slabs,
    level.walls,
    wall.supportSlabId,
    undefined,
    0,
    nodes,
  )
  const planeTop = getWallPlaneTop(wall, levelId, nodes as Record<AnyNodeId, AnyNode>)
  const top = level.baseY + resolveWallTop(wall, planeTop, support.elevation)

  const samples: WallRoofSample[] = []
  for (let index = 0; index < count; index++) {
    const along = (index + 0.5) / count
    const hit = sampleRoofBody(
      body,
      [
        wall.start[0] + (wall.end[0] - wall.start[0]) * along,
        wall.start[1] + (wall.end[1] - wall.start[1]) * along,
      ],
      (wall.thickness ?? DEFAULT_WALL_THICKNESS) / 2,
    )
    if (!hit) continue
    samples.push({
      at: along * length,
      over: top - hit.underside,
      aboveCovering: top - hit.covering,
      pastSolid: top - hit.solid,
      underside: hit.underside,
      covering: hit.covering,
      insetFromEdge: hit.insetFromEdge,
    })
  }
  const coveredLength = samples.length * step
  if (coveredLength < Math.min(COHERENCE_TOLERANCES.minCoveredLength, length / 2)) return null

  const over = samples.map((sample) => sample.over)
  const standing = samples.filter((sample) => isInside(sample))
  const short = samples.filter((sample) => sample.over < -eps)
  const coverings = samples.map((sample) => sample.covering)
  return {
    wall,
    body,
    levelId,
    top,
    base: level.baseY + support.elevation,
    samples,
    step,
    wallLength: length,
    coveredLength,
    exterior: wall.frontSide === 'exterior' || wall.backSide === 'exterior',
    declaredParapet: wall.roofJunction === 'parapet',
    capped: wall.cap === true,
    figures: {
      wallTop: top,
      seat: body.seat,
      overUnderside: standing.length
        ? Math.max(...standing.map((sample) => sample.over))
        : Math.max(...over),
      shortOfUnderside: short.length ? Math.max(...short.map((sample) => -sample.over)) : 0,
      aboveCovering: Math.min(...samples.map((sample) => sample.aboveCovering)),
      coveringRange: Math.max(...coverings) - Math.min(...coverings),
      undersideLow: Math.min(...samples.map((sample) => sample.underside)),
      coveringHigh: Math.max(...coverings),
      insetFromEdge: Math.min(...samples.map((sample) => sample.insetFromEdge)),
      coveredLength,
      wallLength: length,
    },
  }
}

/** A wall stands clear of the covering by the upstand, to the millimetre: a parapet. */
const clearsCovering = (sample: WallRoofSample) =>
  sample.aboveCovering + COHERENCE_TOLERANCES.rounding >= COHERENCE_TOLERANCES.upstand

/**
 * A sample where the wall top ends in the roof's deck: past where the roof's own wall ends, short
 * of a parapet. A wall ending inside the roof's knee wall or gable end is that wall twice and
 * hidden in it, which is how the editor's own auto roof is seated, a knee wall below the wall tops:
 * nothing shows through the roof, so nothing is reported here (an opening in it is Hosting's).
 */
function isInside(sample: WallRoofSample): boolean {
  return sample.pastSolid > eps && !clearsCovering(sample)
}

const issueId = (kind: keyof typeof ENCLOSURE_KINDS, ...ids: string[]) =>
  `enclosure/roof-wall-${ENCLOSURE_KINDS[kind].slug}/${[...ids].sort().join('+')}`

const groupId = (kind: keyof typeof ENCLOSURE_KINDS, roofId: string) =>
  `enclosure/roof-wall-${ENCLOSURE_KINDS[kind].slug}/${roofId}`

/**
 * The issues of the roof–wall junction. A wall whose top ends inside the roof's body goes through
 * it, however far along (an error: two solids in one place). A wall that stops short of the
 * roof's underside is only a gap where it is an exterior wall: a partition under a ceiling is not
 * asked to reach the roof, and a wall whose sides are unknown is not guessed at.
 */
export function enclosureIssues(contacts: readonly WallRoofContact[]): CoherenceIssue[] {
  const issues: CoherenceIssue[] = []
  const issue = (
    contact: WallRoofContact,
    key: keyof typeof ENCLOSURE_KINDS,
    measured: CoherenceIssue['measured'],
  ): CoherenceIssue => {
    const { code, severity, principle } = ENCLOSURE_KINDS[key]
    const { wall, body } = contact
    return {
      id: issueId(key, wall.id, body.roof.id),
      group: groupId(key, body.roof.id),
      family: 'enclosure',
      code,
      severity,
      principle,
      measured,
      nodeIds: [wall.id, body.roof.id],
      levelIds: [...new Set([contact.levelId, body.levelId])],
      carrierId: body.roof.id,
      figures: contact.figures,
    }
  }

  for (const contact of contacts) {
    const { figures } = contact
    const inside = contact.samples.filter(isInside)
    const lowest = Math.min(...contact.samples.map((sample) => sample.aboveCovering))

    if (inside.length) {
      const along =
        inside.length === contact.samples.length
          ? 'along its whole length'
          : `along ${m(inside.length * contact.step)} of ${m(contact.wallLength)} m of it`
      const lowestInside = Math.min(...inside.map((sample) => sample.aboveCovering))
      issues.push(
        issue(contact, 'pierce', {
          quantity: 'wall top − roof underside, sampled along the wall',
          expected: contact.declaredParapet
            ? `declared a parapet: a top at least ${COHERENCE_TOLERANCES.upstand} m above the roof covering along the whole wall`
            : `0 ± ${eps} m (the wall carries the roof), or a top at least ${COHERENCE_TOLERANCES.upstand} m above the roof covering (a parapet)`,
          actual: `${signed(figures.overUnderside)} m over the underside ${along}; the top is ${signed(lowestInside)} m against the roof covering, which is ${lowestInside < 0 ? 'inside it' : 'short of a parapet'}`,
        }),
      )
    }

    // A wall declared a parapet is tested as one, and only as one: that is a different obligation,
    // not an exemption. It owes the roof a clear top along its whole length, then its cap.
    if (contact.declaredParapet) {
      if (inside.length) continue
      if (!contact.samples.every(clearsCovering)) {
        issues.push(
          issue(contact, 'parapetShort', {
            quantity: 'wall top − roof covering, sampled along a declared parapet',
            expected: `at least ${COHERENCE_TOLERANCES.upstand} m (the wall rises past the roof)`,
            actual: `the top is ${signed(lowest)} m against the roof covering: the wall ${figures.overUnderside > -eps ? 'bears on the roof' : 'stops under it'} and does not rise past it`,
          }),
        )
      } else if (!contact.capped) {
        issues.push(
          issue(contact, 'parapetUncapped', {
            quantity: 'cap of a declared parapet',
            expected: 'cap: true (a coping on top of the wall)',
            actual: 'declared a parapet, and not capped',
          }),
        )
      }
      continue
    }

    const short = contact.samples.filter((sample) => sample.over < -eps)
    if (short.length && contact.exterior)
      issues.push(
        issue(contact, 'gap', {
          quantity: 'roof underside − wall top, sampled along an exterior wall',
          expected: `at most ${eps} m (the roof sits on the wall)`,
          actual: `the roof underside stands up to ${m(figures.shortOfUnderside)} m above the wall top, along ${m(short.length * contact.step)} of ${m(contact.wallLength)} m of it`,
        }),
      )
  }
  return issues
}
