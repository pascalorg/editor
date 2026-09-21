import {
  type AnyNode,
  type AnyNodeId,
  type CeilingNode,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  type ItemNode,
  useLiveNodeOverrides,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import {
  attachmentBounds,
  boundsOf,
  boxCorners,
  evaluateRecipe,
  frame,
  type ProceduralItemNode,
  proceduralLocalPose,
  type QueryNodes,
  resolveProceduralCeilingPlacement,
  resolveProceduralWallPlacement,
  transformPoint,
  validateProceduralRelations,
} from '@pascal-app/core/procedural-items'
import {
  isGridSnapActive,
  isMagneticSnapActive,
  snapToHalf,
  triggerSFX,
  useEditor,
  usePlacementPreview,
} from '@pascal-app/editor'
import { findContainingSurface, itemFloorplanMoveTarget } from '../item/floorplan-move'
import {
  findClosestWallInPlan,
  hasWallChildOverlap,
  snapLocalXToNeighbors,
} from '../shared/wall-attach-target'

function mountedBounds(node: ProceduralItemNode, nodes: QueryNodes) {
  const e = evaluateRecipe(node.recipe, node.parameters)
  const pose = proceduralLocalPose(node, nodes)
  return boundsOf(
    boxCorners(e.min, e.max).map((point) =>
      transformPoint(frame(pose.position, pose.rotation), point),
    ),
  )
}

export const createProceduralWallMoveSession = createProceduralMountedMoveSession
export const createProceduralCeilingMoveSession = createProceduralMountedMoveSession

function createProceduralMountedMoveSession(node: ProceduralItemNode, levelId: AnyNodeId) {
  const ceilingMounted = node.recipe.mounting?.attachTo === 'ceiling'
  let yaw = node.rotation[1]
  const e = evaluateRecipe(node.recipe, node.parameters)
  let candidate: ProceduralItemNode | null = null
  let flipped = false
  let force = false
  let last: (() => void) | null = null
  let onHost = false
  let stepKey = ''
  const id = node.id as AnyNodeId
  const show = (next: ProceduralItemNode) => {
    const key = next.position
      .map((v) => Math.round(v / (isGridSnapActive() ? useEditor.getState().gridSnapStep : 0.1)))
      .join(':')
    if (key !== stepKey) {
      stepKey = key
      triggerSFX('sfx:grid-snap')
    }
    useLiveNodeOverrides.getState().set(id, { visible: false })
    usePlacementPreview
      .getState()
      .set(
        next as unknown as AnyNode,
        next.parentId ? useScene.getState().nodes[next.parentId as AnyNodeId] : null,
      )
  }
  const session: FloorplanMoveTargetSession & {
    wall(wall: WallNode, x: number, y: number, side: 'front' | 'back', alt: boolean): void
    ceiling(ceiling: CeilingNode, x: number, z: number, alt: boolean): void
    rotate(direction: number): void
    free(point: readonly [number, number]): void
    commit(): void
    readonly candidate: ProceduralItemNode | null
  } = {
    affectedIds: [id],
    get candidate() {
      return candidate
    },
    flipSide() {
      if (ceilingMounted) {
        session.rotate(1)
        return
      }
      flipped = !flipped
      triggerSFX('sfx:item-rotate')
      last?.()
    },
    rotate(direction) {
      yaw = (Math.round(yaw / (Math.PI / 4)) + direction) * (Math.PI / 4)
      triggerSFX('sfx:item-rotate')
      last?.()
    },
    ceiling(ceiling, x, z, alt) {
      if (!ceilingMounted || ceiling.parentId !== levelId) return
      last = () => session.ceiling(ceiling, x, z, alt)
      force = alt
      candidate = resolveProceduralCeilingPlacement(
        node,
        ceiling,
        alt ? x : snapToHalf(x),
        alt ? z : snapToHalf(z),
        yaw,
      )
      if (!onHost) triggerSFX('sfx:item-pick')
      onHost = true
      show(candidate)
    },
    free(point) {
      last = () => session.free(point)
      candidate = null
      onHost = false
      show({
        ...node,
        wallId: undefined,
        side: undefined,
        supportSlabId: undefined,
        parentId: levelId,
        position: [snapToHalf(point[0]), node.position[1] || 1.2, snapToHalf(point[1])],
        rotation: [0, ceilingMounted ? yaw : flipped ? Math.PI : 0, 0],
        visible: true,
      })
    },
    wall(wall, x, y, side, alt) {
      if (ceilingMounted || wall.parentId !== levelId) return
      last = () => session.wall(wall, x, y, side, alt)
      force = alt
      const nodes = useScene.getState().nodes
      const aligned =
        isMagneticSnapActive() && !alt
          ? snapLocalXToNeighbors({ wall, localX: x, width: e.dimensions[0], selfId: id, nodes })
          : null
      candidate = resolveProceduralWallPlacement(
        node,
        wall,
        aligned ?? (alt ? x : snapToHalf(x)),
        alt ? y : snapToHalf(y),
        flipped ? (side === 'front' ? 'back' : 'front') : side,
        nodes,
      )
      if (!candidate) {
        session.free([wall.start[0], wall.start[1]])
        return
      }
      if (!onHost) triggerSFX('sfx:item-pick')
      onHost = true
      show(candidate)
    },
    apply({ planPoint, modifiers }) {
      if (ceilingMounted) {
        const ceiling = findContainingSurface(
          planPoint,
          useScene.getState().nodes,
          levelId,
          'ceiling',
        )
        if (ceiling) session.ceiling(ceiling, planPoint[0], planPoint[1], modifiers.altKey)
        else session.free(planPoint)
        return
      }
      const hit = findClosestWallInPlan(planPoint, useScene.getState().nodes, levelId)
      if (hit)
        session.wall(hit.wall, hit.localX, node.position[1] || 1.2, hit.side, modifiers.altKey)
      else session.free(planPoint)
    },
    canCommit() {
      if (!candidate || useScene.getState().readOnly) return false
      const nodes = useScene.getState().nodes
      try {
        validateProceduralRelations(candidate, nodes)
      } catch {
        return false
      }
      if (force) return true
      if (ceilingMounted) {
        const own = mountedBounds(candidate, nodes)
        return !Object.values(nodes).some((other) => {
          if (other.id === id || other.parentId !== candidate!.parentId) return false
          const box =
            (other as { type: string }).type === 'procedural-item'
              ? mountedBounds(other as unknown as ProceduralItemNode, nodes)
              : other.type === 'item'
                ? attachmentBounds(other)
                : null
          return (
            box &&
            own.min[0] < box.max[0] - 1e-6 &&
            own.max[0] > box.min[0] + 1e-6 &&
            own.min[2] < box.max[2] - 1e-6 &&
            own.max[2] > box.min[2] + 1e-6
          )
        })
      }
      const b = mountedBounds(candidate, nodes)
      const centerX = (b.min[0] + b.max[0]) / 2
      const centerY = (b.min[1] + b.max[1]) / 2
      if (
        hasWallChildOverlap(
          candidate.wallId!,
          nodes,
          centerX,
          centerY,
          b.dimensions[0],
          b.dimensions[1],
          id,
        )
      )
        return false
      const own = b
      return !Object.values(nodes).some((other) => {
        if ((other as { type: string }).type !== 'procedural-item' || other.id === id) return false
        const p = other as unknown as ProceduralItemNode
        if (p.wallId !== candidate!.wallId || p.side !== candidate!.side) return false
        const box = mountedBounds(p, nodes)
        return own.min.every((v, i) => v < box.max[i]! - 1e-6 && own.max[i]! > box.min[i]! + 1e-6)
      })
    },
    commit() {
      if (!candidate || !session.canCommit()) return
      useLiveNodeOverrides.getState().clear(id)
      const { parentId, wallId, position, rotation, side, visible, supportSlabId } = candidate
      useScene.getState().updateNode(id, {
        parentId,
        wallId,
        position,
        rotation,
        side,
        visible,
        supportSlabId,
      } as never)
      usePlacementPreview.getState().clear()
    },
  }
  return session
}

export const proceduralFloorplanMoveTarget: FloorplanMoveTarget<ProceduralItemNode> = ({
  node,
  nodes,
  sceneApi,
}) => {
  if (!node.recipe.mounting) {
    const e = evaluateRecipe(node.recipe, node.parameters)
    return itemFloorplanMoveTarget({
      node: {
        ...node,
        asset: { dimensions: e.dimensions },
        scale: [1, 1, 1],
      } as unknown as ItemNode,
      nodes,
      sceneApi,
    })
  }
  let parent = node.parentId ? nodes[node.parentId as AnyNodeId] : undefined
  while (parent && parent.type !== 'level')
    parent = parent.parentId ? nodes[parent.parentId as AnyNodeId] : undefined
  return createProceduralMountedMoveSession(node, parent?.id as AnyNodeId)
}
