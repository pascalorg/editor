import {
  type AnyNode,
  type AnyNodeId,
  type DragAction,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import {
  isWallLongEnough,
  snapWallDraftPoint,
  type WallPlanPoint,
} from '@pascal-app/editor'

type LinkedWallSnapshot = {
  id: WallNode['id']
  start: WallPlanPoint
  end: WallPlanPoint
}

function samePoint(a: WallPlanPoint, b: WallPlanPoint) {
  return a[0] === b[0] && a[1] === b[1]
}

export type MoveWallEndpointCtx = {
  wallId: AnyNodeId
  endpoint: 'start' | 'end'
  originalStart: WallPlanPoint
  originalEnd: WallPlanPoint
  originalMovingPoint: WallPlanPoint
  fixedPoint: WallPlanPoint
  parentId: string | null
  linkedOriginals: LinkedWallSnapshot[]
  levelWalls: WallNode[]
}

export type MoveWallEndpointDraft = {
  movingPoint: WallPlanPoint
  start: WallPlanPoint
  end: WallPlanPoint
  linkedUpdates: LinkedWallSnapshot[]
  detached: boolean
}

function snapshotLinked(
  wallId: WallNode['id'],
  parentId: string | null,
  originalStart: WallPlanPoint,
  originalEnd: WallPlanPoint,
): LinkedWallSnapshot[] {
  const { nodes } = useScene.getState()
  const out: LinkedWallSnapshot[] = []
  for (const node of Object.values(nodes)) {
    if (!node || node.type !== 'wall') continue
    if (node.id === wallId) continue
    if ((node.parentId ?? null) !== parentId) continue
    if (
      !(
        samePoint(node.start, originalStart) ||
        samePoint(node.start, originalEnd) ||
        samePoint(node.end, originalStart) ||
        samePoint(node.end, originalEnd)
      )
    )
      continue
    out.push({
      id: node.id,
      start: [...node.start] as WallPlanPoint,
      end: [...node.end] as WallPlanPoint,
    })
  }
  return out
}

function linkedCascade(
  linked: LinkedWallSnapshot[],
  originalStart: WallPlanPoint,
  originalEnd: WallPlanPoint,
  nextStart: WallPlanPoint,
  nextEnd: WallPlanPoint,
): LinkedWallSnapshot[] {
  return linked.map((entry) => ({
    id: entry.id,
    start: samePoint(entry.start, originalStart)
      ? nextStart
      : samePoint(entry.start, originalEnd)
        ? nextEnd
        : entry.start,
    end: samePoint(entry.end, originalStart)
      ? nextStart
      : samePoint(entry.end, originalEnd)
        ? nextEnd
        : entry.end,
  }))
}

export const moveWallEndpointDragAction: DragAction<MoveWallEndpointCtx, MoveWallEndpointDraft> = {
  begin: (input) => {
    const wall = input.node as WallNode | undefined
    if (!wall) throw new Error('[moveWallEndpointDragAction] begin requires a wall node')
    const endpoint = (input.handleId ?? 'end') as 'start' | 'end'
    const parentId = wall.parentId ?? null
    const originalStart: WallPlanPoint = [...wall.start] as WallPlanPoint
    const originalEnd: WallPlanPoint = [...wall.end] as WallPlanPoint
    const originalMovingPoint = endpoint === 'start' ? originalStart : originalEnd
    const fixedPoint = endpoint === 'start' ? originalEnd : originalStart

    const levelWalls = Object.values(useScene.getState().nodes).filter(
      (node): node is WallNode =>
        node?.type === 'wall' && (node.parentId ?? null) === parentId,
    )

    return {
      wallId: wall.id as AnyNodeId,
      endpoint,
      originalStart,
      originalEnd,
      originalMovingPoint,
      fixedPoint,
      parentId,
      linkedOriginals: snapshotLinked(wall.id, parentId, originalStart, originalEnd),
      levelWalls,
    }
  },

  preview: (ctx, point, modifiers) => {
    const planPoint: WallPlanPoint = [point[0], point[1]]
    const snapped = snapWallDraftPoint({
      point: planPoint,
      walls: ctx.levelWalls,
      start: ctx.fixedPoint,
      angleSnap: !modifiers.shift,
      ignoreWallIds: [ctx.wallId as string],
    })
    const nextStart = ctx.endpoint === 'start' ? snapped : ctx.fixedPoint
    const nextEnd = ctx.endpoint === 'end' ? snapped : ctx.fixedPoint
    const detached = modifiers.alt
    const linkedUpdates = detached
      ? []
      : linkedCascade(
          ctx.linkedOriginals,
          ctx.originalStart,
          ctx.originalEnd,
          nextStart,
          nextEnd,
        )
    return {
      movingPoint: snapped,
      start: nextStart,
      end: nextEnd,
      linkedUpdates,
      detached,
    }
  },

  apply: (draft, ctx, scene) => {
    scene.update(ctx.wallId, { start: draft.start, end: draft.end } as Partial<AnyNode>)
    const dirty: AnyNodeId[] = [ctx.wallId]
    for (const linked of draft.linkedUpdates) {
      scene.update(
        linked.id as AnyNodeId,
        {
          start: linked.start,
          end: linked.end,
        } as Partial<AnyNode>,
      )
      dirty.push(linked.id as AnyNodeId)
    }
    return dirty
  },

  commit: (draft, ctx, scene) => {
    if (!isWallLongEnough(draft.start, draft.end)) return false

    scene.restoreAll()
    scene.resumeHistory()
    scene.update(ctx.wallId, { start: draft.start, end: draft.end } as Partial<AnyNode>)
    if (!draft.detached) {
      for (const linked of draft.linkedUpdates) {
        scene.update(
          linked.id as AnyNodeId,
          {
            start: linked.start,
            end: linked.end,
          } as Partial<AnyNode>,
        )
      }
    }
    return true
  },

  cancel: () => {},
}
