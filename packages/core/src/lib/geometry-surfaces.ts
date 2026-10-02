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

/**
 * Where a ceiling item hangs from an authored object above local (x, z): the
 * lowest underside over the point (a beam before the vault plane above it),
 * with its height there — sloped undersides included. Null when none is over it.
 */
export function geometryUndersideAt(
  manifest: Pick<GeometryArtifactManifest, 'undersides'>,
  x: number,
  z: number,
): { part?: string; y: number; normal: [number, number, number] } | null {
  let best: { part?: string; y: number; normal: [number, number, number] } | null = null
  for (const underside of manifest.undersides) {
    const [a, b, c, d] = underside.plane
    if (b === 0 || !contains(underside.polygon, x, z)) continue
    const y = -(a * x + c * z + d) / b
    if (!best || y < best.y) best = { part: underside.part, y, normal: [a, b, c] }
  }
  return best
}

/**
 * The rotation that seats a flush fixture (a recessed can) on a sloped
 * underside: its +Y goes into the surface, against the downward `normal`,
 * then it keeps its own turn `yaw`. Euler XYZ, as items store rotation.
 */
export function flushMountRotation(
  normal: readonly [number, number, number],
  yaw: number,
): [number, number, number] {
  // Quaternion turning +Y onto -normal (the direction into the surface).
  const [vx, vy, vz] = [-normal[0], -normal[1], -normal[2]]
  let [qx, qy, qz, qw] = [vz, 0, -vx, 1 + vy]
  const length = Math.hypot(qx, qy, qz, qw) || 1
  ;[qx, qy, qz, qw] = [qx / length, qy / length, qz / length, qw / length]
  // Then the fixture's own yaw about its local +Y.
  const [sy, cy] = [Math.sin(yaw / 2), Math.cos(yaw / 2)]
  const [x, y, z, w] = [qx * cy - qz * sy, qw * sy + qy * cy, qz * cy + qx * sy, qw * cy - qy * sy]
  const m11 = 1 - 2 * (y * y + z * z)
  const m12 = 2 * (x * y - w * z)
  const m13 = 2 * (x * z + w * y)
  const m22 = 1 - 2 * (x * x + z * z)
  const m23 = 2 * (y * z - w * x)
  const m32 = 2 * (y * z + w * x)
  const m33 = 1 - 2 * (x * x + y * y)
  const ry = Math.asin(Math.max(-1, Math.min(1, m13)))
  return Math.abs(m13) < 0.9999999
    ? [Math.atan2(-m23, m33), ry, Math.atan2(-m12, m11)]
    : [Math.atan2(m32, m22), ry, 0]
}

/** At or under this height a ceiling fixture mounts flush (a can, a surface light) rather than hangs. */
const FLUSH_MOUNT_MAX_HEIGHT = 0.15

/**
 * Whether a ceiling fixture sits flush on a surface (tilting with a slope)
 * rather than hanging plumb: flagged `recessed`, or shallow enough that it
 * can only be a can or a surface light (catalog data often lacks the flag).
 */
export function mountsFlush(asset: {
  recessed?: boolean
  dimensions?: readonly number[]
}): boolean {
  return Boolean(asset.recessed) || (asset.dimensions?.[1] ?? 1) <= FLUSH_MOUNT_MAX_HEIGHT
}
