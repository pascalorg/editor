import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const TERRAIN_TILE_SIZE = 32
export const TERRAIN_TILE_SAMPLES = 65
export const TERRAIN_TILE_SPACING = 0.5

// 65² little-endian Int16 samples: 8,450 bytes with one canonical padding byte.
const TileHeights = z.string().regex(/^[A-Za-z0-9+/]{11266}[AEIMQUYcgkosw048]=$/)

export const TerrainTileNode = BaseNode.extend({
  id: objectId('terrain-tile'),
  type: nodeType('terrain-tile'),
  level: z.literal(0).default(0),
  ix: z.number().int(),
  iz: z.number().int(),
  step: z.number().finite().positive().default(0.01),
  heights: TileHeights,
}).describe('Authored terrain: a 32 metre tile with 65 × 65 quantized height samples')

export type TerrainTileNode = z.infer<typeof TerrainTileNode>
export type TerrainTileNodeId = TerrainTileNode['id']
export const TerrainTileNodeSchema = TerrainTileNode
