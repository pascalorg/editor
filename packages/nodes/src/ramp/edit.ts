import {
  type AnyNodeId,
  type BuildingNode,
  levelLocalToWorldXZ,
  planRampCreation,
  planRampEdit,
  RampNode,
  type SceneApi,
} from '@pascal-app/core'

export function rampSiteFrame(sceneApi: SceneApi, activeLevelId: AnyNodeId | null) {
  const nodes = sceneApi.nodes()
  const level = activeLevelId ? nodes[activeLevelId] : undefined
  const parent = level?.parentId ? nodes[level.parentId as AnyNodeId] : undefined
  const building = parent?.type === 'building' ? parent : null
  const site = building?.parentId ? nodes[building.parentId as AnyNodeId] : undefined
  if (site?.type === 'site') return { site, building }
  const sites = Object.values(nodes).filter((node) => node.type === 'site')
  const onlySite = sites[0]
  return sites.length === 1 && onlySite ? { site: onlySite, building } : null
}

export function rampPlanToSite(
  building: BuildingNode | null,
  point: [number, number],
): [number, number] {
  return levelLocalToWorldXZ(building, point[0], point[1])
}

export function rampSiteToPlan(
  building: BuildingNode | null,
  point: [number, number],
): [number, number] {
  if (!building) return point
  const x = point[0] - building.position[0]
  const z = point[1] - building.position[2]
  const angle = building.rotation[1]
  return [Math.cos(angle) * x - Math.sin(angle) * z, Math.sin(angle) * x + Math.cos(angle) * z]
}

/** A site-plan SVG is already in Site metres; an ordinary plan is building-local. */
export function rampFloorplanFrame(
  building: BuildingNode | null,
  activeLevelId: AnyNodeId | null,
  drawingType: 'floor-plan' | 'site-plan',
) {
  return drawingType === 'site-plan'
    ? { building: null, activeLevelId: null }
    : { building, activeLevelId }
}

function applyRampPlan(sceneApi: SceneApi, changes: ReturnType<typeof planRampEdit>) {
  if (!sceneApi.applyChanges) throw new Error('Ramp editing requires atomic scene changes.')
  sceneApi.applyChanges({
    create: changes.create?.map(({ node, parentId }) => ({
      node,
      parentId: parentId as AnyNodeId | undefined,
    })),
    update: changes.update?.map(({ id, data }) => ({ id: id as AnyNodeId, data })),
  })
}

/** Plan first; a refusal leaves both the ramp and the terrain untouched. One write, one undo. */
export function commitRampEdit(sceneApi: SceneApi, id: RampNode['id'], patch: Partial<RampNode>) {
  const current = sceneApi.get<RampNode>(id)
  if (current?.type !== 'ramp') throw new Error('The ramp no longer exists.')
  const next = RampNode.parse({ ...current, ...patch })
  applyRampPlan(sceneApi, planRampEdit(next, sceneApi.nodes()))
}

export function commitRampCreation(sceneApi: SceneApi, node: RampNode) {
  if (!node.parentId) throw new Error('Choose a Site for the ramp.')
  applyRampPlan(sceneApi, planRampCreation(node, sceneApi.nodes()))
}
