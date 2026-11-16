import {
  createTerrainField,
  decodeTerrainField,
  heightAt,
  normalAt,
  type Ring,
  type SiteNode,
  TERRAIN_TILE_SIZE,
  type TerrainField,
  type TerrainTileNode,
  tileFieldOf,
} from '@pascal-app/core'
import { rampCutFaces } from './ramp-cut-faces'
import type { RampGroundCut } from './ramp-ground-holes'
import {
  splitTerrainBreaks,
  updateSmoothTerrainBreakSurface,
  updateTerrainBreakSurface,
} from './terrain-break-split'
import { buildTerrainMesh, type TerrainMeshBuffers } from './terrain-geometry'
import { cutTerrainHoles } from './terrain-holes'

export type TerrainGroundPatch = { key: string; grid: TerrainField; holes: Ring[] }
export type TerrainGroundBounds = { minX: number; minZ: number; maxX: number; maxZ: number }

const MAX_CONTINUATION_PATCHES = 256

export function terrainGridBoundary(field: TerrainField): Ring {
  const [x, z] = field.origin
  const maxX = x + (field.cols - 1) * field.spacing
  const maxZ = z + (field.rows - 1) * field.spacing
  return [
    [x, z],
    [maxX, z],
    [maxX, maxZ],
    [x, maxZ],
  ]
}

export function needsTerrainContinuation(site: SiteNode): boolean {
  const base = decodeTerrainField(site.terrain)
  if (!base) return false
  const [x, z] = base.origin
  const maxX = x + (base.cols - 1) * base.spacing
  const maxZ = z + (base.rows - 1) * base.spacing
  return site.polygon.points.some(([px, pz]) => px < x || px > maxX || pz < z || pz > maxZ)
}

/** Legacy keeps its own triangulation; only the land beyond it gets a new grid. */
export function terrainGroundPatches(
  site: SiteNode,
  tiles: readonly TerrainTileNode[],
): TerrainGroundPatch[] {
  const base = decodeTerrainField(site.terrain)
  const tileGrids = tiles.flatMap((tile) => {
    const grid = tileFieldOf(tile)
    return grid ? [grid] : []
  })
  const tileHoles = tileGrids.map(terrainGridBoundary)
  const patches: TerrainGroundPatch[] = base
    ? [{ key: 'legacy', grid: base, holes: tileHoles }]
    : []
  const points = site.polygon.points
  if (!points.length) return patches
  const minX = Math.min(...points.map(([x]) => x))
  const maxX = Math.max(...points.map(([x]) => x))
  const minZ = Math.min(...points.map(([, z]) => z))
  const maxZ = Math.max(...points.map(([, z]) => z))
  const holes = base ? [terrainGridBoundary(base), ...tileHoles] : tileHoles
  const firstX = Math.floor(minX / TERRAIN_TILE_SIZE)
  const firstZ = Math.floor(minZ / TERRAIN_TILE_SIZE)
  const lastX = Math.ceil(maxX / TERRAIN_TILE_SIZE)
  const lastZ = Math.ceil(maxZ / TERRAIN_TILE_SIZE)
  if ((lastX - firstX) * (lastZ - firstZ) > MAX_CONTINUATION_PATCHES) {
    // Render-only fallback: authored geometry stays exact; huge empty context
    // must not allocate a dense half-metre mesh merely because the lot grew.
    const grid = createTerrainField({
      origin: [minX, minZ],
      spacing: Math.max(0.5, (maxX - minX) / 64, (maxZ - minZ) / 64),
    })
    return [...patches, { key: 'continuation:coarse', grid, holes }]
  }
  for (let iz = firstZ; iz < lastZ; iz++) {
    for (let ix = firstX; ix < lastX; ix++) {
      if (tiles.some((tile) => tile.ix === ix && tile.iz === iz)) continue
      const grid = createTerrainField({ origin: [ix * TERRAIN_TILE_SIZE, iz * TERRAIN_TILE_SIZE] })
      if (base && gridInside(grid, base)) continue
      patches.push({ key: `continuation:${ix}:${iz}`, grid, holes })
    }
  }
  return patches
}

function gridInside(grid: TerrainField, outer: TerrainField): boolean {
  return grid.origin.every((value, axis) => {
    const origin = outer.origin[axis] ?? 0
    const count = axis === 0 ? outer.cols : outer.rows
    const size = axis === 0 ? grid.cols : grid.rows
    return (
      value >= origin && value + (size - 1) * grid.spacing <= origin + (count - 1) * outer.spacing
    )
  })
}

/**
 * The rectangle a live edit field covers, `halo` wider. Outside it a preview is the persisted
 * ground itself, so the start and the end of a stroke change nothing there.
 */
export function terrainFieldBounds(field: TerrainField, halo: number): TerrainGroundBounds {
  return {
    minX: field.origin[0] - halo,
    minZ: field.origin[1] - halo,
    maxX: field.origin[0] + (field.cols - 1) * field.spacing + halo,
    maxZ: field.origin[1] + (field.rows - 1) * field.spacing + halo,
  }
}

/**
 * Whether a mesh can hold a vertex within `reach` of the rectangle: its bounding sphere, in plan.
 * A site of 256 tiles asks every one of them on every dab; all but one or two answer from here.
 */
export function groundMeshInReach(
  sphere: { center: { x: number; z: number }; radius: number } | null,
  bounds: TerrainGroundBounds,
  reach: number,
): boolean {
  if (!sphere || !Number.isFinite(sphere.radius)) return true
  const dx = Math.max(bounds.minX - sphere.center.x, 0, sphere.center.x - bounds.maxX)
  const dz = Math.max(bounds.minZ - sphere.center.z, 0, sphere.center.z - bounds.maxZ)
  return Math.hypot(dx, dz) <= sphere.radius + reach
}

/** All patches read the same world-space authority, including their shared rim. */
export function updateTerrainGroundMesh(
  buffers: TerrainMeshBuffers,
  field: TerrainField,
  bounds?: TerrainGroundBounds,
): { start: number; count: number } | null {
  if (buffers.terrainBreakSides) {
    if (buffers.terrainBreakGround === 'smooth')
      return updateSmoothTerrainBreakSurface(buffers, field, bounds)
    updateTerrainBreakSurface(buffers, field)
    return { start: 0, count: buffers.positions.length }
  }
  let start = buffers.positions.length
  let end = 0
  // Closing faces stand on heights of their own; a live stroke reads the ground, not them.
  const limit = buffers.fixedFrom === undefined ? buffers.positions.length : buffers.fixedFrom * 3
  for (let i = 0; i < limit; i += 3) {
    const x = buffers.positions[i] ?? 0
    const z = buffers.positions[i + 2] ?? 0
    if (bounds && (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ)) {
      continue
    }
    buffers.positions[i + 1] = heightAt(field, x, z)
    buffers.normals.set(normalAt(field, x, z), i)
    start = Math.min(start, i)
    end = i + 3
  }
  return end > start ? { start, count: end - start } : null
}

/** Fold cut-edge vertices into the surface so each tile is one CPU mesh. */
export function buildTerrainGroundMesh(
  grid: TerrainField,
  field: TerrainField,
  holes: Ring[] = [],
  cuts: readonly RampGroundCut[] = [],
): TerrainMeshBuffers {
  const buffers = buildTerrainMesh(grid)
  const boundary = cutTerrainHoles(buffers, holes)
  if (boundary) {
    const offset = buffers.positions.length / 3
    for (const [key, name] of [
      ['positions', 'position'],
      ['normals', 'normal'],
      ['uvs', 'uv'],
    ] as const) {
      const extra = boundary.geometry.getAttribute(name).array
      const merged = new Float32Array(buffers[key].length + extra.length)
      merged.set(buffers[key])
      merged.set(extra, buffers[key].length)
      buffers[key] = merged
    }
    const extra = boundary.geometry.index?.array ?? []
    const indices = new Uint32Array(buffers.indices.length + extra.length)
    indices.set(buffers.indices)
    for (let i = 0; i < extra.length; i++) {
      indices[buffers.indices.length + i] = offset + (extra[i] ?? 0)
    }
    buffers.indices = indices
    boundary.geometry.dispose()
  }
  const split = splitTerrainBreaks(buffers, field)
  if (split === buffers) updateTerrainGroundMesh(buffers, field)
  const faces = boundary && cuts.length ? rampCutFaces(boundary, cuts, field) : null
  return faces ? withFaces(split, faces) : split
}

/** The cut faces after the ground's own vertices, which a live stroke leaves alone. */
function withFaces(
  ground: TerrainMeshBuffers,
  faces: ReturnType<typeof rampCutFaces> & object,
): TerrainMeshBuffers {
  const offset = ground.positions.length / 3
  const join = <T extends Float32Array>(a: T, b: Float32Array) => {
    const joined = new Float32Array(a.length + b.length)
    joined.set(a)
    joined.set(b, a.length)
    return joined
  }
  const indices = new Uint32Array(ground.indices.length + faces.indices.length)
  indices.set(ground.indices)
  for (let i = 0; i < faces.indices.length; i++)
    indices[ground.indices.length + i] = offset + (faces.indices[i] ?? 0)
  return {
    ...ground,
    positions: join(ground.positions, faces.positions),
    normals: join(ground.normals, faces.normals),
    uvs: join(ground.uvs, faces.uvs),
    indices,
    fixedFrom: offset,
  }
}
