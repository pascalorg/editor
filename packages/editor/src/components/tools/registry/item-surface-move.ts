import {
  type AnyNode,
  type AnyNodeId,
  createSceneApi,
  findLevelAncestorId,
  type GridEvent,
  type ItemEvent,
  nodeRegistry,
  resolveSurfacePlacement,
  sceneRegistry,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { Euler, Quaternion, Vector3 } from 'three'
import { isFreshPlacementMetadata } from '../../../lib/placement-metadata'
import { snapToGrid, snapToHalf } from '../item/placement-math'
import { itemEventToSurfaceHit } from '../shared/surface-hit'

export function createItemSurfacePointerArbitration() {
  let hostId: string | null = null
  let hitEvent: object | null = null
  return {
    hit(id: string, event: object) {
      hostId = id
      hitEvent = event
    },
    clear() {
      hostId = null
      hitEvent = null
    },
    blocksGrid(event: object) {
      return hostId !== null && event === hitEvent
    },
  }
}

function pointerEventOf(event: GridEvent | ItemEvent): object {
  return event.nativeEvent.nativeEvent ?? event.nativeEvent
}

export function createItemSurfaceGridDispatch(apply: (event: GridEvent) => void) {
  let pending: GridEvent | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => {
    clearTimeout(timer)
    timer = undefined
    pending = null
  }
  const flush = () => {
    const event = pending
    cancel()
    if (event) apply(event)
  }
  return {
    schedule(event: GridEvent) {
      pending = event
      // Canvas grid listeners precede R3F's wrapper listener. A task waits for both;
      // a microtask can run between native DOM listeners, before the host hit arrives.
      if (timer === undefined) timer = setTimeout(flush, 0)
    },
    flush,
    cancel,
  }
}

export type ItemSurfaceGrab = {
  hostId: string
  start: [number, number, number]
  anchor: [number, number, number] | null
}

export function resolveItemSurfaceGrab(
  grab: ItemSurfaceGrab | null,
  hostId: string,
  raw: [number, number, number],
): { grab: ItemSurfaceGrab | null; position: [number, number, number] } {
  if (!grab || grab.hostId !== hostId) return { grab: null, position: raw }
  const anchor = grab.anchor ?? raw
  return {
    grab: { ...grab, anchor },
    position: [grab.start[0] + (raw[0] - anchor[0]), raw[1], grab.start[2] + (raw[2] - anchor[2])],
  }
}

function parentWorldYaw(parentId: string | null | undefined): number {
  const mesh = parentId ? sceneRegistry.nodes.get(parentId) : undefined
  return mesh
    ? new Euler().setFromQuaternion(mesh.getWorldQuaternion(new Quaternion()), 'YXZ').y
    : 0
}

export function createRegistryItemSurfaceMove(node: AnyNode) {
  const capabilities = nodeRegistry.get(node.type)?.capabilities
  const floorPlaced = capabilities?.floorPlaced
  if (
    !capabilities?.hostable?.parents.includes('item') ||
    !floorPlaced ||
    (floorPlaced.applies && !floorPlaced.applies(node))
  )
    return null

  const original = node as AnyNode & {
    position: [number, number, number]
    rotation: number | [number, number, number]
    supportSlabId?: string
  }
  let changed = false
  const scene = createSceneApi(useScene)
  const pointer = createItemSurfacePointerArbitration()
  const originalParent = original.parentId
    ? useScene.getState().nodes[original.parentId as AnyNodeId]
    : null
  let grab: ItemSurfaceGrab | null =
    originalParent?.type === 'item' && !isFreshPlacementMetadata(original.metadata)
      ? { hostId: originalParent.id, start: original.position, anchor: null }
      : null
  const liveNode = () => useScene.getState().nodes[node.id] ?? node
  const levelId = () => findLevelAncestorId(node.id, useScene.getState().nodes)
  const rotation = (yaw: number) =>
    Array.isArray(original.rotation)
      ? ([original.rotation[0], yaw, original.rotation[2]] as [number, number, number])
      : yaw
  const write = (
    parentId: string | null | undefined,
    position: [number, number, number],
    yaw: number,
    fullRotation?: readonly [number, number, number],
  ) => {
    changed = true
    // Hosted renderers and floorplan builders need the same parent-local pose.
    useScene.getState().updateNode(node.id, {
      parentId,
      position,
      rotation: fullRotation ? [...fullRotation] : rotation(yaw),
      supportSlabId: undefined,
    } as Partial<AnyNode>)
    useLiveTransforms.getState().clear(node.id)
  }
  const session = {
    get hosted() {
      const parentId = liveNode().parentId
      return Boolean(parentId && useScene.getState().nodes[parentId as AnyNodeId]?.type === 'item')
    },
    worldYaw(yaw: number) {
      return yaw + parentWorldYaw(liveNode().parentId)
    },
    planPose(position: [number, number, number], yaw: number) {
      const parentId = liveNode().parentId
      const parentMesh = parentId ? sceneRegistry.nodes.get(parentId) : undefined
      const level = levelId()
      const levelMesh = level ? sceneRegistry.nodes.get(level) : undefined
      const point = new Vector3(...position)
      parentMesh?.localToWorld(point)
      levelMesh?.worldToLocal(point)
      return {
        position: [point.x, point.y, point.z] as [number, number, number],
        rotationY: session.worldYaw(yaw) - parentWorldYaw(level),
      }
    },
    enter(event: ItemEvent, dimensions: [number, number, number], yaw: number) {
      pointer.clear()
      const live = liveNode()
      if (floorPlaced.applies && !floorPlaced.applies(live)) return null
      const host = useScene.getState().nodes[event.node.id]
      if (host?.type !== 'item') return null
      let ancestor: AnyNode | undefined = host
      while (ancestor) {
        if (ancestor.id === node.id) return null
        ancestor = ancestor.parentId ? scene.get(ancestor.parentId as AnyNodeId) : undefined
      }
      const mesh = sceneRegistry.nodes.get(host.id)
      if (!mesh) return null
      const raw = mesh.worldToLocal(new Vector3(...event.position)).toArray()
      const corrected = resolveItemSurfaceGrab(grab, host.id, raw)
      const position = mesh.localToWorld(new Vector3(...corrected.position)).toArray()
      // Keep the legacy world round-trip so existing poses retain identical floating-point values.
      const hit = itemEventToSurfaceHit(host, { ...event, position })
      if (!hit) return null
      const placement = resolveSurfacePlacement({
        host,
        childKind: node.type,
        childFootprint: {
          size: dimensions,
          rotationY: session.worldYaw(yaw) - parentWorldYaw(host.id),
        },
        hit,
        scene,
        snapScalar: snapToGrid,
        checkFootprint: true,
      })
      if (!placement) return null
      const childPose =
        placement.childFrame === 'surface-local' ? placement.surfaceLocal : placement
      if (!childPose) return null
      const pose = {
        position: [...childPose.position] as [number, number, number],
        rotationY: childPose.rotationY,
        worldPosition: mesh.localToWorld(new Vector3(...placement.position)).toArray(),
      }
      grab = corrected.grab
      pointer.hit(host.id, pointerEventOf(event))
      event.stopPropagation()
      write(
        host.id,
        pose.position,
        pose.rotationY,
        placement.childFrame === 'surface-local' ? placement.surfaceLocal?.rotation : undefined,
      )
      return pose
    },
    blocksGrid(event: GridEvent) {
      return session.hosted && pointer.blocksGrid(pointerEventOf(event))
    },
    leave(event: ItemEvent, yaw: number) {
      if (event.node.id !== liveNode().parentId) return null
      return session.detach(event.position, yaw)
    },
    detach(worldPosition: [number, number, number], yaw: number) {
      if (!session.hosted) return null
      const level = levelId()
      if (!level) return null
      pointer.clear()
      grab = null
      const point = new Vector3(...worldPosition)
      sceneRegistry.nodes.get(level)?.worldToLocal(point)
      const rotationY = session.worldYaw(yaw) - parentWorldYaw(level)
      const position: [number, number, number] = [snapToHalf(point.x), 0, snapToHalf(point.z)]
      write(level, position, rotationY)
      return { position, rotationY }
    },
    rotate(yaw: number) {
      if (!session.hosted) return null
      const live = liveNode() as typeof original
      const position: [number, number, number] = [...live.position]
      write(live.parentId, position, yaw)
      return { position, rotationY: yaw }
    },
    restore() {
      if (!changed || !useScene.getState().nodes[node.id]) return
      useScene.getState().updateNode(node.id, {
        parentId: original.parentId,
        position: original.position,
        rotation: original.rotation,
        supportSlabId: original.supportSlabId,
      } as Partial<AnyNode>)
    },
  }
  return session
}
