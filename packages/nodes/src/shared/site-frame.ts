import {
  type AnyNodeId,
  type BuildingNode,
  siteFrame as buildingSiteFrame,
  levelFrame,
  type SceneApi,
} from '@pascal-app/core'

/** Resolve the active building's Site, falling back only when the scene has one Site. */
export function siteFrame(sceneApi: SceneApi, activeLevelId: AnyNodeId | null) {
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

export function planToSite(
  building: BuildingNode | null,
  point: [number, number],
): [number, number] {
  return [...buildingSiteFrame(building)(point[0], point[1])]
}

export function siteToPlan(
  building: BuildingNode | null,
  point: [number, number],
): [number, number] {
  return [...levelFrame(building)(point[0], point[1])]
}

/** A site-plan SVG is already in Site metres; an ordinary plan is building-local. */
export function siteFloorplanFrame(
  building: BuildingNode | null,
  activeLevelId: AnyNodeId | null,
  drawingType: 'floor-plan' | 'site-plan',
) {
  return drawingType === 'site-plan'
    ? { building: null, activeLevelId: null }
    : { building, activeLevelId }
}
