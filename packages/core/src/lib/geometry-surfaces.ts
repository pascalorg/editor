import type { GeometryArtifactManifest } from '../schema/geometry-source'

type Surface = GeometryArtifactManifest['surfaces'][number]
type Manifest = Pick<GeometryArtifactManifest, 'surfaces' | 'parts'>

/** Part types whose tops shelter rather than hold: nothing is placed on a porch roof. */
const SHELTER_TYPES = new Set(['roof', 'canopy', 'awning', 'ceiling'])

function receives(manifest: Manifest, surface: Surface): boolean {
  if (!surface.part) return true
  const type = manifest.parts.find((part) => part.id === surface.part)?.type
  return !(type && SHELTER_TYPES.has(type))
}

function contains(polygon: [number, number][], x: number, z: number): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i]!
    const [xj, zj] = polygon[j]!
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

function area(polygon: [number, number][]): number {
  let sum = 0
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    sum += (polygon[j]![0] + polygon[i]![0]) * (polygon[j]![1] - polygon[i]![1])
  }
  return Math.abs(sum) / 2
}

/** Non-roof surfaces covering at least half the object's footprint: its landing, its top. */
function mainSurfaces(manifest: Manifest & Pick<GeometryArtifactManifest, 'bounds'>): Surface[] {
  const { min, max } = manifest.bounds
  const footprint = (max[0] - min[0]) * (max[2] - min[2])
  return manifest.surfaces.filter(
    (surface) => receives(manifest, surface) && area(surface.polygon) >= footprint / 2,
  )
}

const highest = (surfaces: Surface[]) =>
  surfaces.reduce<Surface | null>((best, s) => (!best || s.y > best.y ? s : best), null)

/**
 * Where something dropped at local (x, z) comes to rest on an authored
 * object: its main surface when the point is over it (a bench anywhere on a
 * porch lands on the landing, not on the beam), otherwise the highest
 * non-roof surface under the point. `maxY` caps the search. Null when
 * nothing is under the point.
 */
export function geometrySurfaceAt(
  manifest: Manifest & Pick<GeometryArtifactManifest, 'bounds'>,
  x: number,
  z: number,
  maxY = Number.POSITIVE_INFINITY,
): Surface | null {
  const under = (surface: Surface) => surface.y <= maxY && contains(surface.polygon, x, z)
  return (
    highest(mainSurfaces(manifest).filter(under)) ??
    highest(manifest.surfaces.filter((s) => receives(manifest, s) && under(s)))
  )
}

/**
 * The one height an authored object offers as "where things rest" (the
 * item's `asset.surface`): its highest main surface, so a porch rests things
 * on its landing and a table on its top. Null when it has none.
 */
export function geometryRestingHeight(
  manifest: Manifest & Pick<GeometryArtifactManifest, 'bounds'>,
): number | null {
  return highest(mainSurfaces(manifest))?.y ?? null
}
