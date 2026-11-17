import type { SiteNode } from '../schema/nodes/site'
import {
  TERRAIN_TILE_SAMPLES,
  TERRAIN_TILE_SIZE,
  TERRAIN_TILE_SPACING,
  type TerrainTileNode,
} from '../schema/nodes/terrain-tile'
import type { AnyNode } from '../schema/types'
import { decodeTerrainField } from './terrain-codec'
import type { TerrainField } from './terrain-field'

export type TerrainNodes = Readonly<Record<string, AnyNode>>
export type TerrainSite = Pick<SiteNode, 'terrain'> & Partial<Pick<SiteNode, 'id' | 'polygon'>>

const tileFields = new WeakMap<TerrainTileNode, TerrainField | null>()

export function tileFieldOf(tile: TerrainTileNode): TerrainField | null {
  if (tileFields.has(tile)) return tileFields.get(tile) ?? null
  const field =
    tile.level === 0 && Number.isInteger(tile.ix) && Number.isInteger(tile.iz)
      ? decodeTerrainField({
          type: 'heightfield',
          origin: [tile.ix * TERRAIN_TILE_SIZE, tile.iz * TERRAIN_TILE_SIZE],
          spacing: TERRAIN_TILE_SPACING,
          cols: TERRAIN_TILE_SAMPLES,
          rows: TERRAIN_TILE_SAMPLES,
          step: tile.step,
          heights: tile.heights,
        })
      : null
  tileFields.set(tile, field)
  return field
}

/** Coordinates, then id, own duplicated edges regardless of graph insertion order. */
export function terrainTilesOf(
  site: Pick<TerrainSite, 'id'> | null | undefined,
  nodes?: TerrainNodes,
): TerrainTileNode[] {
  if (!site?.id || !nodes) return []
  return Object.values(nodes)
    .filter(
      (node): node is TerrainTileNode =>
        node.type === 'terrain-tile' && node.parentId === site.id && tileFieldOf(node) !== null,
    )
    .sort(
      (left, right) =>
        left.ix - right.ix ||
        left.iz - right.iz ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    )
}
