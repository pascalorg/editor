import type { AnyNode, CeilingNode } from '../schema'
import type { SurfacePaintRegion } from '../schema/nodes/surface-paint-region'
import {
  area,
  difference,
  intersection,
  type MultiPolygon,
  type Ring,
  union,
} from './polygon-boolean'

/**
 * Who paints which part of a ceiling's underside. A ceiling draws its own
 * finish (`slots.surface`) except where a paint region covers it; regions later
 * in the list win. An automatic ceiling is rebuilt from its room, so the room
 * holds its regions (`zone.ceiling.regions`); a manual ceiling holds its own
 * (`ceiling.regions`). Pure 2D in level XZ — the renderer triangulates the
 * cells, the paint path reads the roles.
 */

export const CEILING_SURFACE_ROLE = 'surface'
const MIN_CELL_AREA = 1e-6

export function ceilingRegionRole(regionId: string): string {
  return `region:${regionId}`
}

export function parseCeilingRegionRole(role: string): string | null {
  return role.startsWith('region:') && role.length > 'region:'.length
    ? role.slice('region:'.length)
    : null
}

/** Whether a ceiling's regions live on its room (an automatic ceiling) rather than on itself. */
export function ceilingRegionsOwner(
  ceiling: Pick<CeilingNode, 'id' | 'boundary' | 'zoneId'>,
): { kind: 'zone'; id: string } | { kind: 'ceiling'; id: string } {
  return ceiling.boundary === 'auto' && ceiling.zoneId
    ? { kind: 'zone', id: ceiling.zoneId }
    : { kind: 'ceiling', id: ceiling.id }
}

/** The paint regions a ceiling draws: its room's for an automatic ceiling, its own otherwise. */
export function ceilingPaintRegions(
  ceiling: Pick<CeilingNode, 'id' | 'boundary' | 'zoneId' | 'regions'>,
  nodes: Readonly<Record<string, AnyNode | undefined>>,
): readonly SurfacePaintRegion[] {
  const owner = ceilingRegionsOwner(ceiling)
  if (owner.kind === 'ceiling') return ceiling.regions ?? []
  const zone = nodes[owner.id]
  return zone?.type === 'zone' ? (zone.ceiling?.regions ?? []) : []
}

export type CeilingSurfaceCell = {
  /** `surface` (the ceiling's own finish) or `region:<id>`. */
  role: string
  /** The region's finish; absent for the ceiling's own `surface`. */
  finish?: SurfacePaintRegion['finish']
  polygons: MultiPolygon
}

/**
 * Disjoint cells covering the ceiling (outline minus `holes`): each region
 * takes what the later ones left, and `surface` is the rest. Regions that miss
 * the ceiling produce no cell.
 */
export function computeCeilingSurfaceCells(
  outline: readonly [number, number][],
  holes: readonly (readonly [number, number][])[],
  regions: readonly SurfacePaintRegion[],
): CeilingSurfaceCell[] {
  const surface: MultiPolygon = [
    {
      outer: outline.map(([x, z]) => [x, z]) as Ring,
      holes: holes.map((hole) => [...hole] as Ring),
    },
  ]
  let remaining = holes.length ? union([surface]) : surface
  const cells: CeilingSurfaceCell[] = []
  for (let index = regions.length - 1; index >= 0; index -= 1) {
    const region = regions[index]!
    if (region.polygon.length < 3 || !remaining.length) continue
    const part = intersection(union([region.polygon as Ring]), remaining)
    if (area(part) < MIN_CELL_AREA) continue
    cells.push({ role: ceilingRegionRole(region.id), finish: region.finish, polygons: part })
    remaining = difference(remaining, part)
  }
  if (area(remaining) >= MIN_CELL_AREA)
    cells.push({ role: CEILING_SURFACE_ROLE, polygons: remaining })
  return cells.reverse()
}

/** What the partition of one ceiling depends on — its outline, holes and regions. */
export function ceilingSurfaceSignature(
  ceiling: Pick<CeilingNode, 'polygon' | 'holes'>,
  regions: readonly SurfacePaintRegion[],
): string {
  return JSON.stringify([ceiling.polygon, ceiling.holes ?? [], regions])
}
