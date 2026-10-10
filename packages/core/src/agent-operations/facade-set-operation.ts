import { refuse } from '../agent-tools/refusal'
import {
  buildingFacadeNode,
  describeFacade,
  FacadeOperationError,
  facadeFreeArea,
  planBuildingFacade,
} from '../building/facade-operations'
import type { AnyNode, WallNode } from '../schema'
import type { FacadeMode } from '../systems/facade/facade-config'
import type { FacadeSet } from '../systems/facade/facade-set'
import { levelBalconies } from './level-balconies'
import type { AgentContext, AgentOperation, SceneNodes } from './types'

export type AgentFacadeSetInput = {
  buildingId?: string
  set: FacadeSet
  mode?: FacadeMode
  freeAreas?: { unitKey: string; wallIds: string[] }[]
  replaceExisting?: boolean
}

type Pt = [number, number]

const nearSegment = ([x, z]: Pt, [a, b]: [Pt, Pt], tolerance = 0.2) => {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)))
  return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz) <= tolerance
}

/**
 * A free unit with balconies stacks from the storey of its walls to the top: anchored where the
 * floor's plan draws no balcony, it stood balconies there (Victor run 9c, on the ground floor).
 * Refused when the walls' floor has a building map and none of them is at one of its balconies.
 */
function requirePlanBalconies(
  nodes: SceneNodes,
  set: FacadeSet,
  unitKey: string,
  walls: readonly WallNode[],
) {
  const unit = set.units.find((entry) => entry.key === unitKey)?.unit
  const hasBalcony = unit?.bays.some(
    (bay) => bay.balcony || bay.variants?.some((variant) => variant.balcony),
  )
  const levelId = walls[0]?.parentId
  if (!hasBalcony || !levelId) return
  const { mapped, balconies } = levelBalconies(nodes, levelId)
  if (!mapped) return
  const edges = balconies.flatMap(({ corners: [a, b, c, d] }) =>
    [
      [a, b],
      [b, c],
      [c, d],
      [d, a],
    ].map((edge) => edge as [Pt, Pt]),
  )
  const atBalcony = walls.some((wall) => {
    const mid: Pt = [(wall.start[0] + wall.end[0]) / 2, (wall.start[1] + wall.end[1]) / 2]
    return edges.some((edge) => nearSegment(mid, edge))
  })
  if (atBalcony) return
  const withBalconies = Object.values(nodes)
    .filter((node) => node.type === 'level' && levelBalconies(nodes, node.id).balconies.length > 0)
    .map((node) => (node as { name?: string; id: string }).name ?? node.id)
  const level = nodes[levelId] as { name?: string } | undefined
  refuse(
    'no_plan_balcony',
    `The plan of ${level?.name ?? levelId} draws no balcony at these walls, and a balcony stack runs from its walls' floor to the top. Anchor it on the walls behind the balconies (balconyWalls) of the lowest floor whose plan draws them${withBalconies.length ? `: ${withBalconies.join(', ')}` : ''}.`,
    { unitKey, levelId },
  )
}

/** The building asked for, else the one the viewed floor belongs to, else the only one. */
export function resolveFacadeBuilding(
  nodes: SceneNodes,
  buildingId: string | undefined,
  context: AgentContext,
) {
  if (buildingId) {
    if (nodes[buildingId]?.type !== 'building')
      refuse('building_not_found', `Building not found: ${buildingId}.`, { buildingId })
    return buildingId
  }
  const level = context.activeLevelId ? nodes[context.activeLevelId] : undefined
  if (level?.type === 'level' && level.parentId && nodes[level.parentId]?.type === 'building')
    return level.parentId
  const buildings = Object.values(nodes).filter((node) => node.type === 'building')
  if (buildings.length === 1) return buildings[0]!.id
  refuse(
    'building_required',
    buildings.length ? 'Several buildings: pass buildingId.' : 'There is no building in the scene.',
  )
}

/**
 * A facade set on a building, as both surfaces apply it: storey roles and free units' areas
 * (walls picked on one storey, up to the top), corners and bands; the facade operations' refusals
 * as agent refusals with the same codes.
 */
export function planAgentFacadeSet(
  nodes: SceneNodes,
  input: AgentFacadeSetInput,
  context: AgentContext,
) {
  const buildingId = resolveFacadeBuilding(nodes, input.buildingId, context)
  const all = nodes as Record<string, AnyNode>
  const freeAreas = (input.freeAreas ?? []).flatMap(({ unitKey, wallIds }) => {
    const walls = wallIds.map((id) => {
      const wall = all[id]
      if (!wall) refuse('wall_not_found', `Wall not found: ${id}.`, { wallId: id })
      if (wall.type !== 'wall')
        refuse('not_a_wall', `Node ${id} is a ${wall.type}, not a wall.`, { wallId: id })
      return wall as WallNode
    })
    requirePlanBalconies(nodes, input.set, unitKey, walls)
    const area = facadeFreeArea({ nodes: all, buildingId, unitKey, walls })
    return area ? [area] : []
  })
  try {
    return {
      buildingId,
      ...planBuildingFacade({
        nodes: all,
        buildingId,
        set: input.set,
        freeAreas,
        mode: input.mode,
        replaceExisting: input.replaceExisting,
      }),
    }
  } catch (error) {
    if (error instanceof FacadeOperationError) refuse(error.code, error.message)
    throw error
  }
}

/** What a set's application reports to the model: coverage, issues by code, units that built nothing. */
export function facadeSetSummary(plan: ReturnType<typeof planAgentFacadeSet>) {
  const units = plan.coverage.units
  const empty = units
    .filter((unit) => unit.length > 0 && unit.openings === 0)
    .map((unit) => unit.key)
  return {
    status: 'applied',
    buildingId: plan.buildingId,
    facadeId: plan.facade.id,
    coverage: plan.coverage,
    issues: plan.issues.slice(0, 20),
    ...(plan.issues.length > 20 ? { issuesOmitted: plan.issues.length - 20 } : {}),
    walls: plan.plans.reduce((sum, entry) => sum + entry.walls.length, 0),
    skipped: plan.skipped,
    ...(empty.length
      ? {
          unitsWithoutOpenings: empty,
          note: 'These units cover walls but placed or dressed no opening: check their bays fit the runs (height and width), or that the walls hold openings to dress.',
        }
      : {}),
  }
}

/** `describe_facade`: the facade set on a building, as data — units, bays, corners, bands, areas. */
export const describeBuildingFacade: AgentOperation<{ buildingId?: string }> = (
  nodes,
  input,
  context,
) => {
  const buildingId = resolveFacadeBuilding(nodes, input.buildingId, context)
  const facade = buildingFacadeNode(nodes as Record<string, AnyNode>, buildingId)
  return {
    result: {
      buildingId,
      facade: facade ? describeFacade(facade, nodes as Record<string, AnyNode>) : null,
    },
  }
}
