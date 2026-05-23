import {
  type AnyNode,
  type AnyNodeId,
  type DragAction,
  type PipeNode,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { isWallLongEnough, type PipePlanPoint, snapPipeDraftPoint } from '@pascal-app/editor'

const LINKED_PIPE_ENDPOINT_EPSILON = 0.025

function samePoint(a: PipePlanPoint, b: PipePlanPoint): boolean {
  return (
    Math.abs(a[0] - b[0]) <= LINKED_PIPE_ENDPOINT_EPSILON &&
    Math.abs(a[1] - b[1]) <= LINKED_PIPE_ENDPOINT_EPSILON
  )
}

type LinkedPipeSnapshot = {
  id: PipeNode['id']
  start: PipePlanPoint
  end: PipePlanPoint
}

export type MovePipeEndpointCtx = {
  pipeId: AnyNodeId
  endpoint: 'start' | 'end'
  originalStart: PipePlanPoint
  originalEnd: PipePlanPoint
  originalMovingPoint: PipePlanPoint
  fixedPoint: PipePlanPoint
  parentId: string | null
  linkedOriginals: LinkedPipeSnapshot[]
  levelWalls: WallNode[]
  levelPipes: PipeNode[]
}

export type MovePipeEndpointDraft = {
  movingPoint: PipePlanPoint
  start: PipePlanPoint
  end: PipePlanPoint
  linkedUpdates: LinkedPipeSnapshot[]
  detached: boolean
}

function snapshotLinked(
  pipeId: PipeNode['id'],
  parentId: string | null,
  linkedPoint: PipePlanPoint,
): LinkedPipeSnapshot[] {
  const { nodes } = useScene.getState()
  const out: LinkedPipeSnapshot[] = []
  for (const node of Object.values(nodes)) {
    if (!node || node.type !== 'pipe') continue
    if (node.id === pipeId) continue
    if ((node.parentId ?? null) !== parentId) continue
    if (!samePoint(node.start, linkedPoint) && !samePoint(node.end, linkedPoint)) continue
    out.push({
      id: node.id,
      start: [node.start[0], node.start[1]],
      end: [node.end[0], node.end[1]],
    })
  }
  return out
}

function linkedCascade(
  linked: LinkedPipeSnapshot[],
  origin: PipePlanPoint,
  next: PipePlanPoint,
): LinkedPipeSnapshot[] {
  return linked.map((entry) => ({
    id: entry.id,
    start: samePoint(entry.start, origin) ? next : entry.start,
    end: samePoint(entry.end, origin) ? next : entry.end,
  }))
}

export const movePipeEndpointDragAction: DragAction<MovePipeEndpointCtx, MovePipeEndpointDraft> = {
  begin: (input) => {
    const pipe = input.node as PipeNode | undefined
    if (!pipe) throw new Error('[movePipeEndpointDragAction] begin requires a pipe node')
    const endpoint = (input.handleId ?? 'end') as 'start' | 'end'
    const parentId = pipe.parentId ?? null
    const originalStart: PipePlanPoint = [pipe.start[0], pipe.start[1]]
    const originalEnd: PipePlanPoint = [pipe.end[0], pipe.end[1]]
    const originalMovingPoint = endpoint === 'start' ? originalStart : originalEnd
    const fixedPoint = endpoint === 'start' ? originalEnd : originalStart

    const { nodes } = useScene.getState()
    const levelWalls: WallNode[] = []
    const levelPipes: PipeNode[] = []
    for (const node of Object.values(nodes)) {
      if (!node) continue
      if ((node.parentId ?? null) !== parentId) continue
      if (node.type === 'wall') levelWalls.push(node)
      else if (node.type === 'pipe') levelPipes.push(node)
    }

    return {
      pipeId: pipe.id as AnyNodeId,
      endpoint,
      originalStart,
      originalEnd,
      originalMovingPoint,
      fixedPoint,
      parentId,
      linkedOriginals: snapshotLinked(pipe.id, parentId, originalMovingPoint),
      levelWalls,
      levelPipes,
    }
  },

  preview: (ctx, point, modifiers) => {
    const planPoint: PipePlanPoint = [point[0], point[1]]
    const snapped = snapPipeDraftPoint({
      point: planPoint,
      walls: ctx.levelWalls,
      pipes: ctx.levelPipes,
      start: ctx.fixedPoint,
      angleSnap: !modifiers.shift,
      ignorePipeIds: [ctx.pipeId as string],
    })
    const nextStart = ctx.endpoint === 'start' ? snapped : ctx.fixedPoint
    const nextEnd = ctx.endpoint === 'end' ? snapped : ctx.fixedPoint
    const detached = modifiers.alt
    const linkedUpdates = detached
      ? []
      : linkedCascade(ctx.linkedOriginals, ctx.originalMovingPoint, snapped)
    return {
      movingPoint: snapped,
      start: nextStart,
      end: nextEnd,
      linkedUpdates,
      detached,
    }
  },

  apply: (draft, ctx, scene) => {
    scene.update(ctx.pipeId, { start: draft.start, end: draft.end } as Partial<AnyNode>)
    const dirty: AnyNodeId[] = [ctx.pipeId]
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
    scene.update(ctx.pipeId, { start: draft.start, end: draft.end } as Partial<AnyNode>)
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
