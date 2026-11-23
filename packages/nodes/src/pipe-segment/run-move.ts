import {
  type AnyNode,
  type AnyNodeId,
  PipeSegmentNode,
  type PortConnectivity,
  resolveConnectivityUpdates,
} from '@pascal-app/core'
import type { ScenePort } from '@pascal-app/editor/distribution'
import type { PipeFittingNode } from '../pipe-fitting/schema'
import { planPipeRunTranslationOffsets } from '../shared/pipe-run-translation-offset'
import { planVerticalOffsets } from '../shared/pipe-vertical-offset'
import { pipeUpdatesPreserveGrades } from './grade-operation'

type Point = [number, number, number]
type Update = { id: AnyNodeId; data: Partial<AnyNode> }

export type PipeRunMoveKind = { axis: 'y' } | { axis: 'horizontal'; dir: [number, number] }

export type PipeRunMoveGhost = {
  tint: 'valid' | 'invalid'
  fittings: PipeFittingNode[]
  risers: PipeSegmentNode[]
}

export type PipeRunMoveChange = { create: AnyNode[]; delete: AnyNodeId[]; update: Update[] }

/**
 * One frame of a selected run's arrow move. A `valid` frame previews exactly the
 * change it commits; `invalid` is a vertical offset that cannot be formed (red
 * ghost, nothing to commit); `blocked` would regrade a connected run or pull a
 * joint apart.
 */
export type PipeRunMoveFrame =
  | {
      status: 'valid'
      preview: Update[]
      hidden: AnyNodeId[]
      ghost: PipeRunMoveGhost | null
      change: PipeRunMoveChange
    }
  | { status: 'invalid'; ghost: PipeRunMoveGhost }
  | { status: 'blocked' }

type RunMoveArgs = {
  pipe: PipeSegmentNode
  kind: PipeRunMoveKind
  /** Drag-start connectivity snapshot. */
  connectivity: PortConnectivity | null
  /** Scene ports excluding the moved run. */
  scenePorts: ScenePort[]
  /** Drag-start node snapshots keyed by id. */
  nodesById: Record<string, AnyNode>
}

export function planPipeRunMoveFrame(args: RunMoveArgs & { delta: number }): PipeRunMoveFrame {
  const { pipe, kind, delta, connectivity, scenePorts, nodesById } = args
  const profile = { diameter: pipe.diameter, pipeMaterial: pipe.pipeMaterial }
  const connections = connectivity?.connections ?? []
  const exists = (update: Update) => !!nodesById[update.id]
  const follow = (path: Point[]): Update[] | null =>
    connectivity
      ? (resolveConnectivityUpdates(connectivity, { ...pipe, path } as AnyNode)?.filter(exists) ??
        null)
      : []
  const path = pipe.path.map(
    (p): Point =>
      kind.axis === 'y'
        ? [p[0], p[1] + delta, p[2]]
        : [p[0] + delta * kind.dir[0], p[1], p[2] + delta * kind.dir[1]],
  )
  const guarded = (frame: Extract<PipeRunMoveFrame, { status: 'valid' }>): PipeRunMoveFrame =>
    pipeUpdatesPreserveGrades(nodesById, frame.change.update) ? frame : { status: 'blocked' }

  if (kind.axis === 'y' && delta !== 0) {
    const offsets = planVerticalOffsets({
      pipe,
      dy: delta,
      profile,
      connections,
      scenePorts,
      nodesById,
    })
    if (offsets?.status === 'invalid') {
      const lifted = PipeSegmentNode.parse({ ...pipe, path })
      return { status: 'invalid', ghost: { tint: 'invalid', fittings: [], risers: [lifted] } }
    }
    if (offsets?.status === 'valid') {
      const { plan } = offsets
      const followers = follow(plan.followPath)
      if (!followers) return { status: 'blocked' }
      const update = [
        { id: pipe.id as AnyNodeId, data: { path: plan.pipePath } },
        ...plan.updates.filter(exists),
        ...followers,
      ]
      const hidden = (plan.delete ?? []).filter((id) => nodesById[id])
      return guarded({
        status: 'valid',
        preview: update,
        hidden,
        ghost: { tint: 'valid', fittings: plan.fittings, risers: plan.risers },
        change: { create: [...plan.fittings, ...plan.risers], delete: hidden, update },
      })
    }
  }
  if (kind.axis === 'horizontal' && connectivity) {
    const translation = planPipeRunTranslationOffsets({
      pipe,
      translatedPath: path,
      profile,
      connections,
      scenePorts,
      nodesById,
    })
    if (translation) {
      const update = [
        { id: pipe.id as AnyNodeId, data: { path: translation.pipePath } },
        ...translation.updates,
      ]
      return guarded({
        status: 'valid',
        preview: update,
        hidden: [],
        ghost: { tint: 'valid', fittings: translation.fittings, risers: translation.connectors },
        change: {
          create: [...translation.fittings, ...translation.connectors],
          delete: [],
          update,
        },
      })
    }
  }
  const followers = follow(path)
  if (!followers) return { status: 'blocked' }
  const update = [{ id: pipe.id as AnyNodeId, data: { path } }, ...followers]
  return guarded({
    status: 'valid',
    preview: update,
    hidden: [],
    ghost: null,
    change: { create: [], delete: [], update },
  })
}

/**
 * Tracks one arrow move so release commits the frame on screen: a blocked frame
 * keeps the last shown frame, as the endpoint handles do.
 */
export function startPipeRunMove(args: RunMoveArgs) {
  let shown: {
    delta: number
    frame: Exclude<PipeRunMoveFrame, { status: 'blocked' }>
  } | null = null
  return {
    update(delta: number): PipeRunMoveFrame {
      const frame = planPipeRunMoveFrame({ ...args, delta })
      if (frame.status !== 'blocked') shown = { delta, frame }
      return frame
    },
    /** The change to commit on release, or null when nothing valid is shown. */
    release(): PipeRunMoveChange | null {
      return shown && shown.delta !== 0 && shown.frame.status === 'valid'
        ? shown.frame.change
        : null
    },
  }
}
