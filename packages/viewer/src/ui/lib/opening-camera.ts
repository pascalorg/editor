import type { AnyNode } from '@pascal-app/core'

type Vec3 = [number, number, number]

export type OpeningCameraPose = { position: Vec3; target: Vec3; fov?: number }

// The viewer camera's far plane is 1000 m; a pose beyond it frames nothing.
const MAX_COORDINATE = 1000
const MIN_FOV = 10
const MAX_FOV = 120

/**
 * Reads `?camera=`: `px,py,pz,tx,ty,tz[,fov]` in scene metres and degrees, or
 * `saved` for the view saved on the scene. Anything else is null, so a
 * malformed link opens on the default view instead of a broken one.
 */
export function parseOpeningCamera(raw: string | null): OpeningCameraPose | 'saved' | null {
  if (raw === 'saved') return 'saved'
  const parts = raw?.split(',') ?? []
  if (parts.length !== 6 && parts.length !== 7) return null
  if (parts.some((part) => part.trim() === '')) return null
  const values = parts.map(Number)
  const [px, py, pz, tx, ty, tz, fov] = values as [
    number,
    number,
    number,
    number,
    number,
    number,
    number | undefined,
  ]
  if (values.slice(0, 6).some((value) => !(Math.abs(value) <= MAX_COORDINATE))) return null
  if (Math.hypot(px - tx, py - ty, pz - tz) < 0.01) return null
  const pose: OpeningCameraPose = { position: [px, py, pz], target: [tx, ty, tz] }
  if (fov === undefined) return pose
  if (!(fov >= MIN_FOV && fov <= MAX_FOV)) return null
  return { ...pose, fov }
}

/**
 * The view saved on the scene: the camera captured on the site in the editor,
 * else the one on the building. Both viewer paths already open near it by
 * default, but they disagree on which node wins (the parametric viewer reads
 * the site, the baked one the building); `camera=saved` pins one rule.
 */
export function savedSceneCamera(
  nodes: Readonly<Record<string, AnyNode>>,
): OpeningCameraPose | null {
  const all = Object.values(nodes)
  const saved =
    all.find((node) => node.type === 'site')?.camera ??
    all.find((node) => node.type === 'building')?.camera
  return saved ? { position: saved.position, target: saved.target } : null
}
