/**
 * "Pull to continue": a selected wall's end carries a grip that, dragged,
 * draws the next wall from that end.
 *
 * Pressing the grip arms the wall tool's Walls run (each wall starts where the
 * last ended) already started at the pulled end, with the pulled wall's type:
 * its assembly, thickness, height and finishes. The drag shows the next wall;
 * letting go places it, and the run carries on from its far end, click by
 * click, until Esc, a double-click, closing the loop or teeing into a wall —
 * exactly as the Walls run ends. Then the editor is back in Select, with the
 * Rooms shape and wall tool settings the user had.
 *
 * Its walls snap as every line run does once started (`wall-run-snap.ts`):
 * square to the wall before — the pulled one, for the first — or the house's
 * axes, 15° steps past that, Alt free. The 3D wall tool and the floor plan each
 * seed their run from this store, the way they share the plain run: whichever
 * view owns the input places the walls.
 */

import {
  type AnyNodeId,
  getWallCurveFrameAt,
  getWallThickness,
  useScene,
  WALL_CONSTRUCTION_FIELDS,
  type WallNode,
  type WallPlanPoint,
  wallFollowsStorey,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { create } from 'zustand'
import useEditor from '../store/use-editor'
import type { ContinuationMode } from './continuation'
import { selectWallDrawVariant } from './wall-draw-variant'
import { publishWallRunFeedback } from './wall-run-snap'

/** The floor plan's affordance id for a wall end's pull grip (a `move-arrow`, variant `pull`). */
export const WALL_PULL_AFFORDANCE = 'wall-pull'

/** What a pull grip carries: the wall, and which of its ends it pulls from. */
export type WallPullGripPayload = { wallId: string; endpoint: 'start' | 'end' }

/** The grip's tooltip, in both views. */
export const WALL_PULL_GRIP_TITLE = 'Drag to draw the next wall'

export type WallPullRun = {
  /** Bumped per pull, so each view seeds its draft from it once. */
  seq: number
  sourceWallId: AnyNodeId
  levelId: AnyNodeId
  /** The pulled end, where the run started: its walls can close square back to it. */
  runStart: WallPlanPoint
  /** Where the first wall starts: the pulled end. */
  start: WallPlanPoint
  /** Unit direction of the pulled wall, pointing out of the pulled end. */
  reference: WallPlanPoint
  /** The view the grip was pulled in; the floor plan drafts a 3D pull only beside it. */
  origin: '2d' | '3d'
  /** From the press on the grip until it is let go. */
  dragging: boolean
}

type WallPullState = { run: WallPullRun | null }

/** The open pull run, if any. */
export const useWallPullRun = create<WallPullState>(() => ({ run: null }))

/**
 * The wall tool defaults that draw walls of `wall`'s type (core
 * `WALL_CONSTRUCTION_FIELDS`; position, support and paint regions stay with
 * each wall): its assembly and the thickness it sums to (a plain wall's own
 * thickness, so the Build panel's types don't take over), its finishes and
 * trims, and its height when it has its own rather than following the storey
 * (`storeyHeight`).
 */
export function wallPullTypePatch(wall: WallNode, storeyHeight: number | null): Partial<WallNode> {
  const patch: Record<string, unknown> = {}
  for (const field of WALL_CONSTRUCTION_FIELDS) {
    if (wall[field] !== undefined) patch[field] = structuredClone(wall[field])
  }
  patch.thickness = getWallThickness(wall)
  if (!wallFollowsStorey(wall, storeyHeight)) patch.height = wall.height
  return patch as Partial<WallNode>
}

/**
 * The pulled end of `wall` and the direction out of it: along the wall for a
 * straight one, along its tangent for a curved one.
 */
export function wallPullSeed(
  wall: Pick<WallNode, 'start' | 'end' | 'curveOffset'>,
  endpoint: 'start' | 'end',
): { start: WallPlanPoint; reference: WallPlanPoint } | null {
  const start: WallPlanPoint =
    endpoint === 'start' ? [wall.start[0], wall.start[1]] : [wall.end[0], wall.end[1]]
  const tangent = getWallCurveFrameAt(wall as WallNode, endpoint === 'start' ? 0 : 1).tangent
  const sign = endpoint === 'start' ? -1 : 1
  const length = Math.hypot(tangent.x, tangent.y)
  if (!(length > 1e-9)) return null
  return { start, reference: [(tangent.x / length) * sign, (tangent.y / length) * sign] }
}

// What the pull changed for its run, put back when it ends.
let restore: { shape: ContinuationMode; toolDefaults: Record<string, unknown> | null } | null = null
let stopWatching: (() => void) | null = null
let pullSeq = 0

/**
 * Start a pull from `endpoint` of wall `wallId`: arm the Walls run at that end
 * with the wall's type. `origin` is the view the grip was pressed in. False
 * when there is no such wall.
 */
export function startWallPull(args: {
  wallId: string
  endpoint: 'start' | 'end'
  origin: '2d' | '3d'
}): boolean {
  const nodes = useScene.getState().nodes
  const wall = nodes[args.wallId as AnyNodeId]
  if (wall?.type !== 'wall' || !wall.parentId) return false
  const level = nodes[wall.parentId as AnyNodeId]
  if (level?.type !== 'level') return false
  const seed = wallPullSeed(wall, args.endpoint)
  if (!seed) return false

  endWallPullRun()
  const editor = useEditor.getState()
  restore = {
    shape: editor.getContinuation('wall'),
    toolDefaults: (editor.toolDefaults.wall as Record<string, unknown> | undefined) ?? null,
  }
  // The grips belong to a selected wall; drawing goes on without one.
  useViewer.getState().setSelection({ selectedIds: [], levelId: level.id })
  selectWallDrawVariant('walls')
  editor.setToolDefaults('wall', wallPullTypePatch(wall, level.height ?? null))
  editor.armToolMode({ mode: 'build', tool: 'wall' })
  pullSeq += 1
  useWallPullRun.setState({
    run: {
      seq: pullSeq,
      sourceWallId: wall.id as AnyNodeId,
      levelId: wall.parentId as AnyNodeId,
      runStart: seed.start,
      start: seed.start,
      reference: seed.reference,
      origin: args.origin,
      dragging: true,
    },
  })
  watchWallPullRun()
  return true
}

function watchWallPullRun() {
  stopWatching?.()
  // Leaving the wall tool (another tool, Select) ends the run.
  const stopEditor = useEditor.subscribe((state) => {
    if (!(state.mode === 'build' && state.tool === 'wall')) endWallPullRun()
  })
  // A release the view did not take as the placing click (off the plan, say)
  // still ends the drag; the run waits for a click.
  const onPointerUp = () => releaseWallPullDrag()
  const target = typeof window === 'undefined' ? null : window
  target?.addEventListener('pointerup', onPointerUp)
  target?.addEventListener('pointercancel', onPointerUp)
  stopWatching = () => {
    stopEditor()
    target?.removeEventListener('pointerup', onPointerUp)
    target?.removeEventListener('pointercancel', onPointerUp)
  }
}

/** The grip was let go: the run goes on by clicks. */
export function releaseWallPullDrag(): void {
  const run = useWallPullRun.getState().run
  if (run?.dragging) useWallPullRun.setState({ run: { ...run, dragging: false } })
}

/**
 * End the pull run, however its walls ended: back to Select from the wall tool,
 * with the Rooms shape and wall tool defaults the pull replaced. No-op when no
 * run is open.
 */
export function endWallPullRun(): void {
  const run = useWallPullRun.getState().run
  if (!run) return
  useWallPullRun.setState({ run: null })
  stopWatching?.()
  stopWatching = null
  publishWallRunFeedback(null)
  const editor = useEditor.getState()
  if (editor.mode === 'build' && editor.tool === 'wall') editor.armToolMode({ mode: 'select' })
  const saved = restore
  restore = null
  if (!saved) return
  const after = useEditor.getState()
  if (after.getContinuation('wall') !== saved.shape) after.setContinuation('wall', saved.shape)
  after.setToolDefaults('wall', saved.toolDefaults)
}
