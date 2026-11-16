import {
  type AnyNodeId,
  persistedTerrainFieldOf,
  type SceneApi,
  type SiteNode,
  TerrainBreakNode,
  terrainBreakFacts,
} from '@pascal-app/core'
import { addTerrainBreak, validateTerrainBreakPlacement } from '@pascal-app/core/agent-operations'

type Point = [number, number]

export function terrainBreakLotLine(site: SiteNode, start: Point, end: Point): Point[] {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  if (Math.hypot(dx, dz) < 0.01) throw new Error('Choose two distinct points for the boundary.')
  const cuts: number[] = []
  const ring = site.polygon.points
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as Point
    const b = ring[(i + 1) % ring.length] as Point
    const ex = b[0] - a[0]
    const ez = b[1] - a[1]
    const determinant = dx * ez - dz * ex
    if (Math.abs(determinant) < 1e-10) continue
    const ax = a[0] - start[0]
    const az = a[1] - start[1]
    const u = (ax * dz - az * dx) / determinant
    if (u >= 0 && u <= 1) cuts.push((ax * ez - az * ex) / determinant)
  }
  if (cuts.length < 2) throw new Error('Draw a boundary that crosses the lot.')
  const at = (t: number): Point => [start[0] + dx * t, start[1] + dz * t]
  return [at(Math.min(...cuts)), at(Math.max(...cuts))]
}

export function commitTerrainBreakCreation(
  sceneApi: SceneApi,
  input: Pick<TerrainBreakNode, 'line' | 'kind' | 'left' | 'right'>,
): AnyNodeId {
  if (!sceneApi.applyChanges)
    throw new Error('Terrain break creation requires atomic scene changes.')
  const { result, changes } = addTerrainBreak(sceneApi.nodes(), input, { activeLevelId: null })
  sceneApi.applyChanges({
    create: changes?.create?.map(({ node, parentId }) => ({
      node: TerrainBreakNode.parse(node),
      parentId: parentId as AnyNodeId | undefined,
    })),
  })
  return result.breakId as AnyNodeId
}

export function commitTerrainBreakEdit(
  sceneApi: SceneApi,
  id: TerrainBreakNode['id'],
  patch: Partial<TerrainBreakNode>,
): void {
  const current = sceneApi.get<TerrainBreakNode>(id)
  if (current?.type !== 'terrain-break') throw new Error('The terrain break no longer exists.')
  const candidate = TerrainBreakNode.parse({ ...current, ...patch })
  const site = candidate.parentId ? sceneApi.get(candidate.parentId as AnyNodeId) : null
  if (site?.type !== 'site') throw new Error('The terrain break needs a Site.')
  validateTerrainBreakPlacement(sceneApi.nodes(), site, candidate, 'context')
  const field = persistedTerrainFieldOf(site, { ...sceneApi.nodes(), [id]: candidate })
  if (!field) throw new Error('The terrain break needs readable ground.')
  terrainBreakFacts(candidate, field)
  sceneApi.update(id, patch)
}
