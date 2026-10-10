import { levelIdOf } from '../agent-operations/scene-queries'
import { GROUND_SUPPORT_ID } from '../hooks/spatial-grid/support-host-id'
import { isLevelAtSiteDatum, levelBaseElevationAt } from '../lib/terrain-support'
import type { AnyNode, AnyNodeId, ColumnNode, RoofNode, SlabNode, WallNode } from '../schema'
import { findLevelBelowId, getLevelElevations, type LevelElevation } from '../services/storey'
import { pointInPolygon } from '../systems/slab/slab-support'
import { DEFAULT_WALL_THICKNESS } from '../systems/wall/wall-footprint'
import { sideOf } from './compass'
import { measureEnclosure, type WallRoofContact, wallTopOf } from './enclosure'
import { type RoofBody, resolveRoofBody, sampleRoofBody } from './roof-body'
import { COHERENCE_TOLERANCES } from './tolerances'
import type { CoherenceIssue, CoherenceSeverity, CoherenceViewSide, SupportIssue } from './types'

type SceneNodes = Readonly<Record<string, AnyNode>>
type Vec2 = [number, number]

/** Per kind: its code, severity and the principle it measures. The one place severities live. */
export const SUPPORT_KINDS = {
  orphan: {
    slug: 'orphan',
    code: 'support_orphan',
    severity: 'check' as CoherenceSeverity,
    principle:
      'A post, column or pier carries something: a roof, a beam or a floor bears on its top. One that carries nothing is an orphan, unless it is ornament.',
  },
  cantilever: {
    slug: 'cantilever',
    code: 'support_cantilever',
    severity: 'check' as CoherenceSeverity,
    principle:
      'A roof is carried by what it rests on: past its supports it may reach a quarter of the span they hold it by, a light-framing rule of thumb that is not engineering.',
  },
  notSeated: {
    slug: 'not-seated',
    code: 'support_not_seated',
    severity: 'check' as CoherenceSeverity,
    principle:
      'An element rests on what carries it. One that stands a few centimetres off its support is placement imprecision, not a flying object: lower it onto it.',
  },
  floating: {
    slug: 'floating',
    code: 'support_floating',
    severity: 'error' as CoherenceSeverity,
    principle:
      'Loads reach the ground along a continuous path: every element rests on something. One with nothing under it floats.',
  },
} as const

/** What bears on a post, or hangs above it. A gap is the body's underside minus the post's top. */
export type PostNeighbour = { id: string; gap: number }

/** One post (a column), measured: where it stands and what is on it. */
export type PostReading = {
  column: ColumnNode
  levelId: string
  /** Where it stands in the plan, and its half extents (m). */
  point: Vec2
  half: Vec2
  base: number
  top: number
  /** Everything resting on its top, within the contact tolerance or deeper. */
  bearing: PostNeighbour[]
  /** The nearest body above its top that does not touch it. */
  above: PostNeighbour | null
  /** The highest thing under its base, when anything is: the floor, a wall, a post, a roof. */
  below: { id: string; top: number } | null
  /** Nothing under its base reaches it: every surface under it ends more than the contact short. */
  floating: boolean
  ornament: boolean
}

/** One roof, measured against what could carry it. */
export type RoofReading = {
  roof: RoofNode
  levelId: string
  body: RoofBody
  /** How far its seat stands above its level's plane (m): the roof's own height. */
  lift: number
  /** The posts and walls whose tops reach its underside. */
  bearing: string[]
  /** The nearest support top that stops short of its underside (m under the seat). */
  nearest: PostNeighbour | null
  /** Lifted off its plane with nothing reaching it, and no walls under it for Enclosure to judge. */
  floating: boolean
  /** The sides on which it reaches past its supports by more than a quarter of their span. */
  reaches: Reach[]
}

export type Reach = { side: CoherenceViewSide; overhang: number; backspan: number }

export type SupportReading = {
  posts: PostReading[]
  roofs: RoofReading[]
  elevations: Map<string, LevelElevation>
}

const eps = COHERENCE_TOLERANCES.contact
const m = (value: number) => Math.abs(value).toFixed(2)

/** The visible half extents of a column in the plan, as its definition draws them. */
function footprintHalf(column: ColumnNode): Vec2 {
  if (column.source) return [column.width / 2, column.depth / 2]
  if (column.supportStyle === 'vertical') {
    if (column.crossSection === 'square') return [column.width / 2, column.width / 2]
    if (column.crossSection === 'rectangular') return [column.width / 2, column.depth / 2]
    return [column.radius, column.radius]
  }
  return [
    Math.max(column.width, column.braceWidth, column.braceBottomSpread, column.braceTopSpread) / 2,
    Math.max(column.depth, column.braceDepth) / 2,
  ]
}

/** The level and the ones directly above and below it, for deciding what a write reaches. */
function neighbourhood(levelId: string, elevations: Map<string, LevelElevation>): Set<string> {
  const ordered = [...elevations].sort((a, b) => a[1].ordinal - b[1].ordinal).map(([id]) => id)
  const at = ordered.indexOf(levelId)
  const near = new Set<string>([levelId])
  if (at < 0) return near
  const below = findLevelBelowId(levelId, elevations)
  if (below) near.add(below)
  const above = ordered[at + 1]
  if (above) near.add(above)
  return near
}

/**
 * Every post in scope, with what rests on its top. A post is a column: the one vertical member the
 * schema has. What can bear on it is read from the stored nodes alone: a roof's underside at the
 * post (the body `resolveRoofBody` builds), a slab's underside over it, or another post stacked on
 * it. `levelIds` limits the check to posts on, or next to, those levels.
 */
export function measureSupport(
  nodes: SceneNodes,
  options: { levelIds?: ReadonlySet<string>; contacts?: readonly WallRoofContact[] } = {},
): SupportReading {
  const elevations = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>)
  const scope = options.levelIds

  const roofs = new Map<string, RoofBody | null>()
  const bodyOf = (roof: AnyNode & { type: 'roof' }): RoofBody | null => {
    if (!roofs.has(roof.id)) {
      const levelId = levelIdOf(nodes, roof.id)
      roofs.set(
        roof.id,
        levelId && nodes[levelId]?.type === 'level'
          ? resolveRoofBody(roof, levelId, nodes, elevations)
          : null,
      )
    }
    return roofs.get(roof.id) ?? null
  }

  const posts: PostReading[] = []
  for (const node of Object.values(nodes)) {
    if (node.type !== 'column') continue
    const levelId = levelIdOf(nodes, node.id)
    if (!levelId || nodes[levelId]?.type !== 'level') continue
    if (scope && ![...neighbourhood(levelId, elevations)].some((id) => scope.has(id))) continue
    const point: Vec2 = [node.position[0], node.position[2]]
    const baseY = elevations.get(levelId)?.baseY ?? 0
    const floor = floorOf(nodes, node, levelId, point)
    const base = baseY + (floor?.lift ?? 0) + node.position[1]
    posts.push({
      column: node,
      levelId,
      point,
      half: footprintHalf(node),
      base,
      top: base + node.height,
      bearing: [],
      above: null,
      below: floor ? { id: floor.id, top: baseY + floor.lift } : null,
      floating: false,
      ornament: node.role === 'ornament',
    })
  }

  const slabs = Object.values(nodes).filter((node): node is SlabNode => node.type === 'slab')
  for (const post of posts) {
    const reach = Math.max(post.half[0], post.half[1])
    const note = (neighbour: PostNeighbour) => {
      if (neighbour.gap <= eps) post.bearing.push(neighbour)
      else if (!post.above || neighbour.gap < post.above.gap) post.above = neighbour
    }

    for (const node of Object.values(nodes)) {
      if (node.type !== 'roof') continue
      const body = bodyOf(node)
      const hit = body && sampleRoofBody(body, post.point, reach)
      // A roof the post stands taller than, past its covering, is not resting on it.
      if (hit && post.top <= hit.covering + eps)
        note({ id: node.id, gap: hit.underside - post.top })
    }

    for (const slab of slabs) {
      if (!pointInPolygon(post.point[0], post.point[1], slab.polygon)) continue
      const slabLevel = levelIdOf(nodes, slab.id)
      const slabTop = (slabLevel ? (elevations.get(slabLevel)?.baseY ?? 0) : 0) + slab.elevation
      const slabBottom = slabTop - slab.thickness
      if (slabTop >= post.top - eps) note({ id: slab.id, gap: slabBottom - post.top })
    }

    for (const other of posts) {
      if (other === post) continue
      const overlaps =
        Math.abs(other.point[0] - post.point[0]) <= other.half[0] + post.half[0] &&
        Math.abs(other.point[1] - post.point[1]) <= other.half[1] + post.half[1]
      if (overlaps && other.base >= post.top - eps)
        note({ id: other.column.id, gap: other.base - post.top })
    }
  }

  for (const post of posts) {
    const reach = Math.max(post.half[0], post.half[1])
    const rest = (id: string, top: number) => {
      if (!post.below || top > post.below.top) post.below = { id, top }
    }
    // Only a post lifted off its floor needs a look at what else it could stand on.
    if (!post.below || post.base > post.below.top + eps) {
      for (const other of posts) {
        const overlaps =
          other !== post &&
          Math.abs(other.point[0] - post.point[0]) <= other.half[0] + post.half[0] &&
          Math.abs(other.point[1] - post.point[1]) <= other.half[1] + post.half[1]
        if (overlaps) rest(other.column.id, other.top)
      }
      const near = neighbourhood(post.levelId, elevations)
      for (const node of Object.values(nodes)) {
        if (node.type === 'wall' && !node.curveOffset) {
          const wallLevel = levelIdOf(nodes, node.id)
          if (wallLevel && near.has(wallLevel) && onWall(node, post.point))
            rest(node.id, wallTopOf(nodes, node, wallLevel))
        } else if (node.type === 'roof') {
          const body = bodyOf(node)
          const hit = body && sampleRoofBody(body, post.point, reach)
          if (hit) rest(node.id, hit.covering)
        }
      }
    }
    post.floating = !post.below || post.below.top < post.base - eps
  }

  const contacts = options.contacts ?? measureEnclosure(nodes, { levelIds: scope })
  const roofReadings: RoofReading[] = []
  for (const node of Object.values(nodes)) {
    if (node.type !== 'roof') continue
    const body = bodyOf(node)
    if (!body?.segments.length) continue
    if (scope && ![...neighbourhood(body.levelId, elevations)].some((id) => scope.has(id))) continue
    const bearing: string[] = []
    const gaps: PostNeighbour[] = []
    // Walls under a roof are the Enclosure family's to judge: a roof that stands clear of them is
    // a check there, not a second report here.
    const walled = contacts.some((contact) => contact.body.roof.id === node.id)
    for (const post of posts) {
      if (post.bearing.some((neighbour) => neighbour.id === node.id)) bearing.push(post.column.id)
      else if (post.above?.id === node.id) gaps.push({ id: post.column.id, gap: post.above.gap })
    }
    for (const contact of contacts) {
      if (contact.body.roof.id !== node.id) continue
      const reach = Math.max(...contact.samples.map((sample) => sample.over))
      if (reach >= -eps) bearing.push(contact.wall.id)
      else gaps.push({ id: contact.wall.id, gap: -reach })
    }
    const nearest = gaps.reduce<PostNeighbour | null>(
      (best, gap) => (!best || gap.gap < best.gap ? gap : best),
      null,
    )
    const lift = node.position[1]
    const bearers = [
      ...posts.filter((post) => bearing.includes(post.column.id)).flatMap(postCorners),
      ...contacts
        .filter((contact) => contact.body.roof.id === node.id && bearing.includes(contact.wall.id))
        .flatMap((contact) => wallCorners(contact.wall)),
    ]
    // A roof that follows its walls, or sits on another roof, is carried by what it follows.
    const follows = node.support?.kind === 'walls' || node.support?.kind === 'roof'
    roofReadings.push({
      roof: node,
      levelId: body.levelId,
      body,
      lift,
      bearing: bearing.sort(),
      nearest,
      floating: !follows && !walled && lift > eps && bearing.length === 0,
      reaches: follows ? [] : reachesOf(body, bearers),
    })
  }
  return { posts, roofs: roofReadings, elevations }
}

/**
 * The floor a post is placed on, as the editor places it: the walking surface of the slab that
 * holds its centre, else the ground when the level is the one at grade (flat ground is zero).
 * `position[1]` is then the post's height above that surface. A storey above the ground with no
 * slab under the post has no floor of its own.
 */
function floorOf(
  nodes: SceneNodes,
  column: ColumnNode,
  levelId: string,
  point: Vec2,
): { lift: number; id: string } | null {
  // The maker (or the election) pinned the post to the ground: no slab over it lifts it.
  const toGround = column.supportSlabId === GROUND_SUPPORT_ID
  const hosted = column.supportSlabId ? nodes[column.supportSlabId] : undefined
  const candidates = toGround
    ? []
    : hosted?.type === 'slab'
      ? [hosted]
      : Object.values(nodes).filter(
          (node): node is SlabNode => node.type === 'slab' && levelIdOf(nodes, node.id) === levelId,
        )
  let best: SlabNode | null = null
  for (const slab of candidates) {
    if (!pointInPolygon(point[0], point[1], slab.polygon)) continue
    if (!best || slab.elevation > best.elevation) best = slab
  }
  if (best) return { lift: best.elevation, id: best.id }
  if (isLevelAtSiteDatum(nodes as Record<string, AnyNode>, levelId))
    return {
      lift: levelBaseElevationAt(nodes as Record<string, AnyNode>, levelId, point[0], point[1]),
      id: 'ground',
    }
  return null
}

/** Whether a point is within a wall's thickness of its centre line. */
function onWall(wall: WallNode, [x, z]: Vec2): boolean {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length2 = dx * dx + dz * dz
  const t = length2
    ? Math.max(0, Math.min(1, ((x - wall.start[0]) * dx + (z - wall.start[1]) * dz) / length2))
    : 0
  const reach = (wall.thickness ?? DEFAULT_WALL_THICKNESS) / 2 + eps
  return Math.hypot(x - (wall.start[0] + t * dx), z - (wall.start[1] + t * dz)) <= reach
}

const turn = ([x, z]: Vec2, angle: number): Vec2 => [
  x * Math.cos(angle) - z * Math.sin(angle),
  x * Math.sin(angle) + z * Math.cos(angle),
]

/** The corners of a post's footprint in the plan. */
function postCorners(post: PostReading): Vec2[] {
  const { rotation } = post.column
  return ([-1, 1] as const).flatMap((sx) =>
    ([-1, 1] as const).map((sz): Vec2 => {
      const [lx, lz] = [sx * post.half[0], sz * post.half[1]]
      return [
        post.point[0] + Math.cos(rotation) * lx + Math.sin(rotation) * lz,
        post.point[1] - Math.sin(rotation) * lx + Math.cos(rotation) * lz,
      ]
    }),
  )
}

/** The corners of a wall's footprint in the plan. */
function wallCorners(wall: WallNode): Vec2[] {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dz) || 1
  const half = (wall.thickness ?? DEFAULT_WALL_THICKNESS) / 2
  const [nx, nz] = [(-dz / length) * half, (dx / length) * half]
  return [wall.start, wall.end].flatMap(([x, z]): Vec2[] => [
    [x + nx, z + nz],
    [x - nx, z - nz],
  ])
}

/**
 * The sides on which a roof reaches past what bears on it, by more than the eaves it is allowed
 * and more than a quarter of the span of those supports on that axis, measured in the roof's own
 * frame. A roof with nothing bearing on it reaches past nothing: it is carried by its plane, or it
 * floats, which is another item.
 */
function reachesOf(body: RoofBody, bearers: readonly Vec2[]): Reach[] {
  if (!bearers.length) return []
  const { roof } = body
  const local = bearers.map(
    (point): Vec2 =>
      turn([point[0] - roof.position[0], point[1] - roof.position[2]], roof.rotation),
  )
  const footprint = body.segments.flatMap(({ segment }) =>
    ([-1, 1] as const).flatMap((sx) =>
      ([-1, 1] as const).map((sz): Vec2 => {
        const [x, z] = turn([(sx * segment.width) / 2, (sz * segment.depth) / 2], -segment.rotation)
        return [x + segment.position[0], z + segment.position[2]]
      }),
    ),
  )
  const extent = (points: readonly Vec2[], axis: 0 | 1) => [
    Math.min(...points.map((point) => point[axis])),
    Math.max(...points.map((point) => point[axis])),
  ]
  const reaches: Reach[] = []
  for (const axis of [0, 1] as const) {
    const [bearerLow, bearerHigh] = extent(local, axis)
    const [footLow, footHigh] = extent(footprint, axis)
    const backspan = bearerHigh! - bearerLow!
    // One line of support (a wall, a row of posts) has no span on this axis to take a quarter of:
    // what hangs from it is an engineered cantilever or a canopy, and the declaration for that is
    // not built yet.
    if (backspan < COHERENCE_TOLERANCES.minBackspan) continue
    for (const sign of [-1, 1] as const) {
      const overhang = sign > 0 ? footHigh! - bearerHigh! : bearerLow! - footLow!
      if (
        overhang <= COHERENCE_TOLERANCES.eaveAllowance ||
        overhang <= COHERENCE_TOLERANCES.cantileverRatio * backspan + COHERENCE_TOLERANCES.rounding
      )
        continue
      const outward: Vec2 = axis === 0 ? [sign, 0] : [0, sign]
      reaches.push({ side: sideOf([0, 0], turn(outward, -roof.rotation)), overhang, backspan })
    }
  }
  return reaches
}

/** Close enough above its support to be a placement slip rather than a flying object. */
const nearEnough = (gap: number, supported: boolean) =>
  supported && gap <= COHERENCE_TOLERANCES.seated + COHERENCE_TOLERANCES.rounding

const issueId = (slug: string, ...ids: string[]) => `support/${slug}/${[...ids].sort().join('+')}`

/** The issues of what carries what. */
export function supportIssues(reading: SupportReading): CoherenceIssue[] {
  const issues: SupportIssue[] = []
  for (const post of reading.posts) {
    const { column } = post
    if (!post.ornament && post.bearing.length === 0) {
      const { code, severity, principle, slug } = SUPPORT_KINDS.orphan
      issues.push({
        id: issueId(slug, column.id),
        group: `support/${slug}/${post.levelId}`,
        family: 'support',
        code,
        severity,
        principle,
        measured: {
          quantity: 'what rests on the top of a post',
          expected: `a roof, a beam or a floor within ${eps} m of its top (or role: 'ornament')`,
          actual: post.above
            ? `nothing rests on it; ${post.above.id} is ${m(post.above.gap)} m above its top, clear of it`
            : 'nothing is above it',
        },
        nodeIds: [column.id],
        levelIds: [post.levelId],
        carrierId: column.id,
        figures: {
          at: post.top,
          gap: post.above?.gap ?? 0,
          nothing: post.above ? 0 : 1,
          overhang: 0,
          backspan: 0,
        },
      })
    }

    if (post.floating) {
      const gap = post.below ? post.base - post.below.top : 0
      const { code, severity, principle, slug } = nearEnough(gap, !!post.below)
        ? SUPPORT_KINDS.notSeated
        : SUPPORT_KINDS.floating
      issues.push({
        id: issueId(slug, column.id),
        group: `support/${slug}/${post.levelId}`,
        family: 'support',
        code,
        severity,
        principle,
        measured: {
          quantity: 'what a post stands on',
          expected: `its base on a floor, a wall, a post or a roof, within ${eps} m`,
          actual: post.below
            ? `its base is ${m(gap)} m above the highest thing under it (${post.below.id})`
            : 'nothing is under it',
        },
        nodeIds: [column.id],
        levelIds: [post.levelId],
        carrierId: column.id,
        figures: { at: post.base, gap, nothing: post.below ? 0 : 1, overhang: 0, backspan: 0 },
      })
    }
  }

  for (const roof of reading.roofs) {
    if (!roof.floating) continue
    const { code, severity, principle, slug } = nearEnough(roof.nearest?.gap ?? 0, !!roof.nearest)
      ? SUPPORT_KINDS.notSeated
      : SUPPORT_KINDS.floating
    issues.push({
      id: issueId(slug, roof.roof.id),
      group: `support/${slug}/${roof.roof.id}`,
      family: 'support',
      code,
      severity,
      principle,
      measured: {
        quantity: 'what carries a roof lifted off its level plane',
        expected: `a wall or post top within ${eps} m of its underside, or the roof on its level plane`,
        actual: roof.nearest
          ? `the roof stands ${m(roof.lift)} m above its level plane and the nearest support (${roof.nearest.id}) is ${m(roof.nearest.gap)} m under it`
          : `the roof stands ${m(roof.lift)} m above its level plane and nothing is under it`,
      },
      nodeIds: [roof.roof.id],
      levelIds: [...new Set([roof.levelId, ...(roof.nearest ? [] : [])])],
      carrierId: roof.roof.id,
      figures: {
        at: roof.body.seat,
        gap: roof.nearest?.gap ?? 0,
        nothing: roof.nearest ? 0 : 1,
        overhang: 0,
        backspan: 0,
      },
    })
  }
  for (const roof of reading.roofs) {
    for (const reach of roof.reaches) {
      const { code, severity, principle, slug } = SUPPORT_KINDS.cantilever
      issues.push({
        id: issueId(`${slug}-${reach.side}`, roof.roof.id),
        group: `support/${slug}/${roof.roof.id}`,
        family: 'support',
        code,
        severity,
        principle,
        measured: {
          quantity: 'how far a roof reaches past its supports, against the span they hold it by',
          expected: `at most ${COHERENCE_TOLERANCES.cantileverRatio * 100}% of the span, or an eave of ${COHERENCE_TOLERANCES.eaveAllowance} m (provisional, not engineering)`,
          actual: `reaches ${m(reach.overhang)} m past its supports on the ${reach.side}; a quarter of the ${m(reach.backspan)} m between them is ${m(COHERENCE_TOLERANCES.cantileverRatio * reach.backspan)} m`,
        },
        nodeIds: [roof.roof.id],
        levelIds: [roof.levelId],
        carrierId: roof.roof.id,
        figures: {
          at: roof.body.seat,
          gap: 0,
          nothing: 0,
          overhang: reach.overhang,
          backspan: reach.backspan,
        },
      })
    }
  }
  return issues
}
