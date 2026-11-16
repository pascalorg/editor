import { type Ring, type TerrainField, type TerrainTileNode, tileFieldOf } from '@pascal-app/core'
import type { RampGroundCut } from '../site/ramp-ground-holes'
import type { TerrainMeshBuffers } from '../site/terrain-geometry'
import { buildTerrainGroundMesh } from '../site/terrain-ground'

export function buildTerrainTileMesh(
  tile: TerrainTileNode,
  field: TerrainField,
  holes: Ring[] = [],
  cuts: readonly RampGroundCut[] = [],
): TerrainMeshBuffers {
  const grid = tileFieldOf(tile)
  if (!grid) throw new Error(`Invalid terrain tile: ${tile.id}`)
  return buildTerrainGroundMesh(grid, field, holes, cuts)
}
