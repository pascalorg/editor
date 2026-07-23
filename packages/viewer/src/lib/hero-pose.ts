import { sceneRegistry } from '@pascal-app/core'
import { Box3, type Object3D, Vector3 } from 'three'

export const DEFAULT_FRAMING_EXCLUDED_TYPES = ['site', 'scan', 'guide', 'spawn'] as const

export function heroCameraPose({
  boxes,
  aspect,
  fovDeg = 60,
  azimuthRad = Math.PI / 4,
  elevationRad = (13 * Math.PI) / 180,
  padding = 1.0,
  minDistance = 4,
  frameShift = 0.1,
}: {
  boxes: Box3 | readonly Box3[]
  aspect: number
  fovDeg?: number
  azimuthRad?: number
  elevationRad?: number
  padding?: number
  minDistance?: number
  /** Fraction of the frustum half-height to drop the aim by — lifts the
   *  subject above dead-center so the empty sky band shrinks. Stays within
   *  the fit slack `padding` provides. */
  frameShift?: number
}): {
  position: [number, number, number]
  target: [number, number, number]
} {
  const list = Array.isArray(boxes) ? (boxes as readonly Box3[]) : [boxes as Box3]
  const union = new Box3()
  for (const box of list) union.union(box)
  const center = union.getCenter(new Vector3())
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

  // Reframe: slide aim and camera together along the view-up axis — pure
  // composition shift, no perspective change.
  const drop = up.clone().multiplyScalar(-frameShift * distance * tanVertical)
  const aim = center.clone().add(drop)

  return {
    position: [aim.x + dir.x * distance, aim.y + dir.y * distance, aim.z + dir.z * distance],
    target: [aim.x, aim.y, aim.z],
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
 * Per-node framing boxes for a scene hero shot, for `heroCameraPose` corner
 * fitting. Items are second-class: the base set is the built structure (walls,
 * roofs, slabs, …), and an item joins only when it sits near that structure.
 * Without this, one palm tree at the far lot corner doubles the frame and the
 * building reads tiny. `building`/`level` container groups are skipped — their
 * Object3D holds the whole subtree, which would reintroduce every far-flung
 * item. Scenes with no structure at all (pure furniture arrangements) fall
 * back to framing every non-helper node.
 */
export function computeHeroFramingBounds(): Box3[] | null {
  const structural = perNodeBoxes([...DEFAULT_FRAMING_EXCLUDED_TYPES, 'item', 'building', 'level'])
  if (structural.length === 0) {
    const all = perNodeBoxes([...DEFAULT_FRAMING_EXCLUDED_TYPES, 'building', 'level'])
    return all.length > 0 ? all : null
  }

  const structuralUnion = new Box3()
  for (const box of structural) structuralUnion.union(box)
  const nearby = structuralUnion
    .clone()
    .expandByVector(structuralUnion.getSize(new Vector3()).multiplyScalar(0.15))

  const result = [...structural]
  const itemIds = sceneRegistry.byType.item!
  for (const id of itemIds) {
    const object = sceneRegistry.nodes.get(id)
    if (!object) continue
    const bounds = new Box3().setFromObject(object)
    if (!bounds.isEmpty() && nearby.intersectsBox(bounds)) result.push(bounds)
  }
  return result
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
