import { sceneRegistry, useScene } from '@pascal-app/core'
import { Box3, type Object3D, Vector3 } from 'three'

export const DEFAULT_FRAMING_EXCLUDED_TYPES = ['site', 'scan', 'guide', 'spawn'] as const

export function heroCameraPose({
  boxes,
  aspect,
  aim,
  fovDeg = 60,
  azimuthRad = Math.PI / 4,
  elevationRad = (13 * Math.PI) / 180,
  padding = 1.03,
  minDistance = 4,
  frameShift = 0,
  tightFit = false,
}: {
  boxes: Box3 | readonly Box3[]
  aspect: number
  /** Where the camera looks (frame center). Defaults to the union-box center;
   *  pass the building's center to keep it dead-center while outlying boxes
   *  (lot plate, far palms) simply take asymmetric margin — the corner fit
   *  still guarantees every box stays in frame. */
  aim?: [number, number, number]
  fovDeg?: number
  azimuthRad?: number
  elevationRad?: number
  padding?: number
  minDistance?: number
  /** Fraction of the frustum half-height to drop the aim by. 0 keeps the aim
   *  (the building center) exactly at frame center. */
  frameShift?: number
  /** Fit the PROJECTED extents instead of a symmetric fit around `aim`: the
   *  aim may drift off-center so the subject fills the frame. A symmetric fit
   *  pins the nearest corner to one edge and leaves the far side empty, since
   *  far corners project smaller. */
  tightFit?: boolean
}): {
  position: [number, number, number]
  target: [number, number, number]
} {
  const list = Array.isArray(boxes) ? (boxes as readonly Box3[]) : [boxes as Box3]
  const union = new Box3()
  for (const box of list) union.union(box)
  const center = aim ? new Vector3(aim[0], aim[1], aim[2]) : union.getCenter(new Vector3())
  const tanVertical = Math.tan(((fovDeg / 2) * Math.PI) / 180)
  const tanHorizontal = tanVertical * aspect

  // Camera basis for the chosen azimuth/elevation: `dir` points from the
  // target toward the camera, `forward` is the view direction.
  const dir = new Vector3(
    Math.sin(azimuthRad) * Math.cos(elevationRad),
    Math.sin(elevationRad),
    Math.cos(azimuthRad) * Math.cos(elevationRad),
  )
  const forward = dir.clone().negate()
  const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize()
  const up = new Vector3().crossVectors(right, forward)

  // Exact fit: for every corner of every per-node box, the minimal camera
  // distance along `dir` that keeps it inside the frustum. Fitting the corners
  // of the UNION box instead reads far too wide at a diagonal azimuth — the
  // union AABB's extreme corners are the empty diamond tips nothing actually
  // occupies. (A bounding-sphere fit is worse still for flat, spread scenes.)
  const corner = new Vector3()
  const offset = new Vector3()
  let distance = minDistance
  for (const box of list) {
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          corner.set(x, y, z)
          offset.subVectors(corner, center)
          const lateral = offset.dot(right)
          const vertical = offset.dot(up)
          const depth = offset.dot(forward)
          distance = Math.max(
            distance,
            (Math.abs(lateral) / tanHorizontal - depth) * padding,
            (Math.abs(vertical) / tanVertical - depth) * padding,
          )
        }
      }
    }
  }

  if (tightFit) {
    // Every corner as (lateral, vertical, depth) around `center`. For a camera
    // distance d, a shift (sx, sy) of aim+camera along right/up keeps a corner
    // in frame iff |lateral − sx| ≤ tanH·(d + depth) (same vertically), so each
    // corner bounds the feasible shift window; the tightest d whose windows
    // still intersect is the fit, bisected from the symmetric distance.
    const samples: [number, number, number][] = []
    for (const box of list) {
      for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
          for (const z of [box.min.z, box.max.z]) {
            offset.subVectors(corner.set(x, y, z), center)
            samples.push([offset.dot(right), offset.dot(up), offset.dot(forward)])
          }
        }
      }
    }
    const tanH = tanHorizontal / padding
    const tanV = tanVertical / padding
    const shiftWindow = (d: number) => {
      let loX = Number.NEGATIVE_INFINITY
      let hiX = Number.POSITIVE_INFINITY
      let loY = Number.NEGATIVE_INFINITY
      let hiY = Number.POSITIVE_INFINITY
      for (const [lateral, vertical, depth] of samples) {
        const z = d + depth
        if (z <= 0.1) return null
        loX = Math.max(loX, lateral - tanH * z)
        hiX = Math.min(hiX, lateral + tanH * z)
        loY = Math.max(loY, vertical - tanV * z)
        hiY = Math.min(hiY, vertical + tanV * z)
      }
      return loX <= hiX && loY <= hiY ? { sx: (loX + hiX) / 2, sy: (loY + hiY) / 2 } : null
    }
    let lo = minDistance
    let hi = distance
    while (!shiftWindow(hi)) hi *= 1.5
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2
      if (shiftWindow(mid)) hi = mid
      else lo = mid
    }
    const shift = shiftWindow(hi)!
    const target = center
      .clone()
      .addScaledVector(right, shift.sx)
      .addScaledVector(up, shift.sy - frameShift * hi * tanVertical)
    return {
      position: [target.x + dir.x * hi, target.y + dir.y * hi, target.z + dir.z * hi],
      target: [target.x, target.y, target.z],
    }
  }

  // Reframe: slide aim and camera together along the view-up axis — pure
  // composition shift, no perspective change.
  const drop = up.clone().multiplyScalar(-frameShift * distance * tanVertical)
  const target = center.clone().add(drop)

  return {
    position: [
      target.x + dir.x * distance,
      target.y + dir.y * distance,
      target.z + dir.z * distance,
    ],
    target: [target.x, target.y, target.z],
  }
}

export function unionRegisteredNodeBounds({
  excludeTypes,
}: {
  excludeTypes: readonly string[]
}): Box3 | null {
  const excluded = new Set(excludeTypes)
  const result = new Box3()

  for (const [type, ids] of Object.entries(sceneRegistry.byType)) {
    if (excluded.has(type)) continue

    for (const id of ids) {
      const object = sceneRegistry.nodes.get(id)
      if (!object) continue
      const bounds = new Box3().setFromObject(object)
      if (!bounds.isEmpty()) result.union(bounds)
    }
  }

  return result.isEmpty() ? null : result
}

function perNodeBoxes(excludeTypes: readonly string[]): Box3[] {
  const excluded = new Set(excludeTypes)
  const boxes: Box3[] = []
  for (const [type, ids] of Object.entries(sceneRegistry.byType)) {
    if (excluded.has(type)) continue
    for (const id of ids) {
      const object = sceneRegistry.nodes.get(id)
      if (!object) continue
      const bounds = new Box3().setFromObject(object)
      if (!bounds.isEmpty()) boxes.push(bounds)
    }
  }
  return boxes
}

/**
 * Matches the `SiteNode` bootstrap polygon (a 30×30 square at the origin) —
 * same rule as the editor's `computeSceneBoundsXZ`: an untouched default lot
 * says nothing about the user's intent, so it shouldn't drive framing.
 */
function isDefaultSitePolygon(points: unknown[]): boolean {
  if (points.length !== 4) return false
  const expected: [number, number][] = [
    [-15, -15],
    [15, -15],
    [15, 15],
    [-15, 15],
  ]
  for (let i = 0; i < 4; i++) {
    const p = points[i]
    const e = expected[i]!
    if (!Array.isArray(p) || p.length < 2) return false
    if (p[0] !== e[0] || p[1] !== e[1]) return false
  }
  return true
}

/** Flat boxes for intentionally-shaped site plates, from scene DATA — the
 *  site's Object3D can't be measured (it carries the ±400 m horizon disc). */
function sitePlateBoxes(): Box3[] {
  const boxes: Box3[] = []
  for (const node of Object.values(useScene.getState().nodes)) {
    if ((node as { type?: string }).type !== 'site') continue
    const polygon = (node as { polygon?: { points?: unknown[] } }).polygon
    const points = polygon?.points
    if (!Array.isArray(points) || isDefaultSitePolygon(points)) continue
    const box = new Box3()
    for (const point of points) {
      if (Array.isArray(point) && point.length >= 2) {
        box.expandByPoint(new Vector3(Number(point[0]), 0, Number(point[1])))
      }
    }
    if (!box.isEmpty()) boxes.push(box)
  }
  return boxes
}

/** Dominant wall direction folded to a 90°-periodic axis (length-weighted
 *  vector sum of 4θ), so the hero azimuth sits at a true 45° to the building's
 *  facades no matter how the user rotated their plan. */
function dominantWallYaw(): number | null {
  let vx = 0
  let vz = 0
  for (const node of Object.values(useScene.getState().nodes)) {
    if ((node as { type?: string }).type !== 'wall') continue
    const { start, end } = node as { start?: unknown; end?: unknown }
    if (!(Array.isArray(start) && Array.isArray(end))) continue
    const dx = Number(end[0]) - Number(start[0])
    const dz = Number(end[1]) - Number(start[1])
    const length = Math.hypot(dx, dz)
    if (!(Number.isFinite(length) && length > 0.01)) continue
    const theta = Math.atan2(dz, dx)
    vx += length * Math.cos(4 * theta)
    vz += length * Math.sin(4 * theta)
  }
  if (vx === 0 && vz === 0) return null
  return Math.atan2(vz, vx) / 4
}

export type HeroFraming = {
  /** Fit constraints — everything that must stay in frame. */
  boxes: Box3[]
  /** Frame center: plate/structure center on XZ, building center on Y. */
  aim: [number, number, number]
  /** 45° to the dominant facade (falls back to world 45°). */
  azimuthRad: number
  /** Items left out of `boxes` because they sit away from the structure. */
  detachedItemIds: string[]
}

/**
 * Framing for a scene hero shot. The base set is the built structure (walls,
 * roofs, slabs, …) plus any intentionally-shaped site plate; an item joins
 * only when it sits near that base — one palm at the far lot corner must not
 * shrink the building. `building`/`level` container groups are skipped (their
 * Object3D holds the whole subtree). The aim keeps the building dead-center:
 * XZ from the plate+structure union, Y from the structure alone so the
 * building — not the ground — is vertically centered. Scenes with no
 * structure (pure furniture arrangements) fall back to framing every
 * non-helper node.
 */
export function computeHeroFraming({
  sitePlates = true,
}: {
  /** false frames the built structure only, ignoring shaped site plates. */
  sitePlates?: boolean
} = {}): HeroFraming | null {
  const structural = perNodeBoxes([...DEFAULT_FRAMING_EXCLUDED_TYPES, 'item', 'building', 'level'])
  if (structural.length === 0) {
    const all = perNodeBoxes([...DEFAULT_FRAMING_EXCLUDED_TYPES, 'building', 'level'])
    if (all.length === 0) return null
    const union = new Box3()
    for (const box of all) union.union(box)
    const center = union.getCenter(new Vector3())
    return {
      boxes: all,
      aim: [center.x, center.y, center.z],
      azimuthRad: Math.PI / 4,
      detachedItemIds: [],
    }
  }

  const structuralUnion = new Box3()
  for (const box of structural) structuralUnion.union(box)

  const plates = sitePlates ? sitePlateBoxes() : []
  const groundUnion = structuralUnion.clone()
  for (const box of plates) groundUnion.union(box)

  const nearby = groundUnion
    .clone()
    .expandByVector(groundUnion.getSize(new Vector3()).multiplyScalar(0.15))

  const boxes = [...structural, ...plates]
  const detachedItemIds: string[] = []
  const itemIds = sceneRegistry.byType.item!
  for (const id of itemIds) {
    const object = sceneRegistry.nodes.get(id)
    if (!object) continue
    const bounds = new Box3().setFromObject(object)
    if (bounds.isEmpty()) continue
    if (nearby.intersectsBox(bounds)) boxes.push(bounds)
    else detachedItemIds.push(id)
  }

  const groundCenter = groundUnion.getCenter(new Vector3())
  const structuralCenter = structuralUnion.getCenter(new Vector3())
  const yaw = dominantWallYaw()
  return {
    boxes,
    aim: [groundCenter.x, structuralCenter.y, groundCenter.z],
    azimuthRad: Math.PI / 4 - (yaw ?? 0),
    detachedItemIds,
  }
}

export function temporarilyHideNodeTypes(types: readonly string[]): () => void {
  const saved = new Map<Object3D, boolean>()
  for (const type of types) {
    const ids = sceneRegistry.byType[type]!
    ids.forEach((id) => {
      const node = sceneRegistry.nodes.get(id)
      if (node) {
        saved.set(node, node.visible)
        node.visible = false
      }
    })
  }
  return () => {
    saved.forEach((wasVisible, node) => {
      node.visible = wasVisible
    })
  }
}
