import type { SiteNode } from '../schema/nodes/site'
import {
  TERRAIN_TILE_SAMPLES,
  TERRAIN_TILE_SIZE,
  TERRAIN_TILE_SPACING,
  TerrainTileNode,
} from '../schema/nodes/terrain-tile'
import { encodeTerrainField } from './terrain-codec'
import { createTerrainField, quantize, storedHeightAt, type TerrainField } from './terrain-field'
import { persistedTerrainFieldOf } from './terrain-source-persisted'
import { type TerrainNodes, terrainTilesOf } from './terrain-tiles'

export type TerrainEditBounds = { minX: number; minZ: number; maxX: number; maxZ: number }
export type TerrainTileWrites = {
  creates: TerrainTileNode[]
  updates: { id: TerrainTileNode['id']; heights: string; step: number }[]
}

export function terrainEditField(
  site: SiteNode,
  nodes: TerrainNodes,
  bounds: TerrainEditBounds,
): TerrainField {
  if (
    ![bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ].every(Number.isFinite) ||
    bounds.maxX < bounds.minX ||
    bounds.maxZ < bounds.minZ
  ) {
    throw new Error('Terrain edit bounds must be a finite ordered rectangle')
  }
  const spacing = TERRAIN_TILE_SPACING
  const minX = Math.floor(bounds.minX / spacing)
  const minZ = Math.floor(bounds.minZ / spacing)
  const maxX = Math.ceil(bounds.maxX / spacing)
  const maxZ = Math.ceil(bounds.maxZ / spacing)
  const authority = persistedTerrainFieldOf(site, nodes)
  const field = createTerrainField({
    origin: [minX * spacing, minZ * spacing],
    spacing,
    cols: maxX - minX + 1,
    rows: maxZ - minZ + 1,
    step: authority?.step,
  })
  sampleAuthority(field, authority)
  return field
}

function sampleAuthority(field: TerrainField, authority: TerrainField | null): void {
  if (!authority) return
  for (let row = 0; row < field.rows; row++) {
    for (let col = 0; col < field.cols; col++) {
      field.heights[row * field.cols + col] = quantize(
        field,
        storedHeightAt(
          authority,
          field.origin[0] + col * field.spacing,
          field.origin[1] + row * field.spacing,
        ),
      )
    }
  }
}

function validateEditFields(before: TerrainField, after: TerrainField): void {
  if (
    before.readHeightAt ||
    after.readHeightAt ||
    before.spacing !== TERRAIN_TILE_SPACING ||
    after.spacing !== before.spacing ||
    before.cols !== after.cols ||
    before.rows !== after.rows ||
    before.origin[0] !== after.origin[0] ||
    before.origin[1] !== after.origin[1] ||
    !before.origin.every((value) => Number.isInteger(value / TERRAIN_TILE_SPACING)) ||
    before.heights.length !== before.cols * before.rows ||
    after.heights.length !== after.cols * after.rows ||
    !Number.isFinite(after.step) ||
    after.step <= 0
  ) {
    throw new Error('Terrain tile writes require matching materialized 0.5 metre edit grids')
  }
}

function ownersOfSample(coordinate: number): number[] {
  const index = Math.floor(coordinate / TERRAIN_TILE_SIZE)
  return coordinate === index * TERRAIN_TILE_SIZE ? [index - 1, index] : [index]
}

function changedSamples(before: TerrainField, after: TerrainField) {
  const changed = new Map<string, number>()
  const tiles = new Map<string, { ix: number; iz: number }>()
  for (let row = 0; row < after.rows; row++) {
    for (let col = 0; col < after.cols; col++) {
      const index = row * after.cols + col
      const metres = (after.heights[index] ?? 0) * after.step
      if (metres === (before.heights[index] ?? 0) * before.step) continue
      const x = after.origin[0] + col * after.spacing
      const z = after.origin[1] + row * after.spacing
      changed.set(`${x},${z}`, metres)
      for (const ix of ownersOfSample(x)) {
        for (const iz of ownersOfSample(z)) tiles.set(`${ix},${iz}`, { ix, iz })
      }
    }
  }
  return { changed, tiles }
}

function editedTileField(
  ix: number,
  iz: number,
  step: number,
  authority: TerrainField | null,
  changed: Map<string, number>,
): TerrainField {
  const field = createTerrainField({
    origin: [ix * TERRAIN_TILE_SIZE, iz * TERRAIN_TILE_SIZE],
    cols: TERRAIN_TILE_SAMPLES,
    rows: TERRAIN_TILE_SAMPLES,
    spacing: TERRAIN_TILE_SPACING,
    step,
  })
  sampleAuthority(field, authority)
  for (let row = 0; row < field.rows; row++) {
    for (let col = 0; col < field.cols; col++) {
      const value = changed.get(
        `${field.origin[0] + col * field.spacing},${field.origin[1] + row * field.spacing}`,
      )
      if (value !== undefined) field.heights[row * field.cols + col] = quantize(field, value)
    }
  }
  return field
}

/** Seed only touched tiles from the pre-edit authority, then mirror changed edge posts.
 * Off-lattice legacy ground is sampled, not rewritten; untouched points within
 * a seeded tile can change through quantization and triangle resampling. */
export function planTerrainTileWrites(
  site: SiteNode,
  nodes: TerrainNodes,
  before: TerrainField,
  after: TerrainField,
): TerrainTileWrites {
  validateEditFields(before, after)
  const writes: TerrainTileWrites = { creates: [], updates: [] }
  const { changed, tiles } = changedSamples(before, after)
  if (changed.size === 0) return writes
  const authority = persistedTerrainFieldOf(site, nodes)
  const existing = terrainTilesOf(site, nodes)
  const ordered = [...tiles.values()].sort(
    (left, right) => left.ix - right.ix || left.iz - right.iz,
  )
  for (const { ix, iz } of ordered) {
    const field = editedTileField(ix, iz, after.step, authority, changed)
    const heights = encodeTerrainField(field).heights
    const owners = existing.filter((tile) => tile.ix === ix && tile.iz === iz)
    if (owners.length === 0)
      writes.creates.push(
        TerrainTileNode.parse({
          parentId: site.id,
          ix,
          iz,
          step: field.step,
          heights,
        }),
      )
    else
      for (const owner of owners) {
        if (owner.heights !== heights || owner.step !== field.step) {
          writes.updates.push({ id: owner.id, heights, step: field.step })
        }
      }
  }
  return writes
}
