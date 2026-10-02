import {
  type FaceHostCapability,
  type FaceHostPlacementArgs,
  flushMountRotation,
  type ItemNode,
  mountsFlush,
  sceneRegistry,
} from '@pascal-app/core'
import { type BufferGeometry, type Mesh, Quaternion, Triangle, Vector3 } from 'three'

/** Faces pointing at least this far down take ceiling items (a vault plane at up to ~70°). */
const UNDERSIDE_MAX_NORMAL_Y = -0.35
const UNDERSIDE_FACE = 'underside'

function hitNormal(object: Mesh, faceIndex: number | undefined): Vector3 | null {
  const geometry = object.geometry as BufferGeometry | undefined
  const position = geometry?.getAttribute('position')
  if (!(geometry && position) || faceIndex === undefined) return null
  const index = geometry.getIndex()
  const vertex = (k: number) => (index ? index.getX(faceIndex * 3 + k) : faceIndex * 3 + k)
  const triangle = new Triangle(
    new Vector3().fromBufferAttribute(position, vertex(0)),
    new Vector3().fromBufferAttribute(position, vertex(1)),
    new Vector3().fromBufferAttribute(position, vertex(2)),
  )
  return triangle.getNormal(new Vector3())
}

/**
 * Where a ceiling item hangs under an authored object: the hit point and the
 * face normal, both in the host item's frame, when the face points down.
 */
function resolveUnderside(args: FaceHostPlacementArgs<ItemNode>) {
  if (!args.host.source || args.asset.attachTo !== 'ceiling') return null
  const hostObject = sceneRegistry.nodes.get(args.host.id)
  const object = args.object as Mesh
  const localNormal = hitNormal(object, args.faceIndex)
  if (!(hostObject && localNormal)) return null
  object.updateWorldMatrix(true, false)
  hostObject.updateWorldMatrix(true, false)
  const world = object.localToWorld(new Vector3(...args.localPosition))
  const point = hostObject.worldToLocal(world.clone())
  const toHost = hostObject.getWorldQuaternion(new Quaternion()).invert()
  const normal = localNormal
    .applyQuaternion(object.getWorldQuaternion(new Quaternion()))
    .applyQuaternion(toHost)
    .normalize()
  if (normal.y > UNDERSIDE_MAX_NORMAL_Y) return null
  return { world, point, normal }
}

/**
 * Authored objects host ceiling items (pendants, fans, recessed cans) on
 * their real undersides — a vault plane, a soffit, a beam — found from the
 * pointer's hit, so placement follows the geometry the script built. A
 * pendant hangs plumb, a recessed fixture tilts with the slope; either
 * becomes the object's child.
 */
export const authoredItemFaceHost: FaceHostCapability<ItemNode> = {
  currentFaceId: (item) => (item?.asset.attachTo === 'ceiling' ? UNDERSIDE_FACE : null),
  clearItemFields: [],
  resolvePlacement: (args) => {
    const hit = resolveUnderside(args)
    if (!hit) return null
    const yaw = args.draftItem?.rotation[1] ?? 0
    // A recessed fixture seats flush along the face, tilted with a slope; a
    // pendant or fan hangs plumb from the point.
    const flush = mountsFlush({ ...args.asset, dimensions: args.rawDimensions })
    const offset = flush
      ? hit.normal.clone().multiplyScalar(0.02)
      : new Vector3(0, -args.rawDimensions[1], 0)
    const at = hit.point.clone().add(offset)
    const position: [number, number, number] = [at.x, at.y, at.z]
    const rotation: [number, number, number] = flush
      ? flushMountRotation([hit.normal.x, hit.normal.y, hit.normal.z], yaw)
      : [0, yaw, 0]
    const cursor = hit.world.clone().add(offset)
    return {
      faceId: UNDERSIDE_FACE,
      nodeUpdate: {
        position,
        rotation,
        parentId: args.host.id,
        wallId: undefined,
        blockFaceId: undefined,
        roofSegmentId: undefined,
        roofFace: undefined,
      } satisfies Partial<ItemNode>,
      position,
      rotation,
      cursorPosition: cursor.toArray() as [number, number, number],
      cursorRotation: rotation,
    }
  },
  storedPlacementPatch: () => null,
  isStoredPlacementValid: ({ host, asset }) => Boolean(host.source) && asset.attachTo === 'ceiling',
}
