import {
  type AnyNode,
  type ArcResizeHandle,
  createSceneApi,
  DEFAULT_ANGLE_STEP,
  type HandleDescriptor,
  hasRegistry3DMoveTool,
  isMovable,
  nodeRegistry,
  resolveSelectionProxyId,
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

const BESPOKE_SELECTION_MOVE_KINDS = new Set([
  'duct-segment',
  'duct-fitting',
  'pipe-segment',
  'pipe-fitting',
  'lineset',
  'liquid-line',
])

export function canDirectMoveNode(node: AnyNode): boolean {
  // These MEP kinds own move through bespoke selection rigs (latch cubes,
  // directional arrows, grid-driven previews). Sending body drags/clicks
  // through the generic direct-move handoff conflicts with that path and can
  // leave the editor appearing frozen while their mover waits for the wrong
  // gesture stream.
  if (BESPOKE_SELECTION_MOVE_KINDS.has(node.type)) return false
  // 3D direct move (Ctrl/Meta-drag, the move-cross grip) needs a move tool that
  // mounts in 3D — distinct from `isRegistryMovable`, which also accepts
  // floorplan-only movers (zone) for the 2D plan.
  if (!hasRegistry3DMoveTool(node.type)) return false
  // Bespoke movers (`affordanceTools.move`) own their constraints and often
  // deliberately omit `capabilities.movable` — only gate registry-movable
  // kinds on `isMovable`, so a per-node `movable.override` (e.g. a cabinet
  // run locked behind its selection proxy) can opt out of direct move.
  if (nodeRegistry.get(node.type)?.affordanceTools?.move) return true
  return isMovable(node)
}

export function resolveDirectManipulationNode(
  node: AnyNode,
  nodes: Readonly<Record<string, AnyNode | undefined>>,
): AnyNode {
  const target = nodes[resolveSelectionProxyId(node, nodes)] ?? node
  const parentFrame = nodeRegistry.get(target.type)?.capabilities?.movable?.parentFrame
  const parent = parentFrame?.resolveParent(target, nodes as Readonly<Record<string, AnyNode>>)
  return parent && canDirectRotateNode(parent) ? parent : target
}

export function resolveMoveActionNode(
  node: AnyNode,
  nodes: Readonly<Record<string, AnyNode | undefined>>,
): AnyNode {
  const parentFrame = nodeRegistry.get(node.type)?.capabilities?.movable?.parentFrame
  const parent = parentFrame?.resolveParent(node, nodes as Readonly<Record<string, AnyNode>>)
  return parent?.type === node.type ? parent : node
}

/**
 * Whether a rotation gesture should run free of its 15° step.
 *
 * The single rule for every rotation entry point — direct rotate in 2D and 3D,
 * and the 3D rotate handle. Having each site decide for itself is what let 2D
 * and 3D drift apart in the first place.
 *
 * **Alt, not Shift.** Rotation's angular step is not one of the positional
 * snapping modes: `snapContextOf` deliberately returns `null` for a rotate
 * handle drag, because grid / lines / angles are about where a *point* lands
 * and rotation moves no point. So the step is the gesture's own quantum, and
 * its bypass is the modifier the model reserves for force/free — Alt. Shift is
 * spoken for: it cycles the snapping mode, and
 * `wiki/architecture/interaction-scope.md` rules out `event.shiftKey` as a snap
 * bypass outright.
 */
export function isRotationStepBypassed(event: { altKey: boolean }): boolean {
  return event.altKey
}

export function snapDirectRotationDelta(delta: number, free: boolean): number {
  return free ? delta : Math.round(delta / DEFAULT_ANGLE_STEP) * DEFAULT_ANGLE_STEP
}

export function resolveDirectRotationDragDelta(
  startX: number,
  clientX: number,
  radiansPerPixel: number,
  free: boolean,
): number {
  return snapDirectRotationDelta((startX - clientX) * radiansPerPixel, free)
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
