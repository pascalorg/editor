import { z } from 'zod'
import { addPlantingTool } from '../agent-tools/planting'
import { refuse } from '../agent-tools/refusal'
import { planPlanting } from '../lib/planting-build'
import { plantingFacts } from '../lib/planting-facts'
import {
  type PlantingPoint,
  plantingArea,
  plantingAreaOutline,
  plantingOutlineProblem,
} from '../lib/planting-outline'
import { resolvePlantingAccept, resolvePlantingGround } from '../lib/planting-scene'
import { levelLocalToWorldXZ } from '../lib/terrain-support-query'
import { queryNodes } from '../runtime/node-queries'
import { type BuildingNode, PlantingNode, type SiteNode } from '../schema'
import { PLANTING_LIMITS } from '../schema/nodes/planting-limits'
import type { AgentOperation, SceneNodes } from './types'

const inputSchema = z.strictObject(addPlantingTool.input)
type Input = z.output<typeof inputSchema>

function requireSite(nodes: SceneNodes, siteId: string | undefined): SiteNode {
  if (siteId) {
    const site = nodes[siteId]
    if (site?.type !== 'site')
      refuse('no_site', 'The scene has no matching Site for this planting bed.')
    return site
  }
  const sites = queryNodes(nodes, { type: 'site' }).filter((node) => node.type === 'site')
  if (sites.length > 1)
    refuse('ambiguous_site', 'Choose the Site that owns this planting bed with siteId.')
  const site = sites[0]
  if (!site) refuse('no_site', 'Add a Site before planting a bed.')
  return site
}

function existingPlanting(nodes: SceneNodes, id: string): PlantingNode {
  const node = nodes[id]
  if (node?.type !== 'planting')
    refuse('planting_not_found', `Planting bed not found: ${id}.`, { plantingId: id })
  return node
}

function requireBuilding(
  nodes: SceneNodes,
  id: string | undefined,
  site: SiteNode,
): BuildingNode | null {
  if (!id) return null
  const building = nodes[id]
  if (building?.type !== 'building')
    refuse('building_not_found', `Building not found: ${id}.`, { buildingId: id })
  if (building.parentId !== site.id)
    refuse(
      'building_site_mismatch',
      'The building and planting bed must belong to the same Site.',
      { buildingId: id, siteId: site.id },
    )
  if (Math.abs(building.rotation[0]) > 1e-9 || Math.abs(building.rotation[2]) > 1e-9)
    refuse(
      'planting_transform_unsupported',
      'A tipped building cannot supply a planting plan frame; give Site coordinates instead.',
    )
  return building
}

/** Reject pathological requested density without running outline smoothing, scatter or a generator. */
function requireBudget(node: PlantingNode, area: number): void {
  let weightedDensity = 0
  let shares = 0
  for (const plant of node.plants) {
    weightedDensity += plant.share / (plant.spacing * plant.spacing)
    shares += plant.share
  }
  const requested = (area * weightedDensity) / shares
  if (!Number.isFinite(requested) || requested > PLANTING_LIMITS.maxAttempts)
    refuse(
      'planting_budget_exceeded',
      'The bed and spacing request too many planting sites; split the bed or increase spacing.',
      {
        requestedSites: Math.ceil(requested),
        maxSites: PLANTING_LIMITS.maxAttempts,
      },
    )
}

/** One pure operation for drawing, chat and MCP: all validation precedes generated work or changes. */
export const addPlanting: AgentOperation<Input> = (nodes, rawInput) => {
  const parsed = inputSchema.safeParse(rawInput)
  if (!parsed.success) refuse('invalid_input', parsed.error.message)
  const input = parsed.data
  const previous = input.plantingId ? existingPlanting(nodes, input.plantingId) : null
  if (input.outline !== undefined && input.area !== undefined)
    refuse('planting_outline_required', 'Give an outline or an area around a center, not both.')
  if (!previous && input.outline === undefined && input.area === undefined)
    refuse(
      'planting_outline_required',
      'Give an outline or an area around a center for the new bed.',
    )
  if (previous && input.siteId && input.siteId !== previous.parentId)
    refuse(
      'planting_site_mismatch',
      'An existing planting bed stays on its Site; add another bed on the other Site.',
    )
  const site = requireSite(nodes, input.siteId ?? previous?.parentId ?? undefined)
  const building = requireBuilding(nodes, input.buildingId, site)
  const { plantingId: _plantingId, siteId: _siteId, buildingId: _buildingId, ...fields } = input
  const changed = { ...fields }
  if (input.outline) {
    changed.outline = input.outline.map(([x, z]) => levelLocalToWorldXZ(building, x, z))
    changed.area = undefined
  } else if (input.area !== undefined) {
    changed.outline = undefined
    if (input.center || previous?.area === undefined) {
      const [x, z] = input.center ?? [0, 0]
      changed.center = levelLocalToWorldXZ(building, x, z)
    }
  } else if (input.center) {
    if (previous?.area === undefined)
      refuse(
        'invalid_input',
        'A center moves an area-based bed; give a new outline to move an outlined bed.',
      )
    changed.center = levelLocalToWorldXZ(building, input.center[0], input.center[1])
  }
  const candidate = {
    name: 'Planting bed',
    gen: 1 as const,
    ...previous,
    ...changed,
    parentId: site.id,
  }
  const outline =
    candidate.outline ?? plantingAreaOutline(candidate.area as number, candidate.center ?? [0, 0])
  const problem = plantingOutlineProblem(outline as PlantingPoint[])
  if (problem) refuse('planting_invalid_outline', problem)
  const validated = PlantingNode.safeParse(candidate)
  if (!validated.success) refuse('invalid_input', validated.error.message)
  const node = validated.data
  requireBudget(node, Math.abs(plantingArea(outline as PlantingPoint[])))
  const ground = resolvePlantingGround(node, nodes)
  const plan = planPlanting(node, ground, resolvePlantingAccept(node, nodes, ground))
  if (!plan.withinBudget)
    refuse(
      'planting_budget_exceeded',
      'The selected generator exceeds the per-bed geometry budget; use a smaller bed or wider spacing.',
    )
  if (!plan.placements.length)
    refuse(
      'planting_empty',
      'No plants fit clear of the building, paving and ground steps; enlarge or move the bed, or reduce plant size and spacing.',
    )
  const result = { plantingId: node.id, siteId: site.id, facts: plantingFacts(node, nodes, plan) }
  return previous
    ? { result, changes: { update: [{ id: node.id, data: changed }] } }
    : { result, changes: { create: [{ node, parentId: site.id }] } }
}
