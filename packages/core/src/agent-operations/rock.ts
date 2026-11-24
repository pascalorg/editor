import { z } from 'zod'
import { refuse } from '../agent-tools/refusal'
import { addRockTool } from '../agent-tools/rock'
import { planRock } from '../lib/rock-build'
import { rockFacts } from '../lib/rock-facts'
import { rockFootprint } from '../lib/rock-footprint'
import { OUTLINE_MIN_AREA, outlineProblem } from '../lib/rock-outline'
import { levelLocalToWorldXZ } from '../lib/terrain-support-query'
import { queryNodes } from '../runtime/node-queries'
import { type AnyNode, type BuildingNode, RockNode, type SiteNode } from '../schema'
import type { AgentOperation, SceneNodes } from './types'

const inputSchema = z.strictObject(addRockTool.input)
type Input = z.output<typeof inputSchema>
type Point = [number, number]

function requireSite(nodes: SceneNodes, siteId: string | undefined) {
  const sites = queryNodes(nodes, { type: 'site' }).filter((node) => node.type === 'site')
  if (!siteId && sites.length > 1)
    refuse('ambiguous_site', 'Choose the Site that owns this rock with siteId.')
  const site = siteId ? nodes[siteId] : sites[0]
  if (site?.type !== 'site') refuse('no_site', 'The scene has no matching Site for this rock.')
  return site
}

function requireBuilding(
  nodes: SceneNodes,
  buildingId: string | undefined,
  site: SiteNode,
): BuildingNode | null {
  if (!buildingId) return null
  const building = nodes[buildingId]
  if (building?.type !== 'building')
    refuse('building_not_found', `Building not found: ${buildingId}.`, { buildingId })
  if (building.parentId !== site.id)
    refuse('building_site_mismatch', 'The building and rock must belong to the same Site.', {
      buildingId,
      siteId: site.id,
    })
  return building
}

/** An outline given in a building's plan frame, in the Site's: as the building stands in it. */
function inSiteFrame(outline: Point[], building: BuildingNode | null): Point[] {
  return building ? outline.map(([x, z]) => levelLocalToWorldXZ(building, x, z)) : outline
}

function requireOutline(outline: Point[]) {
  const problem = outlineProblem(outline)
  if (problem)
    refuse(
      'rock_outline_invalid',
      `The outline ${problem}: give at least three corners in order that do not cross and enclose at least ${OUTLINE_MIN_AREA} m²; or pass at and size (for example, at: [0, 0], size: 0.6).`,
      { problem },
    )
}

function inputOutline(input: Input, previous?: RockNode): Point[] | undefined {
  const polygon = input.polygon ?? input.outline
  const hasAt = input.at !== undefined
  const hasSize = input.size !== undefined
  if (
    (input.polygon !== undefined && input.outline !== undefined) ||
    (polygon !== undefined && (hasAt || hasSize)) ||
    hasAt !== hasSize
  )
    refuse(
      'invalid_input',
      'Give exactly one footprint: polygon (or outline), or both at and size.',
    )
  if (input.at && input.size !== undefined)
    return rockFootprint(
      input.at as Point,
      input.size as number | Point,
      input.seed ?? previous?.seed ?? 1,
    )
  return polygon as Point[] | undefined
}

function existingRock(nodes: SceneNodes, rockId: string): RockNode {
  const node = nodes[rockId]
  if (node?.type !== 'rock') refuse('rock_not_found', `Rock not found: ${rockId}.`, { rockId })
  return node
}

function fields(input: Input, outline: Point[] | undefined, previous?: RockNode) {
  return {
    ...(outline ? { polygon: outline } : {}),
    ...(input.rockType === undefined ? {} : { rockType: input.rockType }),
    ...(input.weathering === undefined ? {} : { weathering: input.weathering }),
    ...(input.moss === undefined ? {} : { moss: input.moss }),
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.height === undefined ? {} : { height: input.height }),
    ...(input.seed === undefined ? {} : { seed: input.seed }),
    ...(input.form === undefined ? {} : { form: input.form }),
    ...(input.strata === undefined ? {} : { strata: input.strata }),
    ...(input.lichen === undefined ? {} : { lichen: input.lichen }),
    ...(previous ? {} : { name: input.name ?? 'Rock', gen: 1 as const }),
  }
}

function response(rock: RockNode, nodes: SceneNodes) {
  const plan = planRock(rock)
  if (plan.problem)
    refuse('rock_outline_invalid', `The rock outline ${plan.problem}.`, { problem: plan.problem })
  if (!plan.withinBudget)
    refuse(
      'rock_budget_exceeded',
      'This rock exceeds its geometry budget. Use a simpler outline.',
      {
        estimatedTriangles: {
          near: plan.estimate.near.triangles,
          far: plan.estimate.far.triangles,
        },
      },
    )
  return { rockId: rock.id, siteId: rock.parentId, facts: rockFacts(rock, nodes) }
}

/** `add_rock`: one rock, added or reshaped; only the rock changes (floors derive their holes). */
export const addRock: AgentOperation<Input> = (nodes, rawInput) => {
  const parsed = inputSchema.safeParse(rawInput)
  if (!parsed.success) refuse('invalid_input', parsed.error.message)
  const input = parsed.data
  const previous = input.rockId ? existingRock(nodes, input.rockId) : undefined
  const parent = previous?.parentId ? nodes[previous.parentId] : undefined
  const site =
    previous && parent?.type === 'site' && !input.siteId ? parent : requireSite(nodes, input.siteId)
  if (previous && previous.parentId !== site.id)
    refuse(
      'rock_site_mismatch',
      'An existing rock stays on its Site; add another rock on the other Site.',
    )
  const building = requireBuilding(nodes, input.buildingId, site)
  const footprint = inputOutline(input, previous)
  const outline = footprint ? inSiteFrame(footprint, building) : undefined
  if (outline) requireOutline(outline)

  if (previous) {
    const data = fields(input, outline, previous)
    const next = RockNode.parse({ ...previous, ...data })
    return {
      result: response(next, { ...nodes, [next.id]: next as AnyNode }),
      changes: { update: [{ id: next.id, data }] },
    }
  }
  if (!outline)
    refuse(
      'outline_required',
      'Give the rock a polygon (or outline) of at least three corners, or pass at and size.',
    )
  const rock = RockNode.parse({ ...fields(input, outline), parentId: site.id })
  return {
    result: response(rock, { ...nodes, [rock.id]: rock as AnyNode }),
    changes: { create: [{ node: rock, parentId: site.id }] },
  }
}
