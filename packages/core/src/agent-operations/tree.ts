import { z } from 'zod'
import { refuse } from '../agent-tools/refusal'
import { addTreeTool } from '../agent-tools/tree'
import { levelLocalToWorldXZ } from '../lib/terrain-support-query'
import { type TreeFacts, treeFacts } from '../lib/tree-facts'
import { defaultTreeSpread } from '../lib/tree-form'
import { readTreeSite } from '../lib/tree-scene'
import { queryNodes } from '../runtime/node-queries'
import { type BuildingNode, type SiteNode, TreeNode } from '../schema'
import type { AgentOperation, SceneNodes } from './types'

const inputSchema = z.strictObject(addTreeTool.input)
type Input = z.output<typeof inputSchema>

function requireSite(nodes: SceneNodes, siteId: string | undefined): SiteNode {
  if (siteId) {
    const site = nodes[siteId]
    if (site?.type !== 'site') refuse('no_site', 'The scene has no matching Site for these trees.')
    return site
  }
  const sites = queryNodes(nodes, { type: 'site' }).filter((node) => node.type === 'site')
  if (sites.length > 1) refuse('ambiguous_site', 'Choose the Site for these trees with siteId.')
  const site = sites[0]
  if (!site) refuse('no_site', 'Add a Site before planting trees.')
  return site
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
    refuse('building_site_mismatch', 'The building and trees must belong to the same Site.', {
      buildingId: id,
      siteId: site.id,
    })
  if (Math.abs(building.rotation[0]) > 1e-9 || Math.abs(building.rotation[2]) > 1e-9)
    refuse(
      'tree_transform_unsupported',
      'A tipped building cannot supply a tree plan frame; give Site coordinates instead.',
    )
  return building
}

function candidateTrees(input: Input, site: SiteNode, building: BuildingNode | null): TreeNode[] {
  const { trees, siteId: _siteId, buildingId: _buildingId, ...shared } = input
  return trees.map(({ at, ...individual }, index) => {
    const fields = { ...shared, ...individual }
    const [x, z] = levelLocalToWorldXZ(building, at[0], at[1])
    const form = fields.form ?? 'round'
    const heightM = fields.heightM ?? 8
    const parsed = TreeNode.safeParse({
      ...fields,
      parentId: site.id,
      position: [x, 0, z],
      name: input.name ?? 'Tree',
      form,
      heightM,
      spreadM: fields.spreadM ?? defaultTreeSpread(form, heightM),
      seed: individual.seed ?? ((input.seed ?? 1) + Math.imul(index, 0x9e3779b9)) | 0,
    })
    if (!parsed.success) refuse('invalid_input', parsed.error.message, { index })
    return parsed.data
  })
}

function reportsFor(node: TreeNode, facts: TreeFacts): Record<string, unknown>[] {
  const reports: Record<string, unknown>[] = []
  if (facts.roofOverhangIds.length)
    reports.push({ code: 'tree_crown_over_roof', treeId: node.id, roofIds: facts.roofOverhangIds })
  if (facts.crossesLotLine) reports.push({ code: 'tree_crown_crosses_lot', treeId: node.id })
  return reports
}

export const addTree: AgentOperation<Input> = (nodes, rawInput) => {
  const parsed = inputSchema.safeParse(rawInput)
  if (!parsed.success) refuse('invalid_input', parsed.error.message)
  const input = parsed.data
  const site = requireSite(nodes, input.siteId)
  const building = requireBuilding(nodes, input.buildingId, site)
  const trees = candidateTrees(input, site, building)
  const siteRead = readTreeSite(site.id, nodes)
  const facts = trees.map((node, index) => {
    const fact = treeFacts(node, nodes, siteRead)
    if (fact.trunkBuildingId)
      refuse(
        'tree_inside_building',
        'A tree trunk is inside a building footprint; move its anchor outside.',
        {
          index,
          buildingId: fact.trunkBuildingId,
        },
      )
    return fact
  })
  const distances = facts.flatMap((fact) =>
    fact.nearestBuildingDistanceM === null ? [] : [fact.nearestBuildingDistanceM],
  )
  return {
    result: {
      siteId: site.id,
      count: trees.length,
      treeIds: trees.map((node) => node.id),
      facts: {
        heightsM: facts.map((fact) => fact.heightM),
        crownCoverM2: facts.reduce((sum, fact) => sum + fact.crownCoverM2, 0),
        nearestBuildingDistanceM: distances.length ? Math.min(...distances) : null,
        reports: trees.flatMap((node, index) => {
          const fact = facts[index]
          return fact ? reportsFor(node, fact) : []
        }),
      },
    },
    changes: { create: trees.map((node) => ({ node, parentId: site.id })) },
  }
}
