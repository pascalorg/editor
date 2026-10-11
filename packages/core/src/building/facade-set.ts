import type { SpaceBoundaryFace } from '../lib/room-graph'
import type {
  AnyNode,
  AnyNodeId,
  FacadeArea,
  FacadeNode,
  FacadeSegment,
  LevelNode,
  WallNode,
} from '../schema'
import {
  type FacadeMode,
  readLiveWallFacade,
  readWallFacade,
  type WallFacade,
} from '../systems/facade/facade-config'
import type { FacadeRole, FacadeSet } from '../systems/facade/facade-set'
import { type FacadeUnit, FacadeUnitSchema, isPaintOnlyUnit } from '../systems/facade/facade-unit'
import { areSemanticValuesEqual } from '../utils/semantic-equal'
import {
  type FacadeFillPlan,
  type FacadeScenePatch,
  type FacadeWallRefusalCode,
  facadeFillPatches,
  facadeRemovalPatches,
  facadeWallRefusal,
  planFacadeFill,
  reclaimDetachedFacades,
} from './facade'
import {
  buildingLevels,
  cross,
  dot,
  loopWalls,
  outsideLoop,
  type Point,
  polylineLength,
  sub,
  wallsByLevel,
} from './facade-loops'
import { type FacadeFace, type FacadeWallTarget, facadeFace, facadeFaceNormal } from './facade-runs'
import {
  facadeTreatedStoreys,
  facadeTreatmentPatches,
  facadeWallTreatments,
} from './facade-treatments'

/** How far off a segment's line a wall may sit and still be on it: plan-imported floors never align to the millimetre. */
const SEGMENT_OFFSET = 0.15
/** Sine of the largest angle between a wall and a segment it lies along (about 3°). */
const SEGMENT_SIN = 0.05
/** Less overlap than this with a segment is a wall touching its end, not lying along it. */
const MIN_OVERLAP = 0.05

export type FacadeSetIssueCode =
  | FacadeWallRefusalCode
  | 'unit_missing'
  | 'storey_gone'
  | 'no_outside_loop'
  | 'wall_past_loop_corner'
  | 'fill_failed'

export type FacadeSetIssue = {
  /** Stable, for agents that refuse with the same code on every surface. */
  code: FacadeSetIssueCode
  message: string
  levelId?: string
  wallId?: string
  area?: string
}

/** A stretch of a storey's outside loop, on the wall centrelines. */
export type FacadeCoverageRun = {
  levelId: string
  wallId: string
  length: number
  start: Point
  end: Point
  /** Why the set left it bare, when it tried to cover it. */
  reason?: string
}

export type FacadeCoverage = {
  /** Every storey's outside loop, in metres along the wall centrelines. */
  total: number
  units: {
    key: string
    name: string
    role: FacadeRole
    length: number
    share: number
    /** Openings the unit placed: a unit covering walls it builds nothing on shows 0. */
    openings: number
  }[]
  uncovered: FacadeCoverageRun[]
  uncoveredShare: number
}

export type FacadeSetPlan = {
  /** One batch: the facade node, every unit's fill, and the walls the set let go. */
  patches: FacadeScenePatch[]
  coverage: FacadeCoverage
  issues: FacadeSetIssue[]
  plans: FacadeFillPlan[]
  skipped: number
  displaced: number
}

/**
 * The storeys a set's roles fall on: storeys with walls, by level index. The
 * lowest is first and the highest top; in a one-storey building it is first.
 */
export function facadeLevelRoles(nodes: Record<string, AnyNode>, buildingId: string) {
  const walls = wallsByLevel(nodes)
  const levels = buildingLevels(nodes, buildingId).filter((level) => walls.has(level.id))
  return {
    levels,
    first: levels[0],
    middle: levels.slice(1, -1),
    top: levels.length > 1 ? levels.at(-1) : undefined,
  }
}

/**
 * Where a set's storey roles go on a building, each on every storey's outside
 * loop: first on the lowest, top on the highest, middle between — and on those
 * two when the set has no unit for them. Free units get areas from their walls.
 */
export function defaultFacadeAreas(
  set: FacadeSet,
  nodes: Record<string, AnyNode>,
  buildingId: string,
): FacadeArea[] {
  const { levels } = facadeLevelRoles(nodes, buildingId)
  const withRole = (role: FacadeRole) => set.units.find((unit) => unit.role === role)
  const area = (key: string, from: LevelNode, to: LevelNode): FacadeArea => ({
    key,
    unit: key,
    from: from.id,
    to: to.id,
    target: { kind: 'loop' },
  })
  if (!levels.length) return []
  const first = withRole('first')
  const middle = withRole('middle')
  const top = withRole('top')
  let lo = 0
  let hi = levels.length - 1
  const areas: FacadeArea[] = []
  if (first) areas.push(area(first.key, levels[lo]!, levels[lo++]!))
  const topArea = top && hi >= lo ? area(top.key, levels[hi]!, levels[hi--]!) : null
  if (middle && hi >= lo) areas.push(area(middle.key, levels[lo]!, levels[hi]!))
  if (topArea) areas.push(topArea)
  return areas
}

/** The paint slot a face uses: its semantic side, else the front-is-interior convention. */
function surfaceFor(wall: WallNode, face: FacadeFace): FacadeWallTarget {
  const semantic = face === 'front' ? wall.frontSide : wall.backSide
  const surface =
    semantic === 'interior' || semantic === 'exterior'
      ? semantic
      : face === 'front'
        ? 'interior'
        : 'exterior'
  return { surface, face }
}

/**
 * Plan segments for walls picked on one storey, facing out of their facade:
 * the face a facade already fills, else the one on the storey's outside loop.
 */
export function facadeSegmentsFromWalls(
  walls: readonly WallNode[],
  nodes: Record<string, AnyNode>,
): FacadeSegment[] {
  const byLevel = wallsByLevel(nodes)
  const loops = new Map<string, SpaceBoundaryFace[] | null>()
  return walls.map((wall) => {
    const levelId = wall.parentId as string
    if (!loops.has(levelId)) loops.set(levelId, outsideLoop(byLevel.get(levelId) ?? [wall]))
    const onLoop = loops.get(levelId)?.find((face) => face.wallId === wall.id)
    const face =
      readWallFacade(wall.metadata)?.face ??
      onLoop?.face ??
      facadeFace(wall, { surface: 'exterior' })
    return { start: wall.start, end: wall.end, normal: facadeFaceNormal(wall, face) }
  })
}

/** The face of `wall` that lies along `segment` and faces the same way, if it does. */
function faceOnSegment(wall: WallNode, segment: FacadeSegment): FacadeFace | null {
  const along = sub(segment.end, segment.start)
  const length = Math.hypot(...along)
  if (length < 1e-6) return null
  const direction: Point = [along[0] / length, along[1] / length]
  const wallAlong = sub(wall.end, wall.start)
  const wallLength = Math.hypot(...wallAlong)
  if (wallLength < 1e-6) return null
  if (Math.abs(cross(direction, wallAlong)) / wallLength > SEGMENT_SIN) return null
  const offStart = Math.abs(cross(direction, sub(wall.start, segment.start)))
  const offEnd = Math.abs(cross(direction, sub(wall.end, segment.start)))
  if (Math.max(offStart, offEnd) > SEGMENT_OFFSET) return null
  const a = dot(sub(wall.start, segment.start), direction)
  const b = dot(sub(wall.end, segment.start), direction)
  const overlap = Math.min(Math.max(a, b), length) - Math.max(Math.min(a, b), 0)
  // Walls meeting the segment at its ends touch it; only those lying along it belong.
  if (overlap < Math.max(MIN_OVERLAP, wallLength / 2)) return null
  return dot(facadeFaceNormal(wall, 'front'), segment.normal as Point) > 0 ? 'front' : 'back'
}

/** The scene as it will be once `patches` are applied, without a store. */
function commitPatches(
  nodes: Record<string, AnyNode>,
  patches: readonly FacadeScenePatch[],
): Record<string, AnyNode> {
  if (!patches.length) return nodes
  const next = { ...nodes }
  const setChildren = (parentId: string | null | undefined, edit: (ids: string[]) => string[]) => {
    const parent = parentId ? next[parentId] : undefined
    if (parent && 'children' in parent)
      next[parent.id] = { ...parent, children: edit(parent.children as string[]) } as AnyNode
  }
  const remove = (id: string) => {
    const node = next[id]
    if (!node) return
    if ('children' in node) for (const child of node.children as string[]) remove(child)
    delete next[id]
    setChildren(node.parentId, (ids) => ids.filter((child) => child !== id))
  }
  for (const patch of patches) {
    if (patch.op === 'delete') remove(patch.id)
    else if (patch.op === 'create') {
      next[patch.node.id] = patch.node
      setChildren(patch.parentId, (ids) => [...ids, patch.node.id])
    } else next[patch.id] = { ...next[patch.id]!, ...patch.data } as AnyNode
  }
  return next
}

type Assigned = {
  unitKey: string
  area: string
  levelId: string
  mode: FacadeMode
  target: FacadeWallTarget
}

/**
 * Which walls each area takes, last area winning, and why some it wanted are
 * left out. Walls a facade cannot be generated on become issues, not errors.
 */
function assignWalls(facade: FacadeNode, nodes: Record<string, AnyNode>, force: boolean) {
  const issues: FacadeSetIssue[] = []
  const levels = buildingLevels(nodes, facade.parentId as string)
  const byLevel = wallsByLevel(nodes)
  const loops = new Map<string, SpaceBoundaryFace[] | null>()
  const loopOf = (levelId: string) => {
    if (!loops.has(levelId)) loops.set(levelId, outsideLoop(byLevel.get(levelId) ?? []))
    return loops.get(levelId)!
  }
  const units = new Set(facade.set.units.map((unit) => unit.key))
  const assigned = new Map<string, Assigned>()
  // A wall one area refuses may still be taken by a later one: only the last word counts.
  const refused = new Map<string, FacadeSetIssue>()
  for (const area of facade.areas) {
    if (!units.has(area.unit)) {
      issues.push({
        area: area.key,
        code: 'unit_missing',
        message: `Area “${area.key}” uses a unit the set no longer has.`,
      })
      continue
    }
    const from = levels.findIndex((level) => level.id === area.from)
    const to = levels.findIndex((level) => level.id === area.to)
    if (from < 0 || to < 0) {
      issues.push({
        area: area.key,
        code: 'storey_gone',
        message: `Area “${area.key}” refers to a storey that is gone.`,
      })
      continue
    }
    for (const level of levels.slice(Math.min(from, to), Math.max(from, to) + 1)) {
      const walls = byLevel.get(level.id) ?? []
      if (!walls.length) continue
      const take = (wall: WallNode, target: FacadeWallTarget) => {
        refused.delete(wall.id)
        assigned.set(wall.id, {
          unitKey: area.unit,
          area: area.key,
          levelId: level.id,
          mode: area.mode ?? 'place',
          target,
        })
      }
      if (area.target.kind === 'segments') {
        for (const wall of walls)
          for (const segment of area.target.segments) {
            const face = faceOnSegment(wall, segment)
            if (face) {
              take(wall, surfaceFor(wall, face))
              break
            }
          }
        continue
      }
      const loop = loopOf(level.id)
      if (!loop) {
        issues.push({
          levelId: level.id,
          area: area.key,
          code: 'no_outside_loop',
          message: `${level.name ?? 'This storey'} has no closed outside loop of walls yet.`,
        })
        continue
      }
      // A wall running past a corner of the loop would get openings outside it.
      const { fits, pastCorner } = loopWalls(loop, nodes)
      for (const wall of pastCorner)
        if (!assigned.has(wall.id))
          refused.set(wall.id, {
            levelId: level.id,
            wallId: wall.id,
            area: area.key,
            code: 'wall_past_loop_corner',
            message: `${wall.id} runs past a corner of the loop: split it at the junction before filling this loop.`,
          })
      for (const { wall, face } of fits) take(wall, surfaceFor(wall, face))
    }
  }
  issues.push(...refused.values())
  const paintOnly = new Map(
    facade.set.units.map((entry) => [entry.key, isPaintOnlyUnit(entry.unit)]),
  )
  for (const [wallId, entry] of assigned) {
    const wall = nodes[wallId] as WallNode
    const refusal = facadeWallRefusal(wall, nodes, { paintOnly: paintOnly.get(entry.unitKey) })
    if (!refusal || (force && refusal.code === 'wall_detached')) continue
    issues.push({ levelId: entry.levelId, wallId, area: entry.area, ...refusal })
    assigned.delete(wallId)
  }
  return { assigned, issues, levels, byLevel, loopOf }
}

/**
 * Plan a whole facade set in one batch. Each area takes its walls — last area
 * winning — and every unit fills its walls storey by storey, the same fill a
 * single unit uses. Walls this facade covered before and no longer does are
 * given back their own finish. Walls it cannot fill are reported, never fatal,
 * and coverage says how much of each storey's outside loop every unit took.
 */
export function planFacadeSet({
  facade,
  nodes: input,
  replaceExisting = false,
  force = false,
}: {
  facade: FacadeNode
  nodes: Record<string, AnyNode>
  /** Existing openings in a unit's way are removed rather than flowed around. */
  replaceExisting?: boolean
  /** Take back detached facades on the set's walls; what they released is replaced. */
  force?: boolean
}): FacadeSetPlan {
  const first = assignWalls(facade, input, force)
  const reclaim = force
    ? reclaimDetachedFacades(
        [...first.assigned.keys()].map((id) => input[id] as WallNode),
        input,
      )
    : null
  const nodes = reclaim?.nodes ?? input
  const { assigned, issues, levels, byLevel, loopOf } = reclaim
    ? assignWalls(facade, nodes, false)
    : first

  // Corner chains and bands run on every storey the areas span; what they ask of each
  // wall (a clear corner, cladding kept off the bands) goes into its snapshot.
  const { storeys, missing } = facadeTreatedStoreys(facade, nodes, loopOf)
  for (const level of missing)
    if (!issues.some((issue) => issue.levelId === level.id && issue.code === 'no_outside_loop'))
      issues.push({
        levelId: level.id,
        code: 'no_outside_loop',
        message: `${level.name ?? 'This storey'} has no closed outside loop of walls yet.`,
      })
  const treatedByWall = facadeWallTreatments(facade.set, storeys)

  const unitByKey = new Map(
    facade.set.units.map((entry) => [entry.key, FacadeUnitSchema.parse(entry.unit)]),
  )
  const leaving = Object.values(nodes).filter(
    (node): node is WallNode =>
      node.type === 'wall' &&
      !assigned.has(node.id) &&
      readLiveWallFacade(node.metadata)?.set?.facadeId === facade.id,
  )
  // A fill extends through collinear walls carrying its unit; not through walls this set takes elsewhere.
  const taken = new Set<string>([...assigned.keys(), ...leaving.map((wall) => wall.id)])

  // One fill per storey and unit value: walls carrying the same unit must share their runs,
  // exactly as resize sync will rebuild them.
  const groups = new Map<
    string,
    { unit: FacadeUnit; mode: FacadeMode; walls: WallNode[]; level: number }
  >()
  const levelIndex = new Map<string, number>(levels.map((level) => [level.id, level.level]))
  for (const [wallId, entry] of assigned) {
    const unit = unitByKey.get(entry.unitKey)!
    const key = `${entry.levelId}\n${entry.mode}\n${JSON.stringify(unit)}`
    const group = groups.get(key) ?? {
      unit,
      mode: entry.mode,
      walls: [],
      level: levelIndex.get(entry.levelId)!,
    }
    group.walls.push(nodes[wallId] as WallNode)
    groups.set(key, group)
  }

  const patches: FacadeScenePatch[] = facadeRemovalPatches(leaving, nodes)
  // A balcony deck lowers the wall under it, so a storey is planned against the
  // storeys above as they will be: its stored frame then matches what resize sync reads.
  let working = commitPatches(nodes, patches)
  const plans: FacadeFillPlan[] = []
  const bare = new Map<string, string>()
  for (const { unit, mode, walls } of [...groups.values()].sort((a, b) => b.level - a.level)) {
    const own = new Set<string>(walls.map((wall) => wall.id))
    const sets: Record<string, NonNullable<WallFacade['set']>> = {}
    const targets: Record<string, FacadeWallTarget> = {}
    for (const wall of walls) {
      const entry = assigned.get(wall.id)!
      sets[wall.id] = { facadeId: facade.id, unit: entry.unitKey }
      targets[wall.id] = entry.target
    }
    try {
      const plan = planFacadeFill({
        walls: walls.map((wall) => working[wall.id] as WallNode),
        nodes: working,
        unit,
        targets,
        replaceExisting,
        sourceItemId: facade.sourceItemId,
        exclude: new Set([...taken].filter((id) => !own.has(id))),
        sets,
        treatments: Object.fromEntries(walls.map((wall) => [wall.id, treatedByWall.get(wall.id)])),
        mode,
      })
      const planned = facadeFillPatches(plan, working)
      plans.push(plan)
      patches.push(...planned)
      working = commitPatches(working, planned)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const levelId = walls[0]!.parentId as string
      issues.push({ code: 'fill_failed', levelId, area: assigned.get(walls[0]!.id)!.area, message })
      for (const wall of walls) {
        bare.set(wall.id, message)
        assigned.delete(wall.id)
      }
    }
  }

  // Treatments last, on the storeys as the fills left them (a deck lowers the wall under it).
  patches.push(...facadeTreatmentPatches(facade, working, storeys))

  const existing = input[facade.id]
  const facadePatches: FacadeScenePatch[] = !existing
    ? [{ op: 'create', node: facade, parentId: facade.parentId as AnyNodeId }]
    : areSemanticValuesEqual(existing, facade)
      ? []
      : [{ op: 'update', id: facade.id as AnyNodeId, data: facade }]
  const reclaimPatches: FacadeScenePatch[] = reclaim
    ? [
        ...reclaim.removed.map((id): FacadeScenePatch => ({ op: 'delete', id, cascade: true })),
        ...reclaim.reclaimed.map(
          (wall): FacadeScenePatch => ({
            op: 'update',
            id: wall.id as AnyNodeId,
            data: { metadata: wall.metadata },
          }),
        ),
      ]
    : []
  const ordered = [...reclaimPatches, ...facadePatches, ...patches]
  const rank = { delete: 0, create: 1, update: 2 } as const

  for (const issue of issues)
    if (issue.wallId && !bare.has(issue.wallId)) bare.set(issue.wallId, issue.message)
  return {
    patches: ordered
      .map((patch, index) => ({ patch, index }))
      .sort((a, b) => rank[a.patch.op] - rank[b.patch.op] || a.index - b.index)
      .map(({ patch }) => patch),
    coverage: coverageOf(facade, assigned, plans, levels, byLevel, loopOf, bare, issues),
    issues,
    plans,
    skipped: plans.reduce((sum, plan) => sum + plan.skipped, 0),
    displaced: plans.reduce((sum, plan) => sum + plan.displaced.length, 0),
  }
}

function coverageOf(
  facade: FacadeNode,
  assigned: Map<string, Assigned>,
  plans: readonly FacadeFillPlan[],
  levels: readonly LevelNode[],
  byLevel: Map<string, WallNode[]>,
  loopOf: (levelId: string) => SpaceBoundaryFace[] | null,
  bare: Map<string, string>,
  issues: FacadeSetIssue[],
): FacadeCoverage {
  const lengths = new Map<string, number>()
  const openings = new Map<string, number>()
  const uncovered: FacadeCoverageRun[] = []
  let total = 0
  for (const plan of plans)
    for (const wallPlan of plan.walls) {
      const key = assigned.get(wallPlan.wall.id)?.unitKey
      if (key)
        openings.set(
          key,
          (openings.get(key) ?? 0) + wallPlan.openings.values.length + wallPlan.dressed.length,
        )
    }
  for (const level of levels) {
    if (!byLevel.get(level.id)?.length) continue
    const loop = loopOf(level.id)
    if (!loop) {
      if (!issues.some((issue) => issue.levelId === level.id && !issue.wallId))
        issues.push({
          levelId: level.id,
          code: 'no_outside_loop',
          message: `${level.name ?? 'This storey'} has no closed outside loop of walls yet.`,
        })
      continue
    }
    for (const face of loop) {
      const length = polylineLength(face.points)
      total += length
      const key = assigned.get(face.wallId)?.unitKey
      if (key) lengths.set(key, (lengths.get(key) ?? 0) + length)
      else
        uncovered.push({
          levelId: level.id,
          wallId: face.wallId,
          length,
          start: face.points[0]!,
          end: face.points.at(-1)!,
          ...(bare.has(face.wallId) ? { reason: bare.get(face.wallId) } : {}),
        })
    }
  }
  const share = (length: number) => (total > 0 ? length / total : 0)
  return {
    total,
    units: facade.set.units.map(({ key, role, unit }) => ({
      key,
      name: unit.name,
      role,
      length: lengths.get(key) ?? 0,
      share: share(lengths.get(key) ?? 0),
      openings: openings.get(key) ?? 0,
    })),
    uncovered,
    uncoveredShare: share(uncovered.reduce((sum, run) => sum + run.length, 0)),
  }
}
