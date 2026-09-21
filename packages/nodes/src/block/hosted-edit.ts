import {
  type AnyNode,
  type AnyNodeId,
  type BlockNode,
  type BlockTopology,
  getBlockFaceFrame,
  type ItemNode,
  type SceneApi,
  surfaceRegionContainsPoint,
  useLiveNodeOverrides,
} from '@pascal-app/core'
import { attachmentBounds } from '@pascal-app/core/procedural-items'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { type HostedUpdate, hostedChildUpdates } from '../shared/hosted-resize'
import { blockFaceHost } from './face-host'
import { blockSurfaceProvider, blockTopSurfaces } from './surface'

export const BLOCK_SUPPORT_REFUSAL = 'This edit would remove support for an item on the block'
type EditScene = Pick<SceneApi, 'get' | 'update' | 'applyChanges'>

function faceMatrix(host: BlockNode, faceId: string) {
  const face = getBlockFaceFrame(host.topology, faceId)
  if (!face) return null
  return new Matrix4()
    .makeBasis(new Vector3(...face.xAxis), new Vector3(...face.yAxis), new Vector3(...face.normal))
    .setPosition(...face.origin)
}

function convertPose(child: ItemNode, matrix: Matrix4) {
  const position = new Vector3(...child.position).applyMatrix4(matrix).toArray()
  const rotation = new Euler().setFromQuaternion(
    new Quaternion()
      .setFromRotationMatrix(matrix)
      .multiply(new Quaternion().setFromEuler(new Euler(...child.rotation))),
  )
  return { position, rotation: [rotation.x, rotation.y, rotation.z] as [number, number, number] }
}

export function planBlockTopologyEdit(
  scene: Pick<SceneApi, 'get'>,
  id: AnyNodeId,
  topology: BlockTopology,
): HostedUpdate[] | null {
  const host = scene.get<BlockNode>(id)
  if (host?.type !== 'block') return null
  const children = host.children
    .map((childId) => scene.get(childId as AnyNodeId))
    .filter((child): child is AnyNode => !!child && child.parentId === id)
  if (!children.length) return [[id, { topology }]]
  const nextHost = { ...host, topology }
  const before: Record<AnyNodeId, AnyNode> = Object.fromEntries(
    [host, ...children].map((node) => [node.id, node]),
  )
  const after = { ...before, [id]: nextHost }
  const updates: HostedUpdate[] = []
  const reconciled = new Set<string>()
  const nextSurfaces = blockTopSurfaces(nextHost)
  const previousFaces = new Map(host.topology.faces.map((face) => [face.id, face]))
  const nextFaces = new Map(topology.faces.map((face) => [face.id, face]))
  const vertices = new Map(topology.vertices.map((v) => [v.id, v.position]))
  const previousVertices = new Map(host.topology.vertices.map((v) => [v.id, v.position]))
  const horizontal = new Map<string, boolean>()
  const translations = new Map<string, [number, number, number] | null>()
  const isHorizontal = (faceId: string) => {
    if (!horizontal.has(faceId)) {
      const frame = getBlockFaceFrame(topology, faceId)!
      horizontal.set(
        faceId,
        Math.abs(frame.normal[1] - 1) <= 1e-6 &&
          nextFaces
            .get(faceId)!
            .vertexIds.every((id) => Math.abs(vertices.get(id)![1] - frame.origin[1]) <= 1e-5),
      )
    }
    return horizontal.get(faceId)!
  }
  const translation = (faceId: string) => {
    if (!translations.has(faceId)) {
      const previous = previousFaces.get(faceId)!
      const next = nextFaces.get(faceId)!
      const delta = getBlockFaceFrame(topology, faceId)!.origin.map(
        (v, i) => v - getBlockFaceFrame(host.topology, faceId)!.origin[i]!,
      ) as [number, number, number]
      const translated =
        previous.vertexIds.length === next.vertexIds.length &&
        previous.vertexIds.every((id, i) =>
          previousVertices
            .get(id)!
            .every(
              (v, axis) =>
                Math.abs(v + delta[axis]! - vertices.get(next.vertexIds[i]!)![axis]!) <= 1e-5,
            ),
        )
      translations.set(faceId, translated ? delta : null)
    }
    return translations.get(faceId)!
  }
  const replacementAt = (faceId: string, point: [number, number, number]) => {
    const previous = previousFaces.get(faceId)
    const next = nextFaces.get(faceId)
    // A split both retains and adds boundary vertices; translations and insets must not rehome.
    if (
      next &&
      (!next.vertexIds.some((id) => previous?.vertexIds.includes(id)) ||
        !next.vertexIds.some((id) => !previous?.vertexIds.includes(id)))
    )
      return undefined
    return nextSurfaces.find((surface) => {
      if (surface.id === faceId) return false
      const f = getBlockFaceFrame(topology, surface.id)!
      const distance = point.reduce((sum, v, i) => sum + (v - f.origin[i]!) * f.normal[i]!, 0)
      return (
        Math.abs(distance) < 1e-5 &&
        surfaceRegionContainsPoint(surface.region, [point[0], point[2]])
      )
    })
  }
  for (const child of children) {
    if (child.type === 'item' && child.blockFaceId && !child.asset.attachTo) {
      reconciled.add(child.id)
      const matrix = faceMatrix(host, child.blockFaceId)
      if (!matrix) continue
      const oldPose = convertPose(child, matrix)
      const oldRegion = nextSurfaces.find((surface) => surface.id === child.blockFaceId)
      const replacement =
        !oldRegion ||
        !surfaceRegionContainsPoint(oldRegion.region, [oldPose.position[0], oldPose.position[2]])
          ? replacementAt(child.blockFaceId, oldPose.position)
          : undefined
      if (replacement) {
        const pose = convertPose(
          { ...child, ...oldPose },
          faceMatrix(nextHost, replacement.id)!.invert(),
        )
        const candidate = { ...child, ...pose, blockFaceId: replacement.id }
        if (
          !blockFaceHost.isStoredPlacementValid({
            host: nextHost,
            item: candidate,
            asset: child.asset,
          })
        )
          return null
        updates.push([child.id, { ...pose, blockFaceId: replacement.id }])
      } else if (
        !blockFaceHost.isStoredPlacementValid({ host: nextHost, item: child, asset: child.asset })
      )
        return null
      continue
    }
    if (child.type !== 'procedural-item' || child.recipe.mounting) continue
    const projected = attachmentBounds(child)
    const point: [number, number, number] = [
      (projected.min[0] + projected.max[0]) / 2,
      projected.min[1],
      (projected.min[2] + projected.max[2]) / 2,
    ]
    const previous = blockSurfaceProvider.resolveHit(
      host,
      { point, normalWorldY: 1 },
      { scene: { nodes: () => before, get: scene.get } },
    )
    if (!previous || Math.abs(previous.position[1] - point[1]) > 1e-5 || previous.id === null)
      continue
    const next = nextSurfaces.find((surface) => surface.id === previous.id)
    if (next && isHorizontal(next.id)) {
      const delta = translation(next.id)
      if (delta && (Math.abs(delta[0]) > 1e-8 || Math.abs(delta[2]) > 1e-8)) {
        if (!surfaceRegionContainsPoint(next.region, [point[0] + delta[0], point[2] + delta[2]]))
          return null
        updates.push([
          child.id,
          { position: child.position.map((v, i) => v + delta[i]!) as [number, number, number] },
        ])
        reconciled.add(child.id)
        continue
      }
    }
    if (!next || !surfaceRegionContainsPoint(next.region, [point[0], point[2]])) {
      const replacement = replacementAt(previous.id, point)
      if (!replacement || !isHorizontal(replacement.id)) return null
      reconciled.add(child.id)
      continue
    }
    const previousFrame = getBlockFaceFrame(host.topology, previous.id)!
    // Host-local upright designs can follow a horizontal plane, not a tilted or warped support.
    if (Math.abs(previousFrame.normal[1] - 1) > 1e-6 || !isHorizontal(next.id)) return null
  }
  const changes = hostedChildUpdates(before, after, {
    host: (node) => node.id === id,
    child: (node) => !reconciled.has(node.id) && (node.type !== 'item' || !node.asset.attachTo),
  })
  return changes ? [[id, { topology }], ...updates, ...changes] : null
}

export function commitBlockTopologyEdit(
  scene: EditScene,
  id: AnyNodeId,
  topology: BlockTopology,
): boolean {
  const updates = planBlockTopologyEdit(scene, id, topology)
  if (!updates) return false
  if (updates.length === 1) scene.update(id, { topology })
  else {
    if (!scene.applyChanges) return false
    scene.applyChanges({ update: updates.map(([id, data]) => ({ id, data })) })
  }
  return true
}

export function createBlockTopologyPreview(
  id: AnyNodeId,
  scene: Pick<SceneApi, 'get' | 'markDirty'>,
) {
  let owned: HostedUpdate[] = []
  let valid = true
  const clear = () => {
    for (const [nodeId, patch] of owned) {
      useLiveNodeOverrides.getState().clearFields(nodeId, Object.keys(patch))
      if (nodeId !== id) scene.markDirty(nodeId)
    }
    owned = []
    valid = true
  }
  return {
    clear,
    get valid() {
      return valid
    },
    set(topology: BlockTopology) {
      const updates = planBlockTopologyEdit(scene, id, topology)
      valid = updates !== null
      if (!updates) return false
      const nextIds = new Set(updates.map(([nodeId]) => nodeId))
      for (const [nodeId, patch] of owned) {
        if (!nextIds.has(nodeId)) {
          useLiveNodeOverrides.getState().clearFields(nodeId, Object.keys(patch))
          if (nodeId !== id) scene.markDirty(nodeId)
        }
      }
      owned = updates
      useLiveNodeOverrides.getState().setMany(updates)
      for (const [nodeId] of updates) if (nodeId !== id) scene.markDirty(nodeId)
      return true
    },
  }
}
