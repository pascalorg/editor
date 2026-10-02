import {
  type FaceHostCapability,
  type FaceHostPlacementArgs,
  type ItemNode,
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
  return { world, point }
}

/**
 * Authored objects host ceiling items (pendants, fans, recessed cans) on
 * their real undersides — a vault plane, a soffit, a beam — found from the
 * pointer's hit, so placement follows the geometry the script built. The
 * item hangs upright from the point and becomes the object's child.
 */
export const authoredItemFaceHost: FaceHostCapability<ItemNode> = {
  currentFaceId: (item) => (item?.asset.attachTo === 'ceiling' ? UNDERSIDE_FACE : null),
  clearItemFields: [],
  resolvePlacement: (args) => {
    const hit = resolveUnderside(args)
    if (!hit) return null
    const drop = args.asset.recessed ? 0.02 : args.rawDimensions[1]
    const position: [number, number, number] = [hit.point.x, hit.point.y - drop, hit.point.z]
    const yaw = args.draftItem?.rotation[1] ?? 0
    const rotation: [number, number, number] = [0, yaw, 0]
    const cursor = hit.world.clone()
    cursor.y -= drop
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
