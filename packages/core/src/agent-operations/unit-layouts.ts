import { isAgentRefusal, refuse } from '../agent-tools/refusal'
import {
  type EdgeKind,
  layoutWalls,
  mergeSegments,
  type Pt,
  rectsOutline,
  type UnitLayout,
  type UnitSpace,
} from '../building/unit-layout'
import { generateUnitLayouts, type UnitBrief } from '../building/unit-layout-generate'
import type { PlanMask } from '../building/unit-layout-plan-score'
import {
  finishUnitLayouts,
  type ProposeOptions,
  type ProposeResult,
  planUnitLayouts,
  proposeUnitLayouts,
  type UnitLayoutJudge,
  unitClientBrief,
} from '../building/unit-layout-propose'
import { type Placement, placeLayout, placeUnit } from '../building/unit-layout-transform'
import { type UnitRule, verifyUnitLayout } from '../building/unit-layout-verify'
import { planWallOpening } from '../building/wall-openings'
import { type AnyNode, WallNode, ZoneNode } from '../schema'
import { planarizeWallBatch } from '../systems/wall/wall-batch'
import { applySceneChanges } from './apply-changes'
import { createdSummary } from './created-summary'
import { across } from './entry-doors'
import type { AgentOperation, SceneChanges, SceneNodes } from './types'
import { registerSceneReport } from './verify-scene'

/**
 * `propose_unit_layouts` and `apply_unit_layout`: the unit interior guesser on the scene. A unit's
 * space is its zone's outline, turned into the building's own axes, with each edge's kind (party,
 * outside, shared) read the way `add_entry_doors` reads it. Proposing is read-only; applying
 * rebuilds the chosen layout from its seed, so no layout travels through the model.
 */

export { type PlanMask, planMask } from '../building/unit-layout-plan-score'
export type { UnitLayoutJudge, UnitLayoutVerdict } from '../building/unit-layout-propose'
export { unitClientBrief } from '../building/unit-layout-propose'

type Brief = { bedrooms: number; bathrooms: number; rooms?: UnitBrief['rooms'] }
type ProposeInput = Brief & { unitIds: string[]; planGuideId?: string; seed?: number }
type ApplyInput = Brief & {
  unitIds: string[]
  layoutId: string
  seed?: number
  spaceKey?: string
  consent: boolean
  replaceGuess?: boolean
}

/** Everything the guesser built carries this, so a real plan or another guess can replace it. */
export type GuessedMark = {
  by: 'unit-guesser'
  layoutId: string
  seed: number
  unitId: string
  brief: Brief
}

/** What a surface brings beyond the scene: the unit's plan image decoded, and the fast judge. */
export type UnitLayoutHost = { plan?: PlanMask; judge?: UnitLayoutJudge; draws?: number }

type UnitContext = {
  unitId: string
  name: string
  levelId: string
  zonePolygon: Pt[]
  space: UnitSpace
  /** The entry door already on the outline, in level coordinates. */
  entryDoor: Pt | null
  key: string
  /** How far squaring a traced outline moved its corners (m), when it did. */
  rectifiedBy: number
}

/** Edges within this of an axis are a tracing's noise, squared when no corner moves too far. */
const SQUARE_WITHIN = Math.tan((3 * Math.PI) / 180)
const SQUARE_AT_MOST = 0.15

/**
 * A traced outline squared: each side, a run of near-axis edges in a row, takes its points' mean
 * coordinate. A side split where its neighbours change (Victor run 11's apartments) is one side:
 * squared edge by edge, its pieces took means a tenth of a millimetre apart, and the slivers
 * between them failed every layout's coverage. Then sides closer than SQUARE_AT_MOST take one
 * coordinate too: a plan's line weights leave steps of a few centimetres (Victor run 11's
 * "Floor 4 9"), each a sliver no room can fill. The edges those steps leave empty are dropped;
 * `kept` lists the outline edges that remain, in order.
 */
function square(outline: Pt[]): { outline: Pt[]; moved: number; kept: number[] } {
  const n = outline.length
  const out = outline.map((p): Pt => [p[0], p[1]])
  const along = outline.map((a, i) => {
    const b = outline[(i + 1) % n]!
    const dx = Math.abs(b[0] - a[0])
    const dz = Math.abs(b[1] - a[1])
    if (dz <= dx * SQUARE_WITHIN && dx > 0) return 'x'
    if (dx <= dz * SQUARE_WITHIN && dz > 0) return 'z'
    return null
  })
  const done = new Set<number>()
  for (let start = 0; start < n; start++) {
    const kind = along[start]
    if (!kind || done.has(start)) continue
    let first = start
    for (let k = 0; k < n && along[(first - 1 + n) % n] === kind; k++) first = (first - 1 + n) % n
    const points = new Set<number>()
    for (let e = first, k = 0; k < n && along[e] === kind && !done.has(e); e = (e + 1) % n, k++) {
      done.add(e)
      points.add(e)
      points.add((e + 1) % n)
    }
    // A side along x shares one z; along z, one x.
    const axis = kind === 'x' ? 1 : 0
    const mean = round([...points].reduce((sum, p) => sum + outline[p]![axis], 0) / points.size)
    for (const p of points) out[p]![axis] = mean
  }
  for (const axis of [0, 1]) {
    const values = [...new Set(out.map((p) => p[axis]!))].sort((a, b) => a - b)
    const groups: number[][] = []
    for (const v of values) {
      const last = groups.at(-1)
      if (last && v - last[0]! < SQUARE_AT_MOST) last.push(v)
      else groups.push([v])
    }
    const to = new Map(
      groups.flatMap((g) => g.map((v) => [v, round(g.reduce((a, b) => a + b, 0) / g.length)])),
    )
    for (const p of out) p[axis] = to.get(p[axis]!)!
  }
  const moved = Math.max(...outline.map((p, i) => Math.hypot(p[0] - out[i]![0], p[1] - out[i]![1])))
  if (moved > SQUARE_AT_MOST) return { outline, moved: 0, kept: outline.map((_, i) => i) }
  const kept = out.flatMap((a, i) => {
    const b = out[(i + 1) % n]!
    return a[0] === b[0] && a[1] === b[1] ? [] : [i]
  })
  return { outline: kept.map((i) => out[i]!), moved, kept }
}

const round = (v: number) => Math.round(v * 1e4) / 1e4
const turn = ([x, z]: Pt, angle: number): Pt => [
  round(x * Math.cos(angle) - z * Math.sin(angle)),
  round(x * Math.sin(angle) + z * Math.cos(angle)),
]

/** FNV-1a: a short stable key of a unit's space, to tell a proposal from a changed unit. */
function spaceKey(space: UnitSpace) {
  let h = 0x811c9dc5
  for (const c of JSON.stringify(space)) {
    h ^= c.charCodeAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

const distanceToSegment = ([x, z]: Pt, [ax, az]: Pt, [bx, bz]: Pt) => {
  const dx = bx - ax
  const dz = bz - az
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)))
  return Math.hypot(x - ax - t * dx, z - az - t * dz)
}

/** The building's own axes: the direction of the unit's longest edge, within ±45°. */
function frameAngle(polygon: readonly Pt[]) {
  let best = 0
  let angle = 0
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length]!
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (length > best) {
      best = length
      angle = Math.atan2(b[1] - a[1], b[0] - a[0])
    }
  })
  const quarter = Math.PI / 2
  return angle - Math.round(angle / quarter) * quarter
}

function unitOf(nodes: SceneNodes, id: string) {
  const node = nodes[id]
  const zone =
    node?.type === 'zone'
      ? node
      : node?.type === 'unit'
        ? node.members.map((member) => nodes[member]).find((n) => n?.type === 'zone')
        : undefined
  if (!node || (node.type !== 'unit' && node.type !== 'zone'))
    refuse('unit_not_found', `Unit not found: ${id}.`, { unitId: id })
  if (zone?.type !== 'zone')
    refuse('unit_has_no_zone', `Unit ${id} has no zone with an outline.`, { unitId: id })
  const level = zone.parentId ? nodes[zone.parentId] : undefined
  if (level?.type !== 'level')
    refuse('unit_has_no_level', `Unit ${id} is on no level.`, { unitId: id })
  return { node, zone, levelId: level.id as string, name: node.name ?? zone.name ?? id }
}

function unitContext(nodes: SceneNodes, id: string, angle: number): UnitContext {
  const { zone, levelId, name } = unitOf(nodes, id)
  const all = Object.values(nodes)
  const zones = new Map(
    all.flatMap((n) =>
      n.type === 'zone' && n.parentId === levelId ? [[n.id as string, n] as const] : [],
    ),
  )
  const apartments = all.flatMap((n) =>
    n.type === 'unit' && (n.kind ?? 'apartment') === 'apartment'
      ? n.members.flatMap((m) => (zones.get(m) ? [zones.get(m)!.polygon as Pt[]] : []))
      : [],
  )
  const polygon = zone.polygon as Pt[]
  if (!apartments.includes(polygon)) apartments.push(polygon)
  const slabs = all.flatMap((n) =>
    n.type === 'slab' && n.parentId === levelId ? [n.polygon as Pt[]] : [],
  )
  const edges: EdgeKind[] = polygon.map((a, i) =>
    across(
      { start: a, end: polygon[(i + 1) % polygon.length]!, thickness: 0.1 },
      polygon,
      apartments,
      slabs,
    ),
  )

  // An entry door already on the outline fixes the entry wall; else the longest shared edge.
  const onOutline = (p: Pt, tolerance: number) =>
    polygon.some((a, i) => distanceToSegment(p, a, polygon[(i + 1) % polygon.length]!) <= tolerance)
  let entryDoor: Pt | null = null
  for (const wall of all) {
    if (wall.type !== 'wall' || wall.parentId !== levelId || wall.curveOffset) continue
    const tolerance = (wall.thickness ?? 0.1) / 2 + 0.05
    if (!(onOutline(wall.start as Pt, tolerance) && onOutline(wall.end as Pt, tolerance))) continue
    const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]) || 1
    for (const childId of wall.children) {
      const door = nodes[childId]
      if (door?.type !== 'door') continue
      const s = door.position[0] / length
      entryDoor = [
        wall.start[0] + (wall.end[0] - wall.start[0]) * s,
        wall.start[1] + (wall.end[1] - wall.start[1]) * s,
      ]
    }
  }
  const lengths = polygon.map((a, i) => {
    const b = polygon[(i + 1) % polygon.length]!
    return Math.hypot(b[0] - a[0], b[1] - a[1])
  })
  let entryEdge = -1
  if (entryDoor) {
    const door = entryDoor
    entryEdge = polygon
      .map((a, i) => distanceToSegment(door, a, polygon[(i + 1) % polygon.length]!))
      .reduce((best, d, i, all) => (d < all[best]! ? i : best), 0)
    edges[entryEdge] = 'shared'
  } else
    edges.forEach((kind, i) => {
      if (kind === 'shared' && (entryEdge < 0 || lengths[i]! > lengths[entryEdge]!)) entryEdge = i
    })
  if (entryEdge < 0)
    refuse(
      'no_entry_wall',
      `Unit ${name} has no wall onto a corridor for its entry. Add its entry door (add_entry_doors) first.`,
      { unitId: id },
    )
  const squared = square(polygon.map((p) => turn(p, -angle)))
  const space: UnitSpace = {
    outline: squared.outline,
    edges: squared.kept.map((i) => edges[i]!),
    entryEdge: Math.max(
      0,
      squared.kept.findIndex((i) => i >= entryEdge),
    ),
  }
  return {
    unitId: id,
    name,
    levelId,
    zonePolygon: polygon,
    space,
    entryDoor,
    key: spaceKey(space),
    rectifiedBy: Math.round(squared.moved * 1000) / 1000,
  }
}

/** The first unit is laid out; the others must be congruent with it, in any orientation. */
function prepare(nodes: SceneNodes, unitIds: string[]) {
  const first = unitOf(nodes, unitIds[0]!)
  const angle = frameAngle(first.zone.polygon as Pt[])
  const canonical = unitContext(nodes, unitIds[0]!, angle)
  const placed: (UnitContext & { placement: Placement })[] = []
  const refused: { unitId: string; reason: string }[] = []
  for (const id of unitIds.slice(1)) {
    const context = unitContext(nodes, id, angle)
    const placement = placeUnit(canonical.space, context.space)
    if (placement) placed.push({ ...context, placement })
    else
      refused.push({
        unitId: id,
        reason:
          'not congruent with the first unit (outline, or which walls are party, outside, shared)',
      })
  }
  return { angle, canonical, placed, refused }
}

const briefOf = ({ bedrooms, bathrooms, rooms }: Brief): UnitBrief => ({
  bedrooms,
  bathrooms,
  ...(rooms ? { rooms } : {}),
})

/** What each verify rule means, for the model to tell the person why nothing was kept. */
const RULE_WORDS: Record<UnitRule, string> = {
  covers_outline: 'the rooms leave part of the unit uncovered',
  doors_on_walls: 'a door has no wall to stand in',
  rooms_reachable: 'a room cannot be reached from the entry',
  min_width: 'a room is narrower than its minimum',
  bath_door: 'a bathroom opens onto the wrong room',
  entry_door: 'the entry does not land on the entry wall',
  wet_grouped: 'the kitchen and bathrooms are too far apart',
}

/** Why a proposal kept nothing, from its stats (Victor run 11 kept none and could not say why). */
function noneKeptWhy(stats: ProposeResult['stats']) {
  if (!stats.drawn)
    return 'No layout could be cut from this outline with the rooms asked. Ask for fewer rooms, or draw this unit from its plan.'
  if (!stats.valid) {
    const top = Object.entries(stats.rejectedBy)
      .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
      .slice(0, 3)
      .map(([rule, count]) => `${RULE_WORDS[rule as UnitRule]} (${count} of ${stats.drawn})`)
    return `All ${stats.drawn} layouts failed: ${top.join('; ')}.`
  }
  return 'Every valid layout was filtered out as one the client would refuse.'
}

function proposalResult(
  prepared: ReturnType<typeof prepare>,
  outcome: ProposeResult,
  input: ProposeInput,
  planRead: boolean,
) {
  const seed = input.seed ?? 1
  const unitIds = [prepared.canonical.unitId, ...prepared.placed.map((u) => u.unitId)]
  return {
    status: outcome.finalists.length ? 'proposed' : 'none_kept',
    ...(outcome.finalists.length ? {} : { why: noneKeptWhy(outcome.stats) }),
    guessed: !planRead,
    units: [
      {
        unitId: prepared.canonical.unitId,
        name: prepared.canonical.name,
        orientation: 'laid out',
        ...(prepared.canonical.rectifiedBy ? { rectifiedBy: prepared.canonical.rectifiedBy } : {}),
      },
      ...prepared.placed.map((u) => ({
        unitId: u.unitId,
        name: u.name,
        orientation: u.placement.orientation,
        ...(u.rectifiedBy ? { rectifiedBy: u.rectifiedBy } : {}),
      })),
    ],
    ...(prepared.refused.length ? { refusedUnits: prepared.refused } : {}),
    ...(input.planGuideId && !planRead
      ? { planImage: 'not read here: ordered by what code finds instead' }
      : {}),
    ordering: outcome.ordering,
    ...(outcome.registration ? { registration: outcome.registration } : {}),
    stats: outcome.stats,
    finalists: outcome.finalists.map((f) => ({
      layoutId: f.id,
      rooms: f.rooms,
      observations: f.observations,
      weakness: f.weakness,
      keep: f.keep,
      planScore: f.planScore,
      concerns: f.concerns,
      preview: f.previewSvg,
      applyWith: {
        unitIds,
        layoutId: f.id,
        bedrooms: input.bedrooms,
        bathrooms: input.bathrooms,
        ...(input.rooms ? { rooms: input.rooms } : {}),
        seed,
        spaceKey: prepared.canonical.key,
      },
    })),
    next: 'Show the drawings, let the person choose, then apply_unit_layout with the chosen applyWith and consent: true. Say these are guesses unless the plan image ordered them.',
  }
}

function proposeOptions(
  prepared: ReturnType<typeof prepare>,
  input: ProposeInput,
  host: UnitLayoutHost,
): ProposeOptions {
  const brief = briefOf(input)
  const area = prepared.canonical.space.outline.reduce((twice, a, i, pts) => {
    const b = pts[(i + 1) % pts.length]!
    return twice + a[0] * b[1] - b[0] * a[1]
  }, 0)
  return {
    brief,
    client: unitClientBrief(brief, Math.abs(area) / 2),
    seed: input.seed ?? 1,
    ...(host.draws ? { draws: host.draws } : {}),
    ...(host.plan ? { plan: host.plan } : {}),
    ...(host.judge ? { judge: host.judge } : {}),
  }
}

/** The whole funnel with what the surface brings: the plan image and the fast judge. */
export async function proposeUnitLayoutsInScene(
  nodes: SceneNodes,
  input: ProposeInput,
  host: UnitLayoutHost = {},
) {
  const prepared = prepare(nodes, input.unitIds)
  const outcome = await proposeUnitLayouts(
    prepared.canonical.space,
    proposeOptions(prepared, input, host),
  )
  return proposalResult(prepared, outcome, input, !!host.plan)
}

/** The shared operation: the funnel with no plan image and no judge, ordered by what code finds. */
export const proposeLayouts: AgentOperation<ProposeInput> = (nodes, input) => {
  const prepared = prepare(nodes, input.unitIds)
  const options = proposeOptions(prepared, input, {})
  const planned = planUnitLayouts(prepared.canonical.space, options)
  return {
    result: proposalResult(
      prepared,
      finishUnitLayouts(prepared.canonical.space, planned, new Map(), options),
      input,
      false,
    ),
  }
}

const LABEL: Record<string, string> = {
  living: 'Living',
  kitchen: 'Kitchen',
  hall: 'Hall',
  entry: 'Entry',
  bedroom: 'Bedroom',
  bathroom: 'Bath',
  walk_in: 'Walk-in',
  closet: 'Closet',
  pantry: 'Pantry',
  laundry: 'Laundry',
}

const marked = <N extends AnyNode>(node: N, mark: GuessedMark): N => ({
  ...node,
  metadata: { ...((node.metadata as Record<string, unknown> | undefined) ?? {}), guessed: mark },
})

/** The wall of a level that a point lies on, and where along it. */
function wallAt(nodes: SceneNodes, levelId: string, point: Pt, only?: (wall: WallNode) => boolean) {
  for (const node of Object.values(nodes)) {
    if (node.type !== 'wall' || node.parentId !== levelId || node.curveOffset) continue
    if (only && !only(node)) continue
    const a = node.start as Pt
    const b = node.end as Pt
    if (distanceToSegment(point, a, b) > Math.max(0.05, (node.thickness ?? 0.1) / 2)) continue
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    const t =
      ((point[0] - a[0]) * (b[0] - a[0]) + (point[1] - a[1]) * (b[1] - a[1])) /
      (length * length || 1)
    if (t > 0 && t < 1) return { wall: node, t }
  }
  return null
}

function buildUnit(
  nodes: SceneNodes,
  unit: UnitContext,
  layout: UnitLayout,
  angle: number,
  mark: GuessedMark,
) {
  const toLevel = (p: Pt) => turn(p, angle)
  const changes: Required<Pick<SceneChanges, 'create' | 'update' | 'delete'>> = {
    create: [],
    update: [],
    delete: [],
  }
  const created: string[] = []
  const skipped: string[] = []
  const counts = new Map<string, number>()
  for (const room of layout.rooms) counts.set(room.type, (counts.get(room.type) ?? 0) + 1)
  const seen = new Map<string, number>()
  const zones = layout.rooms.map((room) => {
    const n = (seen.get(room.type) ?? 0) + 1
    seen.set(room.type, n)
    const label = `${LABEL[room.type] ?? room.type}${(counts.get(room.type) ?? 0) > 1 ? ` ${n}` : ''}`
    return marked(
      ZoneNode.parse({
        parentId: unit.levelId,
        name: `${unit.name} · ${label}`,
        polygon: rectsOutline(room.rects).map(toLevel),
        spaceRole: 'room',
        autoFromWalls: false,
      }),
      mark,
    )
  })
  const existing = Object.values(nodes).filter(
    (n): n is WallNode => n.type === 'wall' && n.parentId === unit.levelId,
  )
  const inside = (wall: WallNode) =>
    existing.some((e) => {
      const tolerance = (e.thickness ?? 0.1) / 2 + 0.02
      return (
        distanceToSegment(wall.start as Pt, e.start as Pt, e.end as Pt) <= tolerance &&
        distanceToSegment(wall.end as Pt, e.start as Pt, e.end as Pt) <= tolerance
      )
    })
  const walls = mergeSegments(layoutWalls(layout))
    .map((s, i) =>
      marked(
        WallNode.parse({
          parentId: unit.levelId,
          name: `${unit.name} · guessed wall ${i + 1}`,
          start: toLevel(s.a),
          end: toLevel(s.b),
          thickness: 0.1,
          supportSlabId: 'ground',
        }),
        mark,
      ),
    )
    .filter((wall) => !inside(wall))
  const network = walls.length
    ? planarizeWallBatch(walls, nodes as Record<string, AnyNode>, unit.levelId)
    : { walls: [], existingChanges: { create: [], update: [], delete: [] } }
  changes.create.push(...network.existingChanges.create)
  changes.update.push(...network.existingChanges.update)
  changes.delete.push(...network.existingChanges.delete)
  for (const wall of network.walls) {
    changes.create.push({
      node: marked({ ...wall, parentId: unit.levelId }, mark),
      parentId: unit.levelId,
    })
    created.push(wall.id)
  }
  for (const zone of zones) {
    changes.create.push({ node: zone, parentId: unit.levelId })
    created.push(zone.id)
  }
  let working = applySceneChanges(nodes, changes)
  const guessedWall = (wall: WallNode) =>
    (wall.metadata as { guessed?: GuessedMark } | undefined)?.guessed?.unitId === unit.unitId
  const openings = [
    ...layout.doors.map((door) => ({
      at: door.at,
      width: door.width,
      only: guessedWall,
      name: 'door',
    })),
    ...(unit.entryDoor
      ? []
      : [
          {
            at: layout.entry.at,
            width: 0.9,
            only: (wall: WallNode) => !guessedWall(wall),
            name: 'entry',
          },
        ]),
  ]
  for (const opening of openings) {
    const host = wallAt(working, unit.levelId, toLevel(opening.at), opening.only)
    if (!host) {
      skipped.push(`${opening.name}: no wall at its place`)
      continue
    }
    try {
      const placed = planWallOpening(working as Record<string, AnyNode>, {
        kind: 'door',
        wallId: host.wall.id,
        t: host.t,
        width: opening.width,
      })
      const door = marked(
        {
          ...placed.node,
          name: `${unit.name} · ${opening.name === 'entry' ? 'entry' : 'guessed door'}`,
        } as AnyNode,
        mark,
      )
      const set = { create: [{ node: door, parentId: placed.wallId }] }
      changes.create.push(...set.create)
      working = applySceneChanges(working, set)
      created.push(door.id)
    } catch (error) {
      if (!isAgentRefusal(error)) throw error
      skipped.push(`${opening.name}: ${error.code}`)
    }
  }
  const builtDoors = changes.create.filter((c) => c.node.type === 'door').length
  return {
    changes,
    created,
    report: {
      unitId: unit.unitId,
      name: unit.name,
      rooms: { asked: layout.rooms.length, built: zones.length },
      walls: { asked: mergeSegments(layoutWalls(layout)).length, built: network.walls.length },
      doors: { asked: openings.length, built: builtDoors },
      ...(skipped.length ? { skipped } : {}),
    },
    working,
  }
}

export const applyLayout: AgentOperation<ApplyInput> = (nodes, input) => {
  if (input.consent !== true)
    refuse(
      'needs_consent',
      'Apply a layout only once the person has chosen it or said yes. Show them the finalists of propose_unit_layouts and ask which one, if any.',
    )
  const prepared = prepare(nodes, input.unitIds)
  const { canonical } = prepared
  if (input.spaceKey && input.spaceKey !== canonical.key)
    refuse('unit_changed', `Unit ${canonical.name} changed since the proposal: propose again.`, {
      unitId: canonical.unitId,
    })
  const match = /^(\d+)-(\d+)$/.exec(input.layoutId)
  const brief = briefOf(input)
  const layout = match
    ? generateUnitLayouts(canonical.space, brief, {
        seed: Number(match[1]),
        count: Number(match[2]) + 1,
      }).find((l) => l.id === input.layoutId)
    : undefined
  if (!(layout && verifyUnitLayout(canonical.space, layout).ok))
    refuse(
      'layout_not_found',
      `Layout ${input.layoutId} is not one the proposal can rebuild for this unit and brief. Pass the finalist's applyWith unchanged, or propose again.`,
      { layoutId: input.layoutId },
    )
  const units: (UnitContext & { placement?: Placement })[] = [canonical, ...prepared.placed]
  const unitIds = new Set(units.map((u) => u.unitId))
  const previous = Object.values(nodes)
    .filter((n) =>
      unitIds.has((n.metadata as { guessed?: GuessedMark } | undefined)?.guessed?.unitId ?? ''),
    )
    .map((n) => n.id as string)
  if (previous.length && !input.replaceGuess)
    refuse(
      'already_guessed',
      `These units already hold a guessed layout (${previous.length} nodes). Pass replaceGuess: true to replace it: only nodes marked as guessed go, drawn ones stay.`,
      { nodes: previous.length },
    )
  const changes: Required<Pick<SceneChanges, 'create' | 'update' | 'delete'>> = {
    create: [],
    update: [],
    delete: [],
  }
  let working: SceneNodes = nodes
  if (previous.length) {
    changes.delete.push(...previous)
    working = applySceneChanges(working, { delete: previous })
  }
  const created: string[] = []
  const reports = []
  const seed = Number(match![1])
  for (const unit of units) {
    const placed = unit.placement ? placeLayout(layout, unit.placement) : layout
    const built = buildUnit(working, unit, placed, prepared.angle, {
      by: 'unit-guesser',
      layoutId: input.layoutId,
      seed,
      unitId: unit.unitId,
      brief: {
        bedrooms: input.bedrooms,
        bathrooms: input.bathrooms,
        ...(input.rooms ? { rooms: input.rooms } : {}),
      },
    })
    changes.create.push(...built.changes.create)
    changes.update.push(...built.changes.update)
    changes.delete.push(...built.changes.delete)
    created.push(...built.created)
    reports.push({
      ...built.report,
      orientation: unit.placement?.orientation ?? 'laid out',
    })
    working = built.working
  }
  if (!created.length)
    refuse(
      'nothing_built',
      'Nothing could be built from this layout: every room, wall and door was refused.',
    )
  return {
    result: {
      status: 'applied',
      guessed: true,
      units: reports,
      ...(prepared.refused.length ? { refusedUnits: prepared.refused } : {}),
      ...(previous.length ? { replaced: previous.length } : {}),
      ...createdSummary(created),
    },
    changes,
  }
}

/** What the unit guesser built (apply_unit_layout): guesses, not plans, until a person checks them. */
function guessed(nodes: SceneNodes) {
  const byType: Record<string, number> = {}
  const units = new Set<string>()
  for (const node of Object.values(nodes)) {
    const mark = node.metadata?.guessed as { unitId?: unknown } | undefined
    if (!mark) continue
    byType[node.type] = (byType[node.type] ?? 0) + 1
    if (typeof mark.unitId === 'string') units.add(mark.unitId)
  }
  const total = Object.values(byType).reduce((s, n) => s + n, 0)
  return total ? { guessed: { nodes: total, units: units.size, byType } } : {}
}

// verify_scene reports what the guesser built.
registerSceneReport({ name: 'guessed', run: guessed })
