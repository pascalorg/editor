import { TERRAIN_TILE_SIZE, type TerrainField, type TerrainTileNode } from '@pascal-app/core'

/**
 * What a tile's mesh reads of the ground: its own samples, the edge samples its eight neighbours
 * own (a shared rim is read from whichever tile owns it), and the breaks. Nothing farther away
 * changes a vertex of it, so a tile's mesh is rebuilt when one of these changes and not when a
 * tile two squares away is edited or the authority was rebuilt for another reason.
 */
export function tileNeighbours(
  tile: Pick<TerrainTileNode, 'ix' | 'iz'>,
  tiles: readonly TerrainTileNode[],
): (TerrainTileNode | undefined)[] {
  const found: (TerrainTileNode | undefined)[] = []
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue
      found.push(tiles.find((other) => other.ix === tile.ix + dx && other.iz === tile.iz + dz))
    }
  return found
}

const ids = new WeakMap<object, number>()
let nextId = 1

/** A string that changes with the identity of any object in the list, for a memo's dependency. */
export function identityKey(objects: readonly (object | undefined)[]): string {
  return objects
    .map((object) => {
      if (!object) return '-'
      let id = ids.get(object)
      if (id === undefined) {
        id = nextId++
        ids.set(object, id)
      }
      return id
    })
    .join(',')
}

/** The breaks the ground carries: they decide the regions a mesh is split on. */
export function breakLines(field: TerrainField): object[] {
  return [...(field.terrainBreaks ?? [])]
}

/**
 * Whether any of a tile can show: the ground is cut to the property line per fragment
 * (`lotMaskedMaterial`), so a tile whose square lies wholly outside the line's bounding box draws
 * 8 192 triangles of which none is kept. A box and a cell of margin, never a tile too few; a
 * line that is not yet a polygon hides nothing.
 */
export function tileMeetsLot(
  tile: Pick<TerrainTileNode, 'ix' | 'iz'>,
  polygon: ReadonlyArray<readonly [number, number]>,
): boolean {
  if (polygon.length < 3) return true
  const margin = 0.5
  const minX = tile.ix * TERRAIN_TILE_SIZE - margin
  const minZ = tile.iz * TERRAIN_TILE_SIZE - margin
  const maxX = (tile.ix + 1) * TERRAIN_TILE_SIZE + margin
  const maxZ = (tile.iz + 1) * TERRAIN_TILE_SIZE + margin
  let lotMinX = Number.POSITIVE_INFINITY
  let lotMinZ = Number.POSITIVE_INFINITY
  let lotMaxX = Number.NEGATIVE_INFINITY
  let lotMaxZ = Number.NEGATIVE_INFINITY
  for (const [x, z] of polygon) {
    if (!(Number.isFinite(x) && Number.isFinite(z))) return true
    lotMinX = Math.min(lotMinX, x)
    lotMinZ = Math.min(lotMinZ, z)
    lotMaxX = Math.max(lotMaxX, x)
    lotMaxZ = Math.max(lotMaxZ, z)
  }
  return !(lotMaxX < minX || lotMinX > maxX || lotMaxZ < minZ || lotMinZ > maxZ)
}
