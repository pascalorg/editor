import { refuse } from '../agent-tools/refusal'
import { type BalconyOptions, DEFAULT_BALCONY } from '../building/balcony'
import {
  planReferenceConstruction,
  ReferenceCalibrationRequired,
  referenceContours,
} from '../building/reference-construction'
import type { OutlinePrimitiveKind } from '../building/reference-primitives'
import { imagePointToLevel } from '../building/reference-transform'
import { wallGaps } from '../building/wall-gaps'
import { type AnyNode, DoorNode, WallNode } from '../schema'
import { getStoredLevelHeight } from '../services/storey'
import { planarizeWallBatch } from '../systems/wall/wall-batch'
import { applySceneChanges } from './apply-changes'
import { createdSummary } from './created-summary'
import { levelBalconies } from './level-balconies'
import { requirePlanGuide } from './plan-calibration'
import {
  type BuildingMapGroup,
  buildingMapBalconies,
  buildingMapGroups,
  isBuildingMap,
  requireWallSelection,
  unitPlacements,
} from './plan-survey'
import type { AgentOperation, SceneChanges, SceneNodes } from './types'
import { namedUnitRooms, type UnitFit } from './unit-rooms'

type CreateInput = {
  guideIds: string[]
  kind: OutlinePrimitiveKind
  shapeIds?: string[]
  thickness?: number
  height?: number
  balcony?: BalconyOptions
  outlineSteps?: 'facade' | 'balconies' | 'walls'
  into?: 'fits'
  select?: BuildingMapGroup[]
  strokeWidthsPx?: number[]
  replace?: boolean
  gaps?: 'doors'
}

const CALIBRATE_FIRST =
  'Calibrate one plan with calibrate_plan_reference on a printed or standard length (a US door leaf 36 in, a bathtub 60 in) and say what you measured, or match_plan_reference it onto a calibrated plan; ask the user only when nothing standard is visible. Then retry.'

type Pt = readonly [number, number]

function withinBody(point: Pt, wall: WallNode) {
  const [ax, az] = wall.start
  const dx = wall.end[0] - ax
  const dz = wall.end[1] - az
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared < 1e-12) return false
  const t = ((point[0] - ax) * dx + (point[1] - az) * dz) / lengthSquared
  if (t < -1e-6 || t > 1 + 1e-6) return false
  const distance = Math.hypot(point[0] - ax - t * dx, point[1] - az - t * dz)
  return distance <= (wall.thickness ?? 0.1) / 2 + 1e-6
}

// A unit plan draws the unit's outer wall a few centimetres off the envelope's centreline, inside
// the envelope wall: built again, it doubles that wall and the envelope stops reading as a loop.
const insideExisting = (wall: WallNode, existing: readonly WallNode[]) =>
  existing.some(
    (other) =>
      Math.abs(other.curveOffset ?? 0) < 1e-6 &&
      withinBody(wall.start, other) &&
      withinBody(wall.end, other),
  )

type BalconyStep = { guideId: string; shapeId: string; corners: [number, number][] }

/**
 * A building map's outline steps out and back for each balcony; traced as drawn, the walls ran
 * around every balcony (Victor run 4). The floor plate and walls take the outline without its
 * steps. By default the step stays for the facade: a balcony-stack unit on the wall behind it
 * (Victor run 5: the user builds balconies through the facade unit); `balconies` builds each step
 * as a plain balcony (a contour of its own).
 */
function withoutBalconySteps(nodes: SceneNodes, input: CreateInput) {
  const steps: BalconyStep[] = []
  if (input.outlineSteps === 'walls' || (input.kind !== 'walls' && input.kind !== 'slab'))
    return { nodes, steps }
  const next: Record<string, AnyNode> = { ...nodes }
  for (const guideId of input.guideIds) {
    const guide = nodes[guideId]
    if (guide?.type !== 'guide') continue
    const map = buildingMapBalconies(guide)
    if (!map || (input.shapeIds && !input.shapeIds.includes(map.outlineId))) continue
    const shapeIds = map.balconies.map((_, index) => `${map.outlineId}~balcony-${index + 1}`)
    const contours = referenceContours(guide).map((contour) =>
      contour.id === map.outlineId
        ? { ...contour, points: input.kind === 'slab' ? map.plate : map.outline }
        : contour,
    )
    const built =
      input.kind === 'walls' && input.outlineSteps === 'balconies'
        ? map.balconies.map((points, index) => ({ id: shapeIds[index]!, points }))
        : []
    next[guideId] = {
      ...guide,
      metadata: { ...guide.metadata, referenceContours: [...contours, ...built] },
    }
    if (input.kind === 'walls')
      map.balconies.forEach((corners, index) => {
        steps.push({ guideId, shapeId: shapeIds[index]!, corners })
      })
  }
  return { nodes: next, steps }
}

/**
 * Zones hold no holes, and an apartment or lobby drawn around a core has the core as one: the
 * construction refused it (Victor run 5). A zone takes the outer outline; the result counts them.
 */
function withoutZoneHoles(nodes: SceneNodes, input: CreateInput) {
  if (input.kind !== 'zone' && input.kind !== 'unit') return { nodes, holesIgnored: 0 }
  const next: Record<string, AnyNode> = { ...nodes }
  let holesIgnored = 0
  for (const guideId of input.guideIds) {
    const guide = nodes[guideId]
    if (guide?.type !== 'guide') continue
    const contours = referenceContours(guide).map((contour) => {
      if (!contour.holes?.length || (input.shapeIds && !input.shapeIds.includes(contour.id)))
        return contour
      holesIgnored += contour.holes.length
      const { holes: _holes, ...outer } = contour
      return outer
    })
    next[guideId] = { ...guide, metadata: { ...guide.metadata, referenceContours: contours } }
  }
  return { nodes: next as SceneNodes, holesIgnored }
}

const onSegment = (p: readonly number[], a: Pt, b: Pt, tolerance = 0.05) => {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const t = ((p[0]! - a[0]) * dx + (p[1]! - a[1]) * dz) / (dx * dx + dz * dz || 1)
  return (
    t > -0.01 && t < 1.01 && Math.hypot(p[0]! - a[0] - t * dx, p[1]! - a[1] - t * dz) < tolerance
  )
}

/**
 * The open sides of every balcony stepping out of a building map's outline on a level: its two
 * sides and its outer edge, where the railing goes. An apartment's outline takes its balcony in;
 * built as walls, every Victor balcony was walled in on these three sides (run 9b).
 */
const balconyEdges = (nodes: SceneNodes, levelId: string): [Pt, Pt][] =>
  levelBalconies(nodes, levelId).balconies.flatMap(({ corners: [a, b, c, d], projecting }) =>
    projecting
      ? [
          [a!, b!],
          [b!, c!],
          [c!, d!],
        ]
      : [],
  )

/** How far `p` lies inside the convex quad `corners` (negative outside), in metres. */
const insideBy = (p: readonly number[], corners: readonly Pt[]) => {
  const turn = Math.sign(
    corners.reduce((sum, [x, z], i) => {
      const [nx, nz] = corners[(i + 1) % corners.length]!
      return sum + x * nz - nx * z
    }, 0),
  )
  return Math.min(
    ...corners.map(([x, z], i) => {
      const [nx, nz] = corners[(i + 1) % corners.length]!
      const length = Math.hypot(nx - x, nz - z) || 1
      return (turn * ((nx - x) * (p[1]! - z) - (nz - z) * (p[0]! - x))) / length
    }),
  )
}

/**
 * A wall kept out of every projecting balcony: two apartments sharing one balcony step drew their
 * party wall on into it, and every Victor run stood it storey-high in the south double balcony
 * (2026-10-03). A piece within the step goes; a wall crossing the facade line stops on it. The
 * facade wall itself runs on that line, not within the step. `null`: nothing of it is kept.
 */
const outOfBalconies = (nodes: SceneNodes, levelId: string) => {
  const steps = levelBalconies(nodes, levelId).balconies.flatMap(({ corners, projecting }) =>
    projecting ? [corners] : [],
  )
  return (wall: WallNode): WallNode | null => {
    let kept = wall
    for (const corners of steps) {
      const a = corners[0]!
      const b = corners[1]!
      const d = corners[3]!
      const length = Math.hypot(d[0] - a[0], d[1] - a[1]) || 1
      const across = (p: readonly number[]) =>
        ((d[0] - a[0]) * (p[1]! - a[1]) - (d[1] - a[1]) * (p[0]! - a[0])) / length
      // Metres past the facade line, towards the balcony's outer edge.
      const past = (p: readonly number[]) => across(p) * Math.sign(across(b))
      const pastStart = past(kept.start)
      const pastEnd = past(kept.end)
      if (Math.max(pastStart, pastEnd) <= 0.05) continue
      const within = (p: readonly number[]) => insideBy(p, corners) > -0.15
      if (pastStart > -0.05 && pastEnd > -0.05) {
        if (within(kept.start) && within(kept.end)) return null
        continue
      }
      const outer = pastStart > pastEnd ? kept.start : kept.end
      if (!within(outer)) continue
      const t = pastStart / (pastStart - pastEnd)
      const cut: [number, number] = [
        kept.start[0] + (kept.end[0] - kept.start[0]) * t,
        kept.start[1] + (kept.end[1] - kept.start[1]) * t,
      ]
      kept = outer === kept.start ? { ...kept, start: cut } : { ...kept, end: cut }
    }
    return kept
  }
}

/** Balconies closer than this along one facade line are a row, clad as one stretch. */
const ROW_GAP = 3

/**
 * The gaps between neighbouring balconies on one facade line (a and d of each, sorted along it):
 * a row of balconies stands in a stretch clad like the stack, and the walls between them took the
 * brick body unit instead (Victor run 9c).
 */
function rowGaps(lines: readonly [Pt, Pt][]): [Pt, Pt][] {
  const gaps: [Pt, Pt][] = []
  const grouped = new Set<number>()
  lines.forEach(([a, d], index) => {
    if (grouped.has(index)) return
    const length = Math.hypot(d[0] - a[0], d[1] - a[1]) || 1
    const axis: Pt = [(d[0] - a[0]) / length, (d[1] - a[1]) / length]
    const along = (p: Pt) => (p[0] - a[0]) * axis[0] + (p[1] - a[1]) * axis[1]
    const off = (p: Pt) => Math.abs(-(p[0] - a[0]) * axis[1] + (p[1] - a[1]) * axis[0])
    const row = lines
      .map((line, other) => ({ line, other }))
      .filter(({ line }) => off(line[0]) < 0.05 && off(line[1]) < 0.05)
      .map(({ line, other }) => {
        grouped.add(other)
        const [s, e] = [along(line[0]), along(line[1])]
        return { from: Math.min(s, e), to: Math.max(s, e) }
      })
      .sort((x, y) => x.from - y.from)
    const at = (t: number): Pt => [a[0] + axis[0] * t, a[1] + axis[1] * t]
    for (let k = 1; k < row.length; k++) {
      const gap = row[k]!.from - row[k - 1]!.to
      if (gap > 0.05 && gap < ROW_GAP) gaps.push([at(row[k - 1]!.to), at(row[k]!.from)])
    }
  })
  return gaps
}

/**
 * A unit plan into every apartment the survey fits it to, on every floor: its contours, mirrored
 * or turned the way the apartment lies, are drawn onto each floor's map and built as the map's
 * own. The apartment gives the scale; the unit plan's calibration is not needed.
 */
function intoFits(nodes: SceneNodes, input: CreateInput) {
  const next: Record<string, AnyNode> = { ...nodes }
  const shapeIdsByFloor = new Map<string, string[]>()
  const fitted: UnitFit[] = []
  let apartments = 0
  for (const unitId of input.guideIds) {
    const { guide: unit } = requirePlanGuide(nodes, unitId)
    if (isBuildingMap(unit))
      refuse(
        'not_a_unit_plan',
        `${unit.name ?? unit.id} is a building map. into: 'fits' places a unit plan into the apartments of building maps.`,
        { guideId: unit.id },
      )
    const contours = referenceContours(unit).filter(
      (contour) => !input.shapeIds || input.shapeIds.includes(contour.id),
    )
    const placements = unitPlacements(nodes, unit)
    if (!placements.length)
      refuse(
        'no_fits',
        `No apartment of a building map fits ${unit.name ?? unit.id}: survey_plan_references lists where each unit plan fits.`,
        { guideId: unit.id },
      )
    for (const placement of placements) {
      fitted.push({
        unit,
        floorGuideId: placement.floorGuide.id,
        apartmentId: placement.apartmentId,
        toMap: placement.toMap,
      })
      const floor = next[placement.floorGuide.id] as typeof placement.floorGuide
      const placed = contours.map((contour) => ({
        ...contour,
        id: `${unit.id}@${placement.apartmentId}/${contour.id}`,
        points: contour.points.map(placement.toMap),
        ...(contour.holes ? { holes: contour.holes.map((hole) => hole.map(placement.toMap)) } : {}),
      }))
      next[floor.id] = {
        ...floor,
        metadata: {
          ...floor.metadata,
          referenceContours: [...referenceContours(floor), ...placed],
        },
      }
      shapeIdsByFloor.set(floor.id, [
        ...(shapeIdsByFloor.get(floor.id) ?? []),
        ...placed.map((contour) => contour.id),
      ])
      apartments++
    }
  }
  const jobs = [...shapeIdsByFloor].map(([guideId, shapeIds]) => ({
    ...input,
    guideIds: [guideId],
    shapeIds,
  }))
  return { nodes: next as SceneNodes, jobs, apartments, fitted }
}

const DEFAULT_SITE: readonly Pt[] = [
  [-15, -15],
  [15, -15],
  [15, 15],
  [-15, 15],
]
/** Ground kept around a building when the site grows to it. */
const SITE_MARGIN = 3

function insidePolygon([x, z]: Pt, polygon: readonly Pt[]) {
  let hit = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i]!
    const [xj, zj] = polygon[j]!
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit
  }
  return hit
}

function footprint(node: AnyNode): Pt[] {
  if (node.type === 'wall' || node.type === 'fence') return [node.start, node.end]
  if (node.type === 'slab' || node.type === 'zone') return node.polygon as Pt[]
  return []
}

/**
 * Plans are drawn to scale, sites by default are a 30 × 30 m square: the Victor ran past it on
 * every run and every check said so. An untouched site grows to the building with some ground
 * around it; a site the user drew is theirs, and the build only says the building runs past it.
 */
function siteForBuild(nodes: SceneNodes, built: AnyNode[]) {
  const site = Object.values(nodes).find((node) => node.type === 'site')
  const points = built.flatMap(footprint)
  if (site?.type !== 'site' || !points.length) return null
  const polygon = site.polygon.points as Pt[]
  if (points.every((point) => insidePolygon(point, polygon))) return null
  const untouched =
    polygon.length === DEFAULT_SITE.length &&
    polygon.every(
      (point, index) =>
        point[0] === DEFAULT_SITE[index]![0] && point[1] === DEFAULT_SITE[index]![1],
    )
  if (!untouched) return { counts: { outsideSite: true } }
  const round = (value: number) => Math.round(value * 100) / 100
  const xs = points.map((point) => point[0])
  const zs = points.map((point) => point[1])
  const x0 = round(Math.min(Math.min(...xs) - SITE_MARGIN, ...polygon.map((point) => point[0])))
  const x1 = round(Math.max(Math.max(...xs) + SITE_MARGIN, ...polygon.map((point) => point[0])))
  const z0 = round(Math.min(Math.min(...zs) - SITE_MARGIN, ...polygon.map((point) => point[1])))
  const z1 = round(Math.max(Math.max(...zs) + SITE_MARGIN, ...polygon.map((point) => point[1])))
  const grown: [number, number][] = [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ]
  const data = { polygon: { type: 'polygon', points: grown } } as Partial<AnyNode>
  return { counts: { siteGrown: true }, update: { id: site.id, data } }
}

/**
 * The survey's groups (outline, apartments, cores) resolved on each building map, and the line
 * groups of a stroke width on each plan: every floor's shape ids differ, so one call per floor,
 * and the model never copies ids (Victor runs 5 and 6 left every apartment without walls; a
 * traced raster's groups run past the ids an import lists).
 */
function selectionJobs(nodes: SceneNodes, input: CreateInput) {
  const selected: Partial<Record<BuildingMapGroup, number>> = {}
  if (!input.select?.length && !input.strokeWidthsPx?.length) return { jobs: [input], selected }
  const widths = new Set((input.strokeWidthsPx ?? []).map((width) => Math.round(width * 100) / 100))
  const jobs = input.guideIds.map((guideId) => {
    const { guide } = requirePlanGuide(nodes, guideId)
    const shapeIds = new Set(input.shapeIds ?? [])
    if (input.select?.length) {
      const groups = buildingMapGroups(guide)
      if (!groups)
        refuse(
          'not_a_building_map',
          `${guide.name ?? guide.id} is not a building map: select reads a building map's outline, apartments and cores. Pass shapeIds or strokeWidthsPx for other plans.`,
          { guideId },
        )
      for (const group of input.select) {
        for (const id of groups[group]) shapeIds.add(id)
        selected[group] = (selected[group] ?? 0) + groups[group].length
      }
    }
    const contours = (guide.metadata.referenceContours ?? []) as {
      id: string
      stroke?: boolean
      strokeWidth?: number
    }[]
    for (const contour of contours)
      if (contour.stroke && widths.has(Math.round((contour.strokeWidth ?? 1) * 100) / 100))
        shapeIds.add(contour.id)
    if (!shapeIds.size)
      refuse(
        'no_lines_of_width',
        `${guide.name ?? guide.id} has no lines ${[...widths].join(' or ')} px wide: its line groups are ${[
          ...new Set(
            contours
              .filter((contour) => contour.stroke)
              .map((contour) => Math.round((contour.strokeWidth ?? 1) * 100) / 100),
          ),
        ].join(', ')} px.`,
        { guideId },
      )
    return { ...input, guideIds: [guideId], shapeIds: [...shapeIds] }
  })
  return { jobs, selected }
}

type Construction = Omit<Parameters<typeof planReferenceConstruction>[0], 'nodes'>

type StoreyRaise = { levelId: string; from: number; to: number }

/**
 * Walls asked taller than their storey raise it: construction clamps a wall to its storey, and
 * Victor run 8's 3 m walls stood 2.5 m high without a word, too low for any window of its facade.
 */
function raiseStoreys(nodes: SceneNodes, guideIds: readonly string[], height: number) {
  const raised: StoreyRaise[] = []
  let next = nodes
  for (const levelId of new Set(guideIds.map((id) => nodes[id]?.parentId))) {
    const level = levelId ? next[levelId] : undefined
    if (level?.type !== 'level') continue
    const from = getStoredLevelHeight(level)
    if (height <= from + 1e-6) continue
    next = { ...next, [level.id]: { ...level, height } }
    raised.push({ levelId: level.id, from, to: height })
  }
  return { nodes: next, raised }
}

/** The plan workspace's construction, its failures as refusals the model can act on. */
function construct(args: Construction, nodes: SceneNodes): AnyNode[] {
  try {
    return planReferenceConstruction({ ...args, nodes: nodes as Record<string, AnyNode> })
  } catch (error) {
    if (error instanceof ReferenceCalibrationRequired)
      refuse('not_calibrated', error.message, {
        status: 'human_action_required',
        action: 'calibrate_reference',
        guideIds: error.guideIds,
        retryAfter: CALIBRATE_FIRST,
      })
    refuse('construction_failed', error instanceof Error ? error.message : String(error))
  }
}

type OutlineRef = { guideId?: string; outlineId?: string; outlineIds?: string[] }

const isBalconyPart = (node: AnyNode) => !!node.metadata?.balcony

function ofKind(node: AnyNode, input: CreateInput) {
  switch (input.kind) {
    case 'walls':
      return node.type === 'wall' || (input.outlineSteps === 'balconies' && isBalconyPart(node))
    case 'slab':
      return node.type === 'slab' && !isBalconyPart(node)
    case 'balcony':
      return isBalconyPart(node)
    case 'unit':
      return node.type === 'unit' || node.type === 'zone'
    case 'zone':
      return node.type === 'zone'
    case 'door':
    case 'window':
      return node.type === input.kind
    default:
      return false
  }
}

/** What these plan shapes built before, of the kind asked: split pieces keep their plan link. */
function builtBefore(nodes: SceneNodes, input: CreateInput): AnyNode[] {
  const jobs = input.into === 'fits' ? [input] : selectionJobs(nodes, input).jobs
  const shapes = new Map<string, Set<string> | null>()
  for (const job of jobs)
    for (const guideId of job.guideIds)
      shapes.set(guideId, job.shapeIds ? new Set(job.shapeIds) : null)
  return Object.values(nodes).filter((node) => {
    const ref = node.metadata?.referenceOutline as OutlineRef | undefined
    if (!(ref?.guideId && shapes.has(ref.guideId))) return false
    const wanted = shapes.get(ref.guideId)
    const ids = ref.outlineIds ?? (ref.outlineId ? [ref.outlineId] : [])
    return (!wanted || ids.some((id) => wanted.has(id))) && ofKind(node, input)
  })
}

/** Every node that goes with these, by type: a wall takes its openings and facade pieces. */
function countWithDescendants(nodes: SceneNodes, roots: readonly AnyNode[]) {
  const counts: Record<string, number> = {}
  const seen = new Set<string>()
  const visit = (id: string) => {
    const node = nodes[id]
    if (!node || seen.has(id)) return
    seen.add(id)
    counts[node.type] = (counts[node.type] ?? 0) + 1
    for (const child of ('children' in node && Array.isArray(node.children)
      ? node.children
      : []) as string[])
      visit(child)
  }
  for (const root of roots) visit(root.id)
  return counts
}

/**
 * `create_reference_elements`: the plan workspace's construction. Walls join the floor's walls as
 * the workspace joins them — ends snap, the walls they meet are split, openings stay on their piece.
 *
 * With `replace`, what the same plan shapes built before goes first — only that, never what was
 * drawn by hand — so a wrong reading can be rebuilt (balconies built as walls, the user: the model
 * then put the facade on them and never settled). Without it, the result says they are there.
 */
export const createReferenceElements: AgentOperation<CreateInput> = (nodes, input, context) => {
  const previous = builtBefore(nodes, input)
  if (!previous.length) return buildReferenceElements(nodes, input)
  if (!input.replace) {
    const outcome = buildReferenceElements(nodes, input)
    return {
      ...outcome,
      result: {
        ...outcome.result,
        alreadyBuilt: previous.length,
        hint: `These plan shapes were built before (${previous.length} nodes of this kind). To rebuild them from the plan, pass replace: true: it removes only what these shapes built, with the openings and facade pieces on it.`,
      },
    }
  }
  const removed = previous.map((node) => node.id)
  const base = applySceneChanges(nodes, { delete: removed })
  const outcome = createReferenceElements(base, { ...input, replace: undefined }, context)
  const replaced = countWithDescendants(nodes, previous)
  return {
    result: {
      ...outcome.result,
      ...(outcome.changes ? {} : { status: 'replaced' }),
      replaced,
    },
    changes: {
      create: outcome.changes?.create ?? [],
      update: outcome.changes?.update ?? [],
      delete: [...removed, ...(outcome.changes?.delete ?? [])],
    },
  }
}

function buildReferenceElements(nodes: SceneNodes, input: CreateInput) {
  requireWallSelection(nodes, input)
  const fits = input.into === 'fits' ? intoFits(nodes, input) : null
  const selection = fits ? { jobs: fits.jobs, selected: {} } : selectionJobs(nodes, input)
  const prepared = { nodes: fits?.nodes ?? nodes, steps: [] as BalconyStep[] }
  const storeys =
    input.kind === 'walls' && input.height !== undefined
      ? raiseStoreys(
          prepared.nodes,
          selection.jobs.flatMap((job) => job.guideIds),
          input.height,
        )
      : { nodes: prepared.nodes, raised: [] }
  prepared.nodes = storeys.nodes
  let holesIgnored = 0
  for (const job of selection.jobs) {
    if (!fits) {
      const stepped = withoutBalconySteps(prepared.nodes, job)
      prepared.nodes = stepped.nodes
      prepared.steps.push(...stepped.steps)
    }
    const zoned = withoutZoneHoles(prepared.nodes, job)
    prepared.nodes = zoned.nodes
    holesIgnored += zoned.holesIgnored
  }
  const built = selection.jobs.flatMap((job) => construct(job, prepared.nodes))

  const changes: Required<Pick<SceneChanges, 'create' | 'update' | 'delete'>> = {
    create: [],
    update: [],
    delete: [],
  }
  const createdIds: string[] = []
  const add = (node: AnyNode) => {
    changes.create.push({ node, parentId: node.parentId ?? undefined })
    createdIds.push(node.id)
  }
  if (input.kind !== 'walls') built.forEach(add)
  let insideExistingWalls = 0
  let splitWalls = 0
  let balconyEdgesSkipped = 0
  const doorsInGaps: { levelId: string; at: Pt; width: number }[] = []
  const openGaps: {
    levelId: string
    place: 'inside' | 'outside'
    wallId: string
    at: Pt
    width: number
    t: number
  }[] = []
  // The plans' drawing on a floor, in its coordinates: a door's swing shows a gap is a door.
  const drawingOn = (levelId: string) =>
    [...new Set(selection.jobs.flatMap((job) => job.guideIds))].flatMap((guideId) => {
      const { guide, view } = requirePlanGuide(prepared.nodes, guideId)
      if (guide.parentId !== levelId) return []
      return referenceContours(guide).map((contour) =>
        contour.points.map((point) => imagePointToLevel(point, view.image, view.transform)),
      )
    })
  if (input.kind === 'walls') {
    const byLevel = new Map<string, WallNode[]>()
    for (const node of built) {
      if (node.type !== 'wall' || !node.parentId) {
        add(node)
        continue
      }
      byLevel.set(node.parentId, [...(byLevel.get(node.parentId) ?? []), node])
    }
    for (const [levelId, walls] of byLevel) {
      const existing = Object.values(nodes).filter(
        (node): node is WallNode => node.type === 'wall' && node.parentId === levelId,
      )
      const kept = walls.filter((wall) => !insideExisting(wall, existing))
      insideExistingWalls += walls.length - kept.length
      if (!kept.length) continue
      // A gap the plan leaves at an opening: a wall across it, built with the plan's walls so it
      // joins them; inside, a door in it once they are joined.
      const gaps =
        input.gaps === 'doors'
          ? wallGaps([...existing, ...kept], {
              only: new Set(kept.map((wall) => wall.id)),
              drawing: drawingOn(levelId),
            })
          : []
      const bridges = gaps.map((gap) =>
        WallNode.parse({
          parentId: levelId,
          name: gap.door ? 'Door gap' : 'Opening gap',
          start: gap.start,
          end: gap.end,
          thickness: gap.thickness,
          ...(gap.height !== undefined ? { height: gap.height } : {}),
          metadata: kept.find((wall) => wall.id === gap.from)?.metadata ?? {},
        }),
      )
      const network = planarizeWallBatch(
        [...kept, ...bridges],
        prepared.nodes as Record<string, AnyNode>,
        levelId,
      )
      splitWalls += network.existingChanges.delete.length
      changes.create.push(...network.existingChanges.create)
      changes.update.push(...network.existingChanges.update)
      changes.delete.push(...network.existingChanges.delete)
      const added: WallNode[] = []
      const railings = input.outlineSteps === 'walls' ? [] : balconyEdges(nodes, levelId)
      const keep =
        input.outlineSteps === 'walls' ? (wall: WallNode) => wall : outOfBalconies(nodes, levelId)
      for (const built of network.walls) {
        const wall = keep(built)
        if (wall !== built) balconyEdgesSkipped++
        if (!wall) continue
        if (
          railings.some(
            ([from, to]) =>
              onSegment(wall.start, from, to, 0.15) && onSegment(wall.end, from, to, 0.15),
          )
        ) {
          balconyEdgesSkipped++
          continue
        }
        add({ ...wall, parentId: levelId })
        added.push(wall)
      }
      for (const gap of gaps) {
        const length = Math.hypot(gap.end[0] - gap.start[0], gap.end[1] - gap.start[1])
        const centre: Pt = [
          gap.start[0] + ((gap.end[0] - gap.start[0]) * gap.along) / length,
          gap.start[1] + ((gap.end[1] - gap.start[1]) * gap.along) / length,
        ]
        const host = added.find((wall) => onSegment(centre, wall.start, wall.end, 0.02))
        if (!host) continue
        const along = Math.hypot(centre[0] - host.start[0], centre[1] - host.start[1])
        const round = (value: number) => Math.round(value * 100) / 100
        const at: Pt = [round(centre[0]), round(centre[1])]
        if (!gap.door) {
          const hostLength = Math.hypot(host.end[0] - host.start[0], host.end[1] - host.start[1])
          openGaps.push({
            levelId,
            place: gap.place,
            wallId: host.id,
            at,
            width: gap.width,
            t: round(along / hostLength),
          })
          continue
        }
        add(
          DoorNode.parse({
            parentId: host.id,
            wallId: host.id,
            position: [along, 1.05, 0],
            width: gap.width,
          }),
        )
        doorsInGaps.push({ levelId, at, width: gap.width })
      }
    }
  }

  // Each balcony step: built against the walls just built, so its railings take only the open
  // sides, or named with the wall behind it for the balcony-stack facade unit.
  let balconies = 0
  const balconyWalls: Record<string, unknown>[] = []
  const balconyStretches: { levelId: string | null; wallIds: string[] }[] = []
  if (prepared.steps.length) {
    const walled = applySceneChanges(prepared.nodes, changes)
    const builtWalls = changes.create.flatMap(({ node }) => (node.type === 'wall' ? [node] : []))
    const balcony = input.balcony ?? DEFAULT_BALCONY
    const round = (value: number) => Math.round(value * 100) / 100
    for (const guideId of new Set(prepared.steps.map((step) => step.guideId))) {
      const own = prepared.steps.filter((step) => step.guideId === guideId)
      if (input.outlineSteps === 'balconies') {
        const shapeIds = own.map((step) => step.shapeId)
        const parts = construct({ guideIds: [guideId], kind: 'balcony', shapeIds, balcony }, walled)
        balconies += parts.filter((node) => node.type === 'slab').length
        parts.forEach(add)
        continue
      }
      const { guide, view } = requirePlanGuide(prepared.nodes, guideId)
      // Every floor shares one plan frame: a floor's balconies are behind its own walls only.
      const floorWalls = builtWalls.filter((wall) => wall.parentId === guide.parentId)
      const backs = own.map((step) => {
        const [a, , , d] = step.corners.map((point) =>
          imagePointToLevel(point, view.image, view.transform),
        ) as Pt[]
        return [a!, d!] as [Pt, Pt]
      })
      for (const [from, to] of rowGaps(backs)) {
        const wallIds = floorWalls
          .filter((wall) => onSegment(wall.start, from, to) && onSegment(wall.end, from, to))
          .map((wall) => wall.id)
        if (wallIds.length) balconyStretches.push({ levelId: guide.parentId, wallIds })
      }
      for (const step of own) {
        const [a, b, , d] = step.corners.map((point) =>
          imagePointToLevel(point, view.image, view.transform),
        ) as Pt[]
        balconyWalls.push({
          levelId: guide.parentId,
          wallIds: floorWalls
            .filter((wall) => onSegment(wall.start, a!, d!) && onSegment(wall.end, a!, d!))
            .map((wall) => wall.id),
          width: round(Math.hypot(d![0] - a![0], d![1] - a![1])),
          depth: round(Math.hypot(b![0] - a![0], b![1] - a![1])),
        })
      }
    }
  }

  // The rooms the unit plan names, as zones in each apartment it went into.
  let rooms = 0
  if (fits && input.kind === 'walls') {
    const walled = applySceneChanges(prepared.nodes, changes)
    for (const zone of namedUnitRooms(walled, fits.fitted)) {
      add(zone)
      rooms++
    }
  }

  const site = siteForBuild(
    nodes,
    changes.create.map(({ node }) => node),
  )
  if (site?.update) changes.update.push(site.update)
  for (const { levelId, to } of storeys.raised)
    changes.update.push({ id: levelId, data: { height: to } })
  const counts = {
    ...(input.kind === 'walls' ? { insideExistingWalls, splitWalls, balconies } : {}),
    ...(input.gaps === 'doors' ? { doorsInGaps, openGaps } : {}),
    ...(balconyWalls.length ? { balconyWalls } : {}),
    ...(balconyStretches.length ? { balconyStretches } : {}),
    ...(balconyEdgesSkipped ? { balconyEdgesSkipped } : {}),
    ...(holesIgnored ? { holesIgnored } : {}),
    ...(input.select?.length ? { selected: selection.selected } : {}),
    ...(fits ? { apartments: fits.apartments, ...(rooms ? { rooms } : {}) } : {}),
    ...site?.counts,
  }
  if (!createdIds.length) return { result: { status: 'already_present', createdIds, ...counts } }
  const storeysRaised = storeys.raised.length ? { storeysRaised: storeys.raised } : {}
  return {
    result: { status: 'created', ...createdSummary(createdIds), ...counts, ...storeysRaised },
    changes,
  }
}
