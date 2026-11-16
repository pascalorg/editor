import type { SiteNode } from '../schema/nodes/site'
import { DEFAULT_TERRAIN_SPACING } from './terrain-field'

/**
 * Field sizes we allow, all `2ⁿ+1` so a future LOD halving lands on existing
 * samples instead of interpolating a seam.
 */
const FIELD_SIZES = [33, 65, 129, 257] as const

/**
 * Sample count a fresh field gets, chosen to cover the site polygon at roughly
 * `DEFAULT_TERRAIN_SPACING` and never exceeding 257² (66 049 samples — about
 * four furnished rooms' worth of vertices).
 *
 * Sizing from the polygon rather than a fixed extent matters because the extent
 * is baked at creation: the field is the ground for the whole session, and a
 * grid that stops short of the lot line leaves a visible cliff where the terrain
 * mesh ends and the flat fill resumes. Padding by one spacing keeps the boundary
 * line itself on interpolated ground rather than on the clamped edge row.
 */
export function fieldExtentForSite(site: Pick<SiteNode, 'polygon'> | null | undefined): {
  origin: [number, number]
  cols: number
  rows: number
  spacing: number
} {
  const points = site?.polygon?.points ?? []
  if (points.length < 3) {
    const half = ((65 - 1) / 2) * DEFAULT_TERRAIN_SPACING
    return { origin: [-half, -half], cols: 65, rows: 65, spacing: DEFAULT_TERRAIN_SPACING }
  }

  let minX = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const [x, z] of points) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }

  // The grid is square: a rectangular field would need two spacings or two
  // sample counts, and both make every downstream index calculation branchier
  // for no visual gain.
  const pad = DEFAULT_TERRAIN_SPACING * 2
  const span = Math.max(maxX - minX, maxZ - minZ) + pad * 2
  const centerX = (minX + maxX) / 2
  const centerZ = (minZ + maxZ) / 2

  const wanted = Math.ceil(span / DEFAULT_TERRAIN_SPACING) + 1
  const size = FIELD_SIZES.find((candidate) => candidate >= wanted) ?? FIELD_SIZES.at(-1)!
  // Spacing stretches when the lot is bigger than 257 samples can cover at the
  // default: coarser ground beats ground that stops at the property line.
  const spacing = Math.max(DEFAULT_TERRAIN_SPACING, span / (size - 1))
  const half = ((size - 1) / 2) * spacing

  return {
    origin: [centerX - half, centerZ - half],
    cols: size,
    rows: size,
    spacing,
  }
}
