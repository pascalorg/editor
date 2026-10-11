import { isAgentRefusal, refuse } from '../agent-tools/refusal'
import { referenceContours } from '../building/reference-construction'
import { imagePointToLevel } from '../building/reference-transform'
import { planWallOpening } from '../building/wall-openings'
import {
  type AnyNode,
  ElevatorNode,
  type LevelNode,
  StairNode,
  StairSegmentNode,
  type WallNode,
} from '../schema'
import { getStoredLevelHeight } from '../services/storey'
import { planOwnedFloorOpenings } from '../systems/owned-floor-openings'
import { stairFootprintAABB } from '../systems/stair/stair-footprint'
import { applySceneChanges } from './apply-changes'
import { createdSummary } from './created-summary'
import { addEntryDoors } from './entry-doors'
import { requirePlanGuide } from './plan-calibration'
import { floorSpaceReader, type Space, wallSidesReader } from './reachability'
import type { AgentOperation, SceneChanges, SceneNodes } from './types'

type CoresInput = {
  guideId: string
  cores: { shapeId: string; kind: 'stair' | 'lift' }[]
  levelIds?: string[]
}

type Pt = [number, number]

/** Comfortable residential flights: 18 cm risers, 27 cm treads, 0.9–1.2 m wide. */
const RISER = 0.18
const TREAD = 0.27
const MIN_FLIGHT = 0.9
const MAX_FLIGHT = 1.2
/** Past the shaft wall, where a lift's door is checked for the floor it opens onto. */
const LIFT_DOOR_REACH = 0.6
/**
 * How much circulation a point opens onto: a shared zone's area. Open floor (no zone) counts 1 m²:
 * it beats an apartment or a void, never a corridor.
 */
const circulationArea = (space: Space | null) =>
  space?.kind === 'floor' ? 1 : space?.kind === 'zone' && !space.apartment ? space.area : 0
/** Kept clear inside a core's outline, for its walls. */
const MARGIN = 0.1
/** A stair core, m²: larger, a shape around a flight is an apartment or the building. */
const CORE_MAX_AREA = 40

/** A core's rectangle on the level: centre, long axis (unit), long and short sides. */
type CoreRect = { centre: Pt; axis: Pt; long: number; short: number }

function coreRect(points: readonly Pt[], toLevel: (point: Pt) => Pt): CoreRect {
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  const [minX, maxX, minY, maxY] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ]
  const origin = toLevel([minX, minY])
  const acrossX = toLevel([maxX, minY])
  const acrossY = toLevel([minX, maxY])
  const far = toLevel([maxX, maxY])
  const edge = (to: Pt): Pt => [to[0] - origin[0], to[1] - origin[1]]
  const [ex, ey] = [edge(acrossX), edge(acrossY)]
  const [lx, ly] = [Math.hypot(...ex), Math.hypot(...ey)]
  const [longEdge, long, short] = lx >= ly ? [ex, lx, ly] : [ey, ly, lx]
  return {
    centre: [(origin[0] + far[0]) / 2, (origin[1] + far[1]) / 2],
    axis: [longEdge[0] / long, longEdge[1] / long],
    long,
    short,
  }
}

/** Stair-local (x across, z up the first flight) to level, for a stair turned by `rotation`. */
const rotate = ([x, z]: Pt, rotation: number): Pt => [
  x * Math.cos(rotation) + z * Math.sin(rotation),
  -x * Math.sin(rotation) + z * Math.cos(rotation),
]

/**
 * A stair climbing `rise` inside the core: a switchback (two flights side by side, their landing
 * across the core) when two flights fit across it, else one straight flight; null when neither
 * does. The first flight climbs along the core's long axis.
 */
function planStair(rect: CoreRect, rise: number, landing?: Pt) {
  const steps = Math.max(3, Math.round(rise / RISER))
  const riser = rise / steps
  const long = rect.long - 2 * MARGIN
  const short = rect.short - 2 * MARGIN
  const rotation = Math.atan2(rect.axis[0], rect.axis[1])
  const placed = (localCentre: Pt) => {
    const [dx, dz] = rotate(localCentre, rotation)
    return [rect.centre[0] - dx, 0, rect.centre[1] - dz] as [number, number, number]
  }
  const first = Math.ceil(steps / 2)
  const turnWidth = Math.min(MAX_FLIGHT, short / 2)
  if (turnWidth >= MIN_FLIGHT && first * TREAD + turnWidth <= long) {
    const width = turnWidth
    const flight = (count: number, attachmentSide: 'front' | 'left') => ({
      segmentType: 'stair' as const,
      width,
      length: count * TREAD,
      height: count * riser,
      stepCount: count,
      attachmentSide,
    })
    const landing_ = (attachmentSide: 'front' | 'left') => ({
      segmentType: 'landing' as const,
      width,
      length: width,
      height: 0,
      stepCount: 0,
      attachmentSide,
    })
    // A switchback starts and ends at the same end: with `landing`, the chain runs against the
    // other end of the core and the whole slack is a landing on that side (Victor run 11's flights
    // sat in the middle, a step from the core's walls at both ends).
    const run = first * TREAD + width
    if (landing) {
      const away: Pt = [-landing[0], -landing[1]]
      const turned = Math.atan2(away[0], away[1])
      // The foot, on the core's axis: the chain ends at the far wall, the landing fills the rest.
      const foot = run - long / 2
      const [ox, oz] = [rect.centre[0] + landing[0] * foot, rect.centre[1] + landing[1] * foot]
      const [dx, dz] = rotate([width / 2, 0], turned)
      return {
        width,
        rotation: turned,
        steps,
        position: [ox - dx, 0, oz - dz] as [number, number, number],
        landingDepth: long - run,
        segments: [
          flight(first, 'front'),
          landing_('front'),
          landing_('left'),
          flight(steps - first, 'left'),
        ],
      }
    }
    return {
      width,
      rotation,
      steps,
      // The chain spans x ∈ [−w/2, 3w/2] and z ∈ [0, first run + w] in stair-local space.
      position: placed([width / 2, run / 2]),
      segments: [
        flight(first, 'front'),
        landing_('front'),
        landing_('left'),
        flight(steps - first, 'left'),
      ],
    }
  }
  const width = Math.min(MAX_FLIGHT, short)
  if (width >= MIN_FLIGHT && steps * TREAD <= long)
    return {
      width,
      rotation,
      steps,
      position: placed([0, (steps * TREAD) / 2]),
      segments: [
        {
          segmentType: 'stair' as const,
          width,
          length: steps * TREAD,
          height: rise,
          stepCount: steps,
          attachmentSide: 'front' as const,
        },
      ],
    }
  return null
}

function servedLevels(nodes: SceneNodes, guideLevel: LevelNode, levelIds?: string[]) {
  const all = Object.values(nodes).filter((node): node is LevelNode => node.type === 'level')
  const chosen = levelIds
    ? levelIds.map((id) => {
        const level = nodes[id]
        if (level?.type !== 'level')
          refuse('level_not_found', `Level not found: ${id}.`, { levelId: id })
        return level
      })
    : all.filter(
        (level) =>
          level.parentId === guideLevel.parentId &&
          level.level >= guideLevel.level &&
          Object.values(nodes).some((node) => node.type === 'slab' && node.parentId === level.id),
      )
  return [...chosen].sort((a, b) => a.level - b.level)
}

/** Inside the core, `clearance` clear of its edges (where the core's own walls stand). */
const inside = (rect: CoreRect, [x, z]: readonly number[], clearance = 0) => {
  const dx = x! - rect.centre[0]
  const dz = z! - rect.centre[1]
  const along = dx * rect.axis[0] + dz * rect.axis[1]
  const across = -dx * rect.axis[1] + dz * rect.axis[0]
  return (
    Math.abs(along) <= rect.long / 2 - clearance && Math.abs(across) <= rect.short / 2 - clearance
  )
}

/** On the core's outline: along one of its sides, within `tolerance`. */
const onRectEdge = (rect: CoreRect, [x, z]: readonly number[], tolerance = 0.15) => {
  const dx = x! - rect.centre[0]
  const dz = z! - rect.centre[1]
  const along = Math.abs(dx * rect.axis[0] + dz * rect.axis[1])
  const across = Math.abs(-dx * rect.axis[1] + dz * rect.axis[0])
  return (
    (Math.abs(along - rect.long / 2) <= tolerance && across <= rect.short / 2 + tolerance) ||
    (Math.abs(across - rect.short / 2) <= tolerance && along <= rect.long / 2 + tolerance)
  )
}

const polygonArea = (polygon: readonly Pt[]) =>
  Math.abs(
    polygon.reduce((sum, [x, z], i) => {
      const [nx, nz] = polygon[(i + 1) % polygon.length]!
      return sum + x * nz - nx * z
    }, 0),
  ) / 2

const centroidOf = (polygon: readonly Pt[]): Pt =>
  polygon.reduce<Pt>(
    ([x, z], [px, pz]) => [x + px / polygon.length, z + pz / polygon.length],
    [0, 0],
  )

/** Clear of the core's edge by the wall's half thickness and a margin. */
const wallClearance = (wall: WallNode) => (wall.thickness ?? 0.1) / 2 + 0.05

/** A wall that runs through the core without lying wholly inside it (a corridor drawn into it). */
const crossesCore = (rect: CoreRect, wall: WallNode) =>
  Array.from({ length: 23 }, (_, i) => (i + 1) / 24).some((t) =>
    inside(
      rect,
      [
        wall.start[0] + (wall.end[0] - wall.start[0]) * t,
        wall.start[1] + (wall.end[1] - wall.start[1]) * t,
      ],
      wallClearance(wall),
    ),
  )

/**
 * `create_stairs_and_lifts`: a stair between each pair of floors in every stair core, one lift
 * serving them all in every lift core, read from the cores a floor plan draws; their floor
 * openings cut as the editor cuts them. No Victor run built either. A core that already holds one
 * is skipped, so the call can be repeated.
 */
export const createStairsAndLifts: AgentOperation<CoresInput> = (nodes, input) => {
  const { guide, view } = requirePlanGuide(nodes, input.guideId)
  if (!guide.scaleReference)
    refuse(
      'not_calibrated',
      `${guide.name ?? guide.id} is not calibrated: calibrate it or match it onto a calibrated plan first.`,
      { guideId: guide.id },
    )
  const guideLevel = nodes[guide.parentId ?? '']
  if (guideLevel?.type !== 'level')
    refuse('level_not_found', `${guide.name ?? guide.id} is not on a level.`, { guideId: guide.id })
  const levels = servedLevels(nodes, guideLevel, input.levelIds)
  if (levels.length < 2)
    refuse(
      'too_few_levels',
      `Stairs and lifts connect floors: ${levels.length} floor${levels.length === 1 ? '' : 's'} with a slab from ${guideLevel.name ?? guideLevel.id} up. Build the floors (slabs) first, or pass levelIds.`,
      { levels: levels.length },
    )
  const contours = new Map(referenceContours(guide).map((contour) => [contour.id, contour]))
  const toLevel = (point: Pt) => imagePointToLevel(point, view.image, view.transform) as Pt
  const building = nodes[guideLevel.parentId ?? '']
  const origin = building && 'position' in building ? (building.position as number[]) : [0, 0, 0]

  const spaceAt = floorSpaceReader(nodes)
  const stairCores: { rect: CoreRect; landing: Pt }[] = []
  const changes: Required<Pick<SceneChanges, 'create' | 'update' | 'delete'>> = {
    create: [],
    update: [],
    delete: [],
  }
  const createdIds: string[] = []
  const skipped: { shapeId: string; reason: string; detail?: string }[] = []
  let stairs = 0
  let lifts = 0
  const existing = Object.values(nodes)

  // A flight named instead of its core (Victor run 9b named both): a flight-shaped shape stands for
  // the smallest core-sized shape around it that holds a stair, never an apartment or the outline.
  const rise = getStoredLevelHeight(levels[0]!)
  const rectOf = (shapeId: string) => {
    const contour = contours.get(shapeId)
    return contour ? coreRect(contour.points as Pt[], toLevel) : null
  }
  const resolved: { shapeId: string; core: string }[] = []
  const coreOf = (shapeId: string, kind: 'stair' | 'lift') => {
    const rect = rectOf(shapeId)
    const flightShaped =
      !!rect && rect.short >= 0.6 && rect.short <= MAX_FLIGHT + 0.2 && rect.long >= 1.5
    if (kind !== 'stair' || !flightShaped || planStair(rect, rise)) return shapeId
    const holder = [...contours.keys()]
      .flatMap((id) => {
        const around = id === shapeId ? null : rectOf(id)
        return around &&
          around.long * around.short > rect.long * rect.short &&
          around.long * around.short <= CORE_MAX_AREA &&
          inside(around, rect.centre) &&
          planStair(around, rise)
          ? [{ id, area: around.long * around.short }]
          : []
      })
      .sort((a, b) => a.area - b.area)[0]
    if (!holder) return shapeId
    resolved.push({ shapeId, core: holder.id })
    return holder.id
  }
  const requested = [
    ...new Map(
      input.cores.map((core) => {
        const shapeId = coreOf(core.shapeId, core.kind)
        return [`${core.kind}:${shapeId}`, { ...core, shapeId }] as const
      }),
    ).values(),
  ]

  // What the plan drew inside a core, built as walls (its flights, a divider), stands where the
  // stair or the shaft goes: cleared on every floor the core serves. A wall that only runs into the
  // core is reported where a stair stands, never removed.
  const servedIds = new Set<string>(levels.map((level) => level.id))
  const stairLevelIds = new Set<string>(levels.slice(0, -1).map((level) => level.id))
  const walls = existing.filter(
    (node): node is WallNode =>
      node.type === 'wall' && servedIds.has(node.parentId ?? '') && !node.curveOffset,
  )
  const cleared = new Set<string>()
  const overlaps: { wallId: string; levelId: string }[] = []
  const clearCore = (rect: CoreRect, kind: 'stair' | 'lift') => {
    for (const wall of walls) {
      if (cleared.has(wall.id)) continue
      const clearance = wallClearance(wall)
      if (inside(rect, wall.start, clearance) && inside(rect, wall.end, clearance)) {
        cleared.add(wall.id)
        changes.delete.push(wall.id)
      } else if (
        kind === 'stair' &&
        stairLevelIds.has(wall.parentId ?? '') &&
        crossesCore(rect, wall) &&
        !overlaps.some((overlap) => overlap.wallId === wall.id)
      )
        overlaps.push({ wallId: wall.id, levelId: wall.parentId ?? '' })
    }
  }

  for (const core of requested) {
    const contour = contours.get(core.shapeId)
    if (!contour)
      refuse('unknown_shape', `${guide.name ?? guide.id} has no shape ${core.shapeId}.`, {
        guideId: guide.id,
        shapeId: core.shapeId,
      })
    const rect = coreRect(contour.points as Pt[], toLevel)
    clearCore(rect, core.kind)

    if (core.kind === 'lift') {
      const held = existing.some(
        (node) =>
          node.type === 'elevator' &&
          inside(rect, [node.position[0] + (origin[0] ?? 0), node.position[2] + (origin[2] ?? 0)]),
      )
      if (held) {
        skipped.push({ shapeId: core.shapeId, reason: 'already_built' })
        continue
      }
      const cab = Math.max(0.8, Math.min(rect.short, rect.long) - 0.3)
      // The door goes on the side that opens onto circulation on most floors: Victor run 11's
      // lifts took the end of the core's long axis and opened into an apartment on every floor.
      const base = Math.atan2(rect.axis[0], rect.axis[1])
      const turns = [
        { rotation: base, width: rect.short, depth: rect.long },
        { rotation: base + Math.PI, width: rect.short, depth: rect.long },
        { rotation: base + Math.PI / 2, width: rect.long, depth: rect.short },
        { rotation: base - Math.PI / 2, width: rect.long, depth: rect.short },
      ]
      // Scored by the circulation the door opens onto, floor by floor: a corridor beats a small
      // lobby walled off from it (Victor run 11).
      const opensOnto = (turn: (typeof turns)[number]) => {
        const [dx, dz] = rotate([0, -(turn.depth / 2 + LIFT_DOOR_REACH)], turn.rotation)
        return levels.reduce(
          (sum, level) =>
            sum + circulationArea(spaceAt(level.id, [rect.centre[0] + dx, rect.centre[1] + dz])),
          0,
        )
      }
      const turn = turns.reduce((best, next) => (opensOnto(next) > opensOnto(best) ? next : best))
      const lift = ElevatorNode.parse({
        parentId: building?.id,
        position: [rect.centre[0] - (origin[0] ?? 0), 0, rect.centre[1] - (origin[2] ?? 0)],
        rotation: turn.rotation,
        width: cab,
        depth: cab,
        shaftWidth: turn.width,
        shaftDepth: turn.depth,
        fromLevelId: levels[0]!.id,
        toLevelId: levels.at(-1)!.id,
      })
      changes.create.push({ node: lift, parentId: building?.id })
      createdIds.push(lift.id)
      lifts++
      continue
    }

    // The landing goes on the side that opens onto the most circulation.
    const facing = (side: Pt) =>
      levels.reduce((sum, level) => {
        const reach = rect.long / 2 + 0.6
        const space = spaceAt(level.id, [
          rect.centre[0] + side[0] * reach,
          rect.centre[1] + side[1] * reach,
        ])
        return sum + circulationArea(space)
      }, 0)
    const landingSide = ([[-rect.axis[0], -rect.axis[1]], rect.axis] as Pt[]).reduce(
      (best, side) => (facing(side) > facing(best) ? side : best),
    )
    stairCores.push({ rect, landing: landingSide })
    for (const [index, lower] of levels.slice(0, -1).entries()) {
      const upper = levels[index + 1]!
      const held = existing.some(
        (node) =>
          node.type === 'stair' &&
          node.parentId === lower.id &&
          inside(rect, [node.position[0], node.position[2]]),
      )
      if (held) continue
      const plan = planStair(rect, getStoredLevelHeight(lower), landingSide)
      const landingDepth = (plan as { landingDepth?: number } | null)?.landingDepth
      if (landingDepth !== undefined && landingDepth < MIN_FLIGHT)
        skipped.push({
          shapeId: core.shapeId,
          reason: 'short_landing',
          detail: `${lower.name ?? lower.id}: ${landingDepth.toFixed(2)} m of landing at the foot of a ${getStoredLevelHeight(lower)} m storey in a ${rect.long.toFixed(2)} × ${rect.short.toFixed(2)} m core. A taller storey needs a longer core, or a stair of three flights.`,
        })
      if (!plan) {
        skipped.push({
          shapeId: core.shapeId,
          reason: 'core_too_small',
          detail: `${rect.long.toFixed(2)} × ${rect.short.toFixed(2)} m holds neither a ${MIN_FLIGHT} m switchback nor a straight flight of ${Math.round(getStoredLevelHeight(lower) / RISER)} steps.`,
        })
        break
      }
      const segments = plan.segments.map((segment) => StairSegmentNode.parse(segment))
      const stair = StairNode.parse({
        parentId: lower.id,
        name: `Stair ${lower.name ?? lower.level} → ${upper.name ?? upper.level}`,
        position: plan.position,
        rotation: plan.rotation,
        stairType: 'straight',
        fromLevelId: lower.id,
        toLevelId: upper.id,
        slabOpeningMode: 'destination',
        openingOffset: 0.08,
        width: plan.width,
        totalRise: getStoredLevelHeight(lower),
        stepCount: plan.steps,
        railingMode: 'both',
        children: segments.map((segment) => segment.id),
      })
      changes.create.push({ node: stair, parentId: lower.id })
      for (const segment of segments)
        changes.create.push({ node: { ...segment, parentId: stair.id }, parentId: stair.id })
      createdIds.push(stair.id)
      stairs++
    }
  }

  const counts = {
    stairs,
    lifts,
    levels: levels.length,
    ...(skipped.length ? { skipped } : {}),
    ...(cleared.size ? { wallsCleared: cleared.size } : {}),
    ...(overlaps.length
      ? {
          overlaps: overlaps.slice(0, 20),
          overlapHint:
            'These walls run into a stair core where a stair stands. Shorten or delete them if the plan does not draw them there.',
        }
      : {}),
    ...(resolved.length ? { resolved } : {}),
  }
  if (!createdIds.length && !cleared.size)
    return { result: { status: 'already_present', ...counts } }

  // The editor's own opening pass: each new stair and lift owns a floor opening in the floors it
  // passes, which cuts their plates; the live opening systems then find it in place.
  let built = applySceneChanges(nodes, changes) as Record<string, AnyNode>
  const opened: Required<Pick<SceneChanges, 'create' | 'update' | 'delete'>> = {
    create: [],
    update: [],
    delete: [],
  }
  for (const patch of planOwnedFloorOpenings(built, { ownerIds: new Set(createdIds) })) {
    if (patch.op === 'create')
      opened.create.push({ node: patch.node, parentId: patch.node.parentId ?? undefined })
    else if (patch.op === 'update') opened.update.push({ id: patch.id, data: patch.data })
    else opened.delete.push(patch.id)
  }
  const openings = opened.create.filter(({ node }) => node.type === 'floor-opening').length
  changes.create.push(...opened.create)
  changes.update.push(...opened.update)
  changes.delete.push(...opened.delete)
  built = applySceneChanges(built, opened) as Record<string, AnyNode>

  // Victor run 11's survey read both lift cores and both stair cores as apartments: units and entry
  // doors went into them. Once a stair or a lift stands in a core, the unit there is a common core.
  const coreRects = requested.flatMap((core) => {
    const contour = contours.get(core.shapeId)
    return contour ? [{ rect: coreRect(contour.points as Pt[], toLevel), kind: core.kind }] : []
  })
  const fixed: Required<Pick<SceneChanges, 'create' | 'update' | 'delete'>> = {
    create: [],
    update: [],
    delete: [],
  }
  let coreUnits = 0
  for (const unit of Object.values(built)) {
    if (unit.type !== 'unit' || (unit.kind ?? 'apartment') !== 'apartment') continue
    const zones = unit.members.flatMap((id) => {
      const zone = built[id as string]
      return zone?.type === 'zone' && servedIds.has(zone.parentId ?? '') ? [zone] : []
    })
    const core = coreRects.find(({ rect }) =>
      zones.some(
        (zone) =>
          inside(rect, centroidOf(zone.polygon as Pt[])) &&
          polygonArea(zone.polygon as Pt[]) <= 1.5 * rect.long * rect.short,
      ),
    )
    if (!core) continue
    const name = core.kind === 'lift' ? 'Lift core' : 'Stair core'
    fixed.update.push({ id: unit.id, data: { kind: 'common', name } })
    for (const zone of zones) fixed.update.push({ id: zone.id, data: { name } })
    coreUnits++
  }
  built = applySceneChanges(built, fixed) as Record<string, AnyNode>

  // A door on a core's outline that now opens into the shaft or the well leads nowhere: dropped,
  // and the apartment it was the entry of gets one onto the corridor instead.
  const doorAt = (wall: WallNode, along: number): Pt => {
    const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]) || 1
    return [
      wall.start[0] + ((wall.end[0] - wall.start[0]) * along) / length,
      wall.start[1] + ((wall.end[1] - wall.start[1]) * along) / length,
    ]
  }
  const doorsOn = (levelId: string) =>
    Object.values(built).flatMap((wall) =>
      wall.type === 'wall' && wall.parentId === levelId && !wall.curveOffset
        ? wall.children.flatMap((id) => {
            const door = built[id]
            return door?.type === 'door' ? [{ wall, door, at: doorAt(wall, door.position[0]) }] : []
          })
        : [],
    )
  let sidesOf = wallSidesReader(built)
  const dropped: string[] = []
  const reentered = new Set<string>()
  for (const level of levels)
    for (const { wall, door, at } of doorsOn(level.id)) {
      if (!coreRects.some(({ rect }) => onRectEdge(rect, at, 0.2))) continue
      const sides = sidesOf(wall, door.position[0])
      if (!sides?.some((side) => side.kind === 'shaft' || side.kind === 'void')) continue
      dropped.push(door.id)
      reentered.add(level.id)
    }
  if (dropped.length) {
    fixed.delete.push(...dropped)
    built = applySceneChanges(built, { delete: dropped }) as Record<string, AnyNode>
    const entries = addEntryDoors(built, { levelIds: [...reentered] }, { activeLevelId: null })
    if (entries.changes) {
      fixed.create.push(...(entries.changes.create ?? []))
      built = applySceneChanges(built, entries.changes) as Record<string, AnyNode>
    }
    sidesOf = wallSidesReader(built)
  }

  // Each stair's landing joined to the corridor by a door in the core's wall, on every floor.
  const circulation = (side: Space) =>
    side.kind === 'floor' || (side.kind === 'zone' && !side.apartment)
  const landingFloor = (side: Space) => side.kind === 'floor' || side.kind === 'zone'
  let coreDoors = 0
  for (const { rect, landing } of stairCores)
    for (const level of levels) {
      const joins = (wall: WallNode, along: number) => {
        const sides = sidesOf(wall, along)
        if (!sides) return false
        const [a, b] = sides
        return (landingFloor(a) && circulation(b)) || (landingFloor(b) && circulation(a))
      }
      const served = doorsOn(level.id).some(
        ({ wall, door, at }) => onRectEdge(rect, at, 0.2) && joins(wall, door.position[0]),
      )
      if (served) continue
      // The end wall on the landing side first, then the long walls beside the landing.
      const beside = rect.long / 2 - 0.9
      const across: Pt = [-rect.axis[1], rect.axis[0]]
      const targets: Pt[] = [
        [
          rect.centre[0] + landing[0] * (rect.long / 2),
          rect.centre[1] + landing[1] * (rect.long / 2),
        ],
        ...[1, -1].map(
          (sign): Pt => [
            rect.centre[0] + landing[0] * beside + across[0] * sign * (rect.short / 2),
            rect.centre[1] + landing[1] * beside + across[1] * sign * (rect.short / 2),
          ],
        ),
      ]
      const walls = Object.values(built).filter(
        (node): node is WallNode =>
          node.type === 'wall' && node.parentId === level.id && !node.curveOffset,
      )
      let placed: ReturnType<typeof planWallOpening> | null = null
      for (const target of targets) {
        for (const wall of walls) {
          const [ax, az] = wall.start
          const [bx, bz] = wall.end
          const length = Math.hypot(bx - ax, bz - az) || 1
          const along = ((target[0] - ax) * (bx - ax) + (target[1] - az) * (bz - az)) / length
          if (along < 0.5 || along > length - 0.5) continue
          const [px, pz] = doorAt(wall, along)
          if (Math.hypot(px - target[0], pz - target[1]) > 0.2 || !joins(wall, along)) continue
          try {
            placed = planWallOpening(built, {
              kind: 'door',
              wallId: wall.id,
              t: along / length,
              width: 0.9,
            })
          } catch (error) {
            if (!isAgentRefusal(error)) throw error
          }
          if (placed) break
        }
        if (placed) break
      }
      if (!placed) continue
      const door = { ...placed.node, name: 'Stair door' } as AnyNode
      fixed.create.push({ node: door, parentId: placed.wallId })
      built = applySceneChanges(built, {
        create: [{ node: door, parentId: placed.wallId }],
      }) as Record<string, AnyNode>
      coreDoors++
    }
  changes.create.push(...fixed.create)
  changes.update.push(...fixed.update)
  changes.delete.push(...fixed.delete)

  const outside = createdIds.filter((id) => {
    const node = built[id]
    return node?.type === 'stair' && !stairFootprintAABB(node, built)
  })
  return {
    result: {
      status: createdIds.length ? 'created' : 'cleared',
      ...createdSummary(createdIds),
      ...counts,
      ...(openings ? { openings } : {}),
      ...(coreUnits ? { coreUnits } : {}),
      ...(coreDoors ? { coreDoors } : {}),
      ...(dropped.length ? { doorsIntoCores: dropped.length } : {}),
      ...(outside.length ? { unmeasured: outside } : {}),
    },
    changes,
  }
}
