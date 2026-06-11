import {
  type AnyNode,
  type ArcResizeHandle,
  createSceneApi,
  DEFAULT_ANGLE_STEP,
  type HandleDescriptor,
  nodeRegistry,
  type SceneApi,
  useScene,
} from '@pascal-app/core'

function resolveHandles(node: AnyNode): HandleDescriptor<AnyNode>[] {
  const handles = nodeRegistry.get(node.type)?.handles
  if (!handles) return []
  return (
    typeof handles === 'function' ? handles(node as never) : handles
  ) as HandleDescriptor<AnyNode>[]
}

export function getDirectRotateHandle(node: AnyNode): ArcResizeHandle<AnyNode> | null {
  for (const handle of resolveHandles(node)) {
    if (handle.kind === 'arc-resize' && handle.shape === 'rotate') {
      return handle as ArcResizeHandle<AnyNode>
    }
  }
  return null
}

export function canDirectRotateNode(node: AnyNode): boolean {
  return (
    getDirectRotateHandle(node) !== null ||
    nodeRegistry.get(node.type)?.capabilities?.rotatable !== undefined
  )
}

export function snapDirectRotationDelta(delta: number, free: boolean): number {
  return free ? delta : Math.round(delta / DEFAULT_ANGLE_STEP) * DEFAULT_ANGLE_STEP
}

export function resolveDirectRotationPatch(
  node: AnyNode,
  delta: number,
  sceneApi: SceneApi = createSceneApi(useScene),
): Partial<AnyNode> | null {
  const rotateHandle = getDirectRotateHandle(node)
  if (rotateHandle) {
    return rotateHandle.apply(node, delta, sceneApi) as Partial<AnyNode>
  }

  const rotation = (node as { rotation?: unknown }).rotation
  if (typeof rotation === 'number') {
    return { rotation: rotation - delta } as Partial<AnyNode>
  }
  if (Array.isArray(rotation)) {
    const [rx = 0, ry = 0, rz = 0] = rotation as [number?, number?, number?]
    return { rotation: [rx, ry - delta, rz] } as Partial<AnyNode>
  }
  return null
}
