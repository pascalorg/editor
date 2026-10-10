import { refuse } from '../agent-tools/refusal'
import { type FacadeFillPlan, facadeWallRefusal } from '../building/facade'
import { facadeUnitPreviewId } from '../building/facade-preview'
import type { FacadeWallTarget } from '../building/facade-runs'
import {
  describePastCorner,
  type FacadePastCorner,
  type FacadeScope,
  facadeLoopTargets,
  facadeScopeTargets,
} from '../building/facade-scope'
import { exteriorWallLoops, freeWallEnds } from '../lib/exterior-wall-loops'
import type { AnyNode, AnyNodeId, WallNode } from '../schema'
import { type FacadeUnit, FacadeUnitSchema } from '../systems/facade/facade-unit'
import { levelBalconies } from './level-balconies'
import type { SceneNodes } from './types'

/**
 * The targets one apply_facade call fills: a floor each with levelIds, a wall each with wallIds,
 * else the one wall. A pass over the Victor made 68 calls of one small wall each, every one a draft
 * save (2026-10-03).
 */
export function facadeRequests({
  wallId,
  wallIds,
  levelIds,
  scope,
  joinTolerance,
  paintOnly,
}: {
  wallId?: string
  wallIds?: readonly string[]
  levelIds?: readonly string[]
  scope: FacadeTargetInput['scope']
  joinTolerance?: number
  paintOnly?: boolean
}): FacadeTargetInput[] {
  const shared = { scope, joinTolerance, paintOnly }
  if (levelIds?.length) return levelIds.map((levelId) => ({ levelId, ...shared }))
  if (wallIds?.length) return wallIds.map((id) => ({ wallId: id, ...shared }))
  return [{ wallId, ...shared }]
}

export type FacadeTargetInput = {
  wallId?: string
  levelId?: string
  scope: FacadeScope | 'balconies'
  /** Metres within which wall ends are one corner of the loop: a millimetre by default. */
  joinTolerance?: number
  /** The unit only paints (`isPaintOnlyUnit`), so arcs are filled too. */
  paintOnly?: boolean
}

type Pt = readonly [number, number]

const onSegment = (p: readonly number[], a: Pt, b: Pt) => {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const t = ((p[0]! - a[0]) * dx + (p[1]! - a[1]) * dz) / (dx * dx + dz * dz || 1)
  return t > -0.01 && t < 1.01 && Math.hypot(p[0]! - a[0] - t * dx, p[1]! - a[1] - t * dz) < 0.05
}

const shoelace = (points: readonly Pt[]) =>
  Math.abs(
    points.reduce((sum, [x, z], i) => {
      const [nx, nz] = points[(i + 1) % points.length]!
      return sum + x * nz - nx * z
    }, 0),
  ) / 2

/** The walls behind the balcony steps a floor's building map draws, as they stand now. */
function balconyWalls(nodes: SceneNodes, levelId: string, walls: readonly WallNode[]) {
  const found = new Set<WallNode>()
  for (const { corners } of levelBalconies(nodes, levelId).balconies) {
    const a = corners[0]!
    const d = corners[3]!
    for (const wall of walls)
      if (onSegment(wall.start, a, d) && onSegment(wall.end, a, d)) found.add(wall)
  }
  return [...found]
}

/**
 * The walls a facade goes on, by wall or by floor. By floor, no wall id is needed: `exterior` is the
 * floor's outer loop (the largest), `balconies` the walls behind its plan's balcony steps, found
 * where they are now. Victor run 7 picked its walls by a thickness the program's wall list lacks,
 * and no floor got its facade; a balcony wall id it held had since been split by the party walls.
 */
export function facadeTargetsFor(
  nodes: SceneNodes,
  { wallId, levelId, scope, joinTolerance, paintOnly = false }: FacadeTargetInput,
): {
  walls: WallNode[]
  targets: Record<string, FacadeWallTarget>
  /** Loop walls that run past a corner of the loop, left out: they would get openings outside it. */
  leftOut?: FacadePastCorner[]
  /** Arcs of the loop, left out: a facade goes on straight walls only. */
  curved?: WallNode['id'][]
} {
  const all = nodes as Record<AnyNodeId, AnyNode>
  if (wallId) {
    const wall = nodes[wallId]
    if (!wall)
      refuse(
        'wall_not_found',
        `Wall not found: ${wallId}. Walls are split where others join them: ask for a floor's facade with levelId instead.`,
        { wallId },
      )
    if (wall.type !== 'wall')
      refuse('not_a_wall', `Node ${wallId} is a ${wall.type}, expected wall.`, { wallId })
    if (scope === 'balconies')
      refuse('balconies_need_level', 'scope balconies works on a floor: pass levelId.', { wallId })
    if (scope === 'wall') return fillable(all, { walls: [wall], targets: {} }, paintOnly)
    return fillable(all, facadeScopeTargets(all, wall, scope, joinTolerance, paintOnly), paintOnly)
  }
  if (!levelId)
    refuse(
      'wall_or_level_required',
      "Give wallId, or levelId for a whole floor's exterior loop or its balcony walls.",
    )
  const level = nodes[levelId]
  if (level?.type !== 'level')
    refuse('level_not_found', `Level not found: ${levelId}.`, { levelId })
  const walls = Object.values(nodes).filter(
    (node): node is WallNode =>
      node.type === 'wall' && node.parentId === levelId && node.visible !== false,
  )
  const name = level.name ?? level.id
  if (scope === 'balconies') {
    const found = balconyWalls(nodes, levelId, walls)
    if (!found.length)
      refuse(
        'no_balconies',
        `${name} has no balcony steps on its building map, or no walls behind them.`,
        { levelId },
      )
    return fillable(all, { walls: found, targets: {} }, paintOnly)
  }
  if (scope === 'wall')
    refuse('wall_scope_needs_wall', 'scope wall fills one wall: pass wallId.', { levelId })
  const loops = exteriorWallLoops(walls, joinTolerance)
  if (!loops.length) {
    const open = freeWallEnds(walls, joinTolerance)
    const listed = open
      .slice(0, 8)
      .map(
        ({ wallId, point, nearest }) =>
          `${wallId} at (${metres(point[0])}, ${metres(point[1])})${nearest ? `, ${metres(nearest.distance)} from ${nearest.wallId}` : ''}`,
      )
    refuse(
      'no_exterior_loop',
      `${name} has no closed loop of exterior walls yet.${listed.length ? ` Wall ends that join nothing: ${listed.join('; ')}${open.length > listed.length ? '; …' : ''}. Close each to the end nearest to it, or pass joinTolerance (metres) to join ends that close: 0.05 joins a vectorised plan's near-miss corners, a wider real gap stays open.` : ''}`,
      { levelId, freeEnds: open.slice(0, 20) },
    )
  }
  const largest = loops.reduce((best, loop) =>
    shoelace(loop.flatMap((face) => face.points as Pt[])) >
    shoelace(best.flatMap((face) => face.points as Pt[]))
      ? loop
      : best,
  )
  const seed = nodes[largest[0]!.wallId] as WallNode
  // A plan from a vectoriser runs walls past the loop's corners everywhere (2026-10-03, a G.J.
  // Gardner house over the MCP): the rest of the loop is filled and those walls are named.
  const {
    walls: fits,
    targets,
    pastCorner,
    curved,
  } = facadeLoopTargets(all, seed, scope, joinTolerance, paintOnly)
  if (!fits.length && !pastCorner.length)
    refuse(
      'wall_curved',
      `Every wall of ${name}'s outside loop is curved: a facade goes on straight walls only.`,
      { levelId, walls: curved },
    )
  if (!fits.length)
    refuse(
      'wall_past_loop_corner',
      `Every wall of ${name}'s outside loop runs past a corner of it: split each at the junction, then apply again. ${describePastCorner(pastCorner)}.`,
      { levelId, walls: pastCorner },
    )
  return {
    ...fillable(all, { walls: fits, targets }, paintOnly),
    ...(pastCorner.length ? { leftOut: pastCorner } : {}),
    ...(curved.length ? { curved } : {}),
  }
}

/**
 * A wall the fill cannot take is refused with its code and id: the fill's own error reached the
 * agent as a bare "Facades currently support straight walls.", naming no wall (2026-10-03).
 */
function fillable<T extends { walls: WallNode[] }>(
  nodes: Record<string, AnyNode>,
  found: T,
  paintOnly: boolean,
): T {
  for (const wall of found.walls) {
    const refusal = facadeWallRefusal(wall, nodes, { paintOnly })
    if (refusal) refuse(refusal.code, `${wall.id}: ${refusal.message}`, { wallId: wall.id })
  }
  return found
}

const metres = (value: number) => `${Math.round(value * 100) / 100} m`

/**
 * A fill that places nothing is refused with the reason: Victor run 8 reported 432 walls applied
 * while no window fitted a 2.5 m storey, and the model could only say the facade "did not take".
 */
export function requireFacadeFits(
  plan: FacadeFillPlan,
  input: FacadeUnit,
  mode: 'place' | 'dress' = 'place',
) {
  if (mode === 'dress') {
    if (!plan.runs.length || plan.walls.some((wall) => wall.dressed?.length)) return
    refuse(
      'nothing_to_dress',
      'No opening to dress on these walls: dress keeps the openings already there (from the plans or placed by hand) and styles them. Place them first, or use mode place.',
    )
  }
  const placed = plan.walls.some(
    (wall) =>
      wall.openings.values.length || wall.panels.values.length || wall.balconies.values.length,
  )
  if (placed || !plan.runs.length) return
  const unit = FacadeUnitSchema.parse(input)
  // A unit with no opening and no balcony is cladding: it paints the walls even where no bay fits
  // (the Victor's dark recess walls by the balconies, refused on every wall, 2026-10-03).
  const placing = unit.bays.some(
    (bay) =>
      bay.opening ||
      bay.balcony ||
      bay.variants?.some((variant) => variant.opening || variant.balcony),
  )
  if (!placing) return
  const openings = unit.bays.flatMap((bay) =>
    bay.opening?.heightMode === 'fixed' ? [bay.opening] : [],
  )
  const storey = Math.max(...plan.runs.map((run) => run.height))
  const needs = openings.length
    ? Math.min(...openings.map((opening) => opening.sill + opening.height))
    : 0
  if (needs > storey + 1e-6)
    refuse(
      'unit_does_not_fit',
      `No opening fits: the unit's lowest opening reaches ${metres(needs)} (sill + height) and these storeys are ${metres(storey)}. Lower the openings or sills, or build taller walls (create_reference_elements with height raises the storey).`,
      { needs, storey },
    )
  const longest = Math.max(...plan.runs.map((run) => run.end - run.start))
  refuse(
    'unit_does_not_fit',
    `No bay fits: the longest of the ${plan.runs.length} runs is ${metres(longest)}, narrower than one bay with its end piers. Narrow the bays, piers or end piers.`,
    { longest, runs: plan.runs.length },
  )
}

/**
 * The apply tools take the previewId of every unit they apply: Victor arm A applied three units
 * it never previewed in their final form. A unit changed since its preview has another id.
 */
export function requireFacadePreviewed(
  units: readonly { key?: string; unit: unknown }[],
  previewIds: readonly string[] = [],
) {
  const missing = units.filter(({ unit }) => !previewIds.includes(facadeUnitPreviewId(unit)))
  if (!missing.length) return
  const names = missing.map(
    ({ key, unit }) => key ?? (unit as { name?: string } | null)?.name ?? 'the unit',
  )
  refuse(
    'unit_not_previewed',
    `Not previewed as applied: ${names.join(', ')}. Call preview_facade_unit on ${missing.length === 1 ? 'it' : 'each'}, compare the drawing with the photo, and pass the previewId it returns; a unit changed since its preview needs a new one.`,
    { units: names },
  )
}

/**
 * A fill replaces what its walls' runs had, so a unit without balconies applied over a balcony
 * stack (a correction of the floor's main unit) deleted the stack and reported success. A wall
 * keeping some balconies is the stack re-solved, and goes through.
 */
export function requireBalconiesKept(plan: FacadeFillPlan, replaceBalconies = false) {
  if (replaceBalconies) return
  const stripped = plan.walls.filter(
    (wall) => wall.balconies.removed.length && !wall.balconies.values.length,
  )
  if (!stripped.length) return
  const decks = stripped.reduce(
    (sum, wall) => sum + wall.balconies.removed.filter((node) => node.type === 'slab').length,
    0,
  )
  const walls = stripped.map((wall) => wall.wall.id)
  refuse(
    'balcony_stack_replaced',
    `This apply would delete the balcony stack on ${walls.length} wall${walls.length === 1 ? '' : 's'} (${decks} balcon${decks === 1 ? 'y' : 'ies'}): ${walls.join(', ')}. Leave those walls out, or pass replaceBalconies: true and then apply the stack again on the same floors with scope balconies.`,
    { walls, balconies: decks },
  )
}
