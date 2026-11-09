import { BucketIndex, bakeGrid, cellOf, cellX, cellZ, type Grid, makeGrid } from './field'
import { type Aabb, type Band, type Obstacle, obstaclesInBand } from './obstacles'
import type { FloorRegion, Prism, Ring, UsageShapes } from './types'

/** A body in the height range a person's trunk and legs fill, and in the range a wheelchair's feet and wheels do. */
export const BODY_BAND = { from: 0.03, to: 2.0 } as const
export const FEET_BAND = { from: 0.03, to: 0.7 } as const

export type FloorGroup = {
  levelId: string
  /** Absolute height of the finished floor. */
  y: number
  regions: FloorRegion[]
  domain: Aabb
}

/** Regions of one level at one finished height share a field; a step or a porch deck is a group of its own. */
export function floorGroups(shapes: UsageShapes): FloorGroup[] {
  const groups: FloorGroup[] = []
  for (const level of shapes.levels) {
    const byHeight = new Map<number, FloorRegion[]>()
    for (const region of level.floors) {
      const key = Math.round(region.y * 200) / 200
      byHeight.set(key, [...(byHeight.get(key) ?? []), region])
    }
    for (const [y, regions] of byHeight) {
      let x0 = Number.POSITIVE_INFINITY
      let z0 = Number.POSITIVE_INFINITY
      let x1 = Number.NEGATIVE_INFINITY
      let z1 = Number.NEGATIVE_INFINITY
      for (const region of regions)
        for (const [x, z] of region.outer) {
          x0 = Math.min(x0, x)
          x1 = Math.max(x1, x)
          z0 = Math.min(z0, z)
          z1 = Math.max(z1, z)
        }
      groups.push({
        levelId: level.levelId,
        y,
        regions,
        domain: [x0 - 0.05, z0 - 0.05, x1 + 0.05, z1 + 0.05],
      })
    }
  }
  return groups
}

export function inRing(px: number, pz: number, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!
    const b = ring[j]!
    if (a[1] > pz !== b[1] > pz && px < ((b[0] - a[0]) * (pz - a[1])) / (b[1] - a[1]) + a[0])
      inside = !inside
  }
  return inside
}

export const inRegion = (px: number, pz: number, region: Pick<FloorRegion, 'outer' | 'holes'>) =>
  inRing(px, pz, region.outer) && !region.holes.some((hole) => inRing(px, pz, hole))

/** The cells whose centre lies in any of the rings (holes excluded), as a 0/1 mask. */
export function maskOf(g: Grid, regions: Pick<FloorRegion, 'outer' | 'holes'>[]): Uint8Array {
  const mask = new Uint8Array(g.W * g.H)
  for (const region of regions) {
    let x0 = Number.POSITIVE_INFINITY
    let z0 = Number.POSITIVE_INFINITY
    let x1 = Number.NEGATIVE_INFINITY
    let z1 = Number.NEGATIVE_INFINITY
    for (const [x, z] of region.outer) {
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      z0 = Math.min(z0, z)
      z1 = Math.max(z1, z)
    }
    const i0 = Math.max(0, Math.floor((x0 - g.x0) / g.h))
    const i1 = Math.min(g.W - 1, Math.ceil((x1 - g.x0) / g.h))
    const j0 = Math.max(0, Math.floor((z0 - g.z0) / g.h))
    const j1 = Math.min(g.H - 1, Math.ceil((z1 - g.z0) / g.h))
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++)
        if (inRegion(cellX(g, i), cellZ(g, j), region)) mask[j * g.W + i] = 1
  }
  return mask
}

export type LevelField = {
  group: FloorGroup
  band: Band
  grid: Grid
  /** Signed distance to the nearest obstacle in the band, at every cell centre. */
  F: Float32Array
  A: Int32Array
  /** 1 where a person can stand on the floor, whatever is on it. */
  floor: Uint8Array
  /** 1 where the floor is free: on it, and clear of every obstacle. */
  free: Uint8Array
  obstacles: Obstacle[]
  index: BucketIndex
}

/** What a body of a band bumps into above one floor group: every prism of the building meeting it, stairs included. */
export function buildField(
  shapes: UsageShapes,
  group: FloorGroup,
  range: { from: number; to: number },
  cell: number,
  skip?: (prism: Prism) => boolean,
  extra: Prism[] = [],
): LevelField {
  const band: Band = { z0: group.y + range.from, z1: group.y + range.to }
  const obstacles = obstaclesInBand(
    [...shapes.levels.flatMap((level) => level.prisms), ...extra],
    band,
    group.domain,
    skip,
  )
  const grid = makeGrid(group.domain, cell)
  const { F, A } = bakeGrid(grid, obstacles)
  const floor = maskOf(grid, group.regions)
  const free = new Uint8Array(floor.length)
  for (let c = 0; c < free.length; c++) free[c] = floor[c] && F[c]! > 0 ? 1 : 0
  return {
    group,
    band,
    grid,
    F,
    A,
    floor,
    free,
    obstacles,
    index: new BucketIndex(obstacles, group.domain),
  }
}

/** The cell under a plan point, or -1 off the field. */
export const fieldCell = (field: LevelField, x: number, z: number) => cellOf(field.grid, x, z)
