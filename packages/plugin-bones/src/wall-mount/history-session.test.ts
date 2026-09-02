import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  clearSceneHistory,
  getSceneHistoryPauseDepth,
  pauseSceneHistory,
  resumeSceneHistory,
  useScene,
} from '@pascal-app/core'
import { beginMoveHistorySession } from './host-compat'
import { resolveWallMoveTarget, wallCommitPatch, DEVICE_BODY_DIMS } from './move-core'

/**
 * ONE-UNDO-ENTRY gate for the wall-mount move (the #694 history-session
 * pattern, ported to the plugin's `beginMoveHistorySession`):
 *  - a completed drag = EXACTLY ONE undo entry; undo restores the exact
 *    pre-drag anchor (wallId + wallT + heightAff + position sentinel);
 *  - the gesture holds a REFCOUNTED pause, so cooperating host systems
 *    (space-detection sync et al.) see the interaction and stand down —
 *    a balanced pause/resume pair inside a subscriber can never resume
 *    tracking mid-gesture (the night-6 leak class);
 *  - cancel leaves NO undo entry (the move tool never writes the scene
 *    mid-drag — the preview lives in useLiveNodeOverrides);
 *  - `end` is idempotent and composes with an outer pause owner.
 */

// `updateNode` batches dirty-marking through requestAnimationFrame.
type RafFn = (cb: (time: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (cb) => {
  cb(0)
  return 0
}
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

const DEVICE_ID = 'bonesdevice_hist' as never

type Temporal = {
  getState: () => {
    pastStates: unknown[]
    futureStates: unknown[]
    isTracking: boolean
    undo: () => void
    redo: () => void
    pause: () => void
    resume: () => void
  }
}

const temporal = () => (useScene as unknown as { temporal: Temporal }).temporal.getState()

const wall = (id: string, start: [number, number], end: [number, number]) => ({
  id,
  type: 'wall',
  parentId: 'level_1',
  start,
  end,
  thickness: 0.15,
  height: 2.5,
  children: [],
})

const PRE_DRAG = {
  wallId: 'w_own',
  wallT: 0.2,
  heightAff: 0.38,
  position: [0, 0, 0] as [number, number, number],
}

function resetScene(): void {
  useScene.setState({
    nodes: {
      level_1: { id: 'level_1', type: 'level', level: 0, height: 2.5, children: [DEVICE_ID] },
      w_own: wall('w_own', [0, 0], [10, 0]),
      w_other: wall('w_other', [0, 5], [10, 5]),
      [DEVICE_ID]: {
        id: DEVICE_ID,
        type: 'bones:device',
        parentId: 'level_1',
        visible: true,
        deviceId: 'recep-w_own-0-front',
        deviceKind: 'receptacle',
        seedWallId: 'w_own',
        seedWallT: 0.2,
        seedHeightAff: 0.38,
        rotation: [0, 0, 0],
        ...PRE_DRAG,
      },
    },
    rootNodeIds: ['level_1'],
    dirtyNodes: new Set(),
    collections: {},
    materials: {},
    readOnly: false,
  } as never)
  clearSceneHistory()
}

const deviceNode = () =>
  useScene.getState().nodes[DEVICE_ID] as unknown as Record<string, unknown>

/** Cooperating host system stand-in (space-detection sync): stands down
 * while an interaction holds the refcounted pause, otherwise brackets its
 * reaction in a balanced pause/resume pair — the old leak vector. */
function attachCooperatingSubscriber() {
  let runs = 0
  let reentrant = false
  const unsubscribe = useScene.subscribe(() => {
    if (reentrant) return
    if (getSceneHistoryPauseDepth() > 0) return
    reentrant = true
    try {
      runs += 1
      pauseSceneHistory(useScene)
      resumeSceneHistory(useScene)
    } finally {
      reentrant = false
    }
  })
  return { unsubscribe, ranTimes: () => runs }
}

const dropTarget = () =>
  resolveWallMoveTarget({
    wall: wall('w_other', [0, 5], [10, 5]),
    wallId: 'w_other',
    localX: 6,
    localY: 1.1,
    body: DEVICE_BODY_DIMS,
    band: null,
  })!

describe('wall-mount move history session (#694 one-entry gate)', () => {
  beforeEach(resetScene)
  afterEach(() => {
    clearSceneHistory()
  })

  test('a completed drag is EXACTLY ONE undo entry; undo restores the pre-drag anchor', () => {
    const cooperating = attachCooperatingSubscriber()
    try {
      const session = beginMoveHistorySession()

      // Mid-gesture the interaction is visible to cooperating systems and
      // nothing is tracked (the preview never writes the scene; even a
      // defensive write here must stay out of history).
      useScene.getState().updateNode(DEVICE_ID, { metadata: { probe: true } } as never)
      expect(temporal().pastStates.length).toBe(0)
      expect(temporal().isTracking).toBe(false)
      expect(getSceneHistoryPauseDepth()).toBeGreaterThan(0)
      expect(cooperating.ranTimes()).toBe(0)
      // restore the probe while still paused (mirrors the tools' baseline rule)
      useScene.getState().updateNode(DEVICE_ID, { metadata: {} } as never)

      // Drop = the ONE tracked write (the move tool's commit()).
      const patch = wallCommitPatch(dropTarget())
      session.commitStep(() => {
        useScene.getState().updateNode(DEVICE_ID, patch as never)
      })
      session.end()

      expect(temporal().pastStates.length).toBe(1)
      expect(getSceneHistoryPauseDepth()).toBe(0)
      expect(temporal().isTracking).toBe(true)
      expect(cooperating.ranTimes()).toBeGreaterThan(0)

      // committed anchor…
      expect(deviceNode().wallId).toBe('w_other')
      expect(deviceNode().wallT).toBeCloseTo(0.6, 9)
      expect(deviceNode().heightAff).toBeCloseTo(1.1, 9)
      expect(deviceNode().position).toEqual([0, 0, 0])

      // …and ONE undo restores the exact pre-drag anchor.
      temporal().undo()
      expect(deviceNode().wallId).toBe(PRE_DRAG.wallId)
      expect(deviceNode().wallT).toBeCloseTo(PRE_DRAG.wallT, 9)
      expect(deviceNode().heightAff).toBeCloseTo(PRE_DRAG.heightAff, 9)
      expect(deviceNode().position).toEqual(PRE_DRAG.position)
      expect(temporal().pastStates.length).toBe(0)

      // redo re-applies the drop — atomic both ways.
      temporal().redo()
      expect(deviceNode().wallId).toBe('w_other')
      expect(temporal().futureStates.length).toBe(0)
    } finally {
      cooperating.unsubscribe()
    }
  })

  test('cancel leaves NO undo entry and the node untouched; end() is idempotent', () => {
    const session = beginMoveHistorySession()
    // The move tool's cancel path: the preview lives in live overrides, so
    // there is nothing to revert — just end the session.
    session.end()
    session.end() // cleanup path double-end must be a no-op

    expect(temporal().pastStates.length).toBe(0)
    expect(getSceneHistoryPauseDepth()).toBe(0)
    expect(temporal().isTracking).toBe(true)
    expect(deviceNode().wallId).toBe(PRE_DRAG.wallId)
    expect(deviceNode().wallT).toBeCloseTo(PRE_DRAG.wallT, 9)
  })

  test('teardown writes after commitStep stay untracked until end()', () => {
    const session = beginMoveHistorySession()
    session.commitStep(() => {
      useScene.getState().updateNode(DEVICE_ID, wallCommitPatch(dropTarget()) as never)
    })
    expect(temporal().pastStates.length).toBe(1)

    useScene.getState().updateNode(DEVICE_ID, { visible: true } as never)
    expect(temporal().pastStates.length).toBe(1)

    session.end()
    expect(getSceneHistoryPauseDepth()).toBe(0)
    expect(temporal().pastStates.length).toBe(1)
  })

  test('composes with an outer pause owner (never steals its pause)', () => {
    pauseSceneHistory(useScene)
    const session = beginMoveHistorySession()
    session.commitStep(() => {
      useScene.getState().updateNode(DEVICE_ID, wallCommitPatch(dropTarget()) as never)
    })
    session.end()

    expect(temporal().pastStates.length).toBe(0)
    expect(getSceneHistoryPauseDepth()).toBe(1)
    expect(temporal().isTracking).toBe(false)

    resumeSceneHistory(useScene)
    expect(getSceneHistoryPauseDepth()).toBe(0)
    expect(temporal().isTracking).toBe(true)
  })
})
