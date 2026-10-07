import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { evaluateRecipe, isProceduralItem } from '@pascal-app/core/procedural-items'
import { Euler, Quaternion, Vector3 } from 'three'

type Pose = { position: [number, number, number]; rotation: [number, number, number] }

export function surfaceAttachmentId(node: Pick<AnyNode, 'id' | 'parentId'>): string | null {
  const parent = node.parentId ? useScene.getState().nodes[node.parentId as AnyNodeId] : undefined
  return isProceduralItem(parent) ? (parent.attachments[node.id] ?? null) : null
}

export function surfaceAttachmentUpdates(
  id: AnyNodeId,
  parentId: string | null | undefined,
  surfaceId: string | null,
) {
  const nodes = useScene.getState().nodes
  const updates: { id: AnyNodeId; data: Partial<AnyNode> }[] = []
  for (const hostId of new Set([nodes[id]?.parentId, parentId])) {
    const host = hostId ? nodes[hostId as AnyNodeId] : undefined
    if (!isProceduralItem(host)) continue
    const nextId = host.id === parentId ? surfaceId : null
    if ((host.attachments[id] ?? null) === nextId) continue
    const attachments = { ...host.attachments }
    if (nextId === null) delete attachments[id]
    else attachments[id] = nextId
    updates.push({ id: host.id, data: { attachments } })
  }
  return updates
}

export function updateSurfaceNode(
  id: AnyNodeId,
  data: Partial<AnyNode>,
  surfaceId?: string | null,
) {
  const node = useScene.getState().nodes[id]
  const parentId = data.parentId === undefined ? node?.parentId : data.parentId
  const selected =
    surfaceId === undefined && node && node.parentId === parentId
      ? surfaceAttachmentId(node)
      : (surfaceId ?? null)
  useScene
    .getState()
    .updateNodes([{ id, data }, ...surfaceAttachmentUpdates(id, parentId, selected)])
}

export function surfaceFramePose(
  parentId: string | null | undefined,
  surfaceId: string | null,
  pose: Pose,
  toStorage: boolean,
): Pose {
  const host = parentId ? useScene.getState().nodes[parentId as AnyNodeId] : undefined
  if (!isProceduralItem(host) || surfaceId === null)
    return { position: pose.position, rotation: pose.rotation }
  const surface = evaluateRecipe(host.recipe, host.parameters).surfaces.find(
    (s) => s.id === surfaceId,
  )
  if (!surface) throw new Error('Missing attachment surface')
  const q = new Quaternion().setFromEuler(new Euler(...surface.rotation))
  const position = new Vector3(...pose.position)
  if (toStorage) position.sub(new Vector3(...surface.position)).applyQuaternion(q.clone().invert())
  else position.applyQuaternion(q).add(new Vector3(...surface.position))
  if (!surface.rotation[0] && !surface.rotation[2] && !pose.rotation[0] && !pose.rotation[2]) {
    return {
      position: position.toArray(),
      rotation: [0, pose.rotation[1] + (toStorage ? -1 : 1) * surface.rotation[1], 0],
    }
  }
  const rotation = new Euler().setFromQuaternion(
    new Quaternion()
      .setFromEuler(new Euler(...pose.rotation))
      .premultiply(toStorage ? q.invert() : q),
  )
  return { position: position.toArray(), rotation: [rotation.x, rotation.y, rotation.z] }
}
