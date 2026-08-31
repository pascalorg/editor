import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  clearSceneHistory,
  DoorNode,
  getSceneHistoryPauseDepth,
  LevelNode,
  pauseSceneHistory,
  resumeSceneHistory,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { beginOpeningMoveHistorySession } from './opening-move-history'

// `updateNodesAction` batches dirty-marking through requestAnimationFrame.
type RafFn = (cb: (time: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (cb) => {
  cb(0)
  return 0
}
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

// The night-6 door-drag undo defect, pinned at the store level.
//
// The door / window MOVE tools write the scene mid-drag (arm-time
// isTransient stamp, host-change reparents, floor free-follow) under a
// history pause, then commit the drop as one tracked write against a
// restored baseline. The old implementation paused with a RAW
// `useScene.temporal.getState().pause()` — invisible to the refcounted
// `getSceneHistoryPauseDepth()`. zundo evaluates `isTracking` AFTER a
// write's subscribers have run, so any cooperating system that takes a
// BALANCED `pauseSceneHistory`/`resumeSceneHistory` pair inside one of
// those mid-drag writes (the space-detection sync does, whenever a reparent
// touches a wall's `children`) zeroed the refcount, resumed tracking, and
// the mid-drag write that triggered it — plus every write after — became
// its own undo entry. QA saw a scene commit fire the moment the drag armed
// and a completed drag leave several undo states, none of them the baseline.
//
// `beginOpeningMoveHistorySession` holds the refcounted LEASE instead, so
// the depth stays ≥ 1 for the whole gesture: cooperating systems stand down
// (their gate sees the interaction) and no balanced pair can resume tracking
// mid-drag. `commitStep` opens the single deliberate tracking window.

const BUILDING_ID = 'building_history' as AnyNodeId
const LEVEL_ID = 'level_history' as AnyNodeId
const WALL_A_ID = 'wall_history_own' as AnyNodeId
const WALL_B_ID = 'wall_history_other' as AnyNodeId
const DOOR_ID = 'door_history' as AnyNodeId

function resetScene(): void {
  const door = DoorNode.parse({
    id: DOOR_ID,
    parentId: WALL_A_ID,
    wallId: WALL_A_ID,
    position: [1.5, 1.05, 0],
    width: 0.9,
  })
  const wallA = WallNode.parse({
    id: WALL_A_ID,
    parentId: LEVEL_ID,
    start: [0, 0],
    end: [6, 0],
    children: [DOOR_ID],
  })
  const wallB = WallNode.parse({
    id: WALL_B_ID,
    parentId: LEVEL_ID,
    start: [0, -2.5],
    end: [6, -2.5],
    children: [],
  })
  const level = LevelNode.parse({
    id: LEVEL_ID,
    parentId: BUILDING_ID,
    children: [WALL_A_ID, WALL_B_ID],
    level: 0,
  })
  const building = BuildingNode.parse({
    id: BUILDING_ID,
    parentId: null,
    children: [LEVEL_ID],
  })
  useScene.setState({
    nodes: {
      [BUILDING_ID]: building,
      [LEVEL_ID]: level,
      [WALL_A_ID]: wallA,
      [WALL_B_ID]: wallB,
      [DOOR_ID]: door,
    },
    rootNodeIds: [BUILDING_ID],
    dirtyNodes: new Set<AnyNodeId>(),
    collections: {},
    materials: {},
    readOnly: false,
  } as never)
  clearSceneHistory()
}

function node(id: AnyNodeId): AnyNode {
  const found = useScene.getState().nodes[id]
  if (!found) throw new Error(`missing node ${id}`)
  return found
}

function pastLength(): number {
  return useScene.temporal.getState().pastStates.length
}

/**
 * A stand-in for the space-detection sync (and any other cooperating
 * system): stands down while an interaction holds the refcounted pause,
 * otherwise brackets its reaction in a BALANCED pause/resume pair. With the
 * old raw-pause tools this pair was the resume leak.
 */
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

/** The MOVE tools' mid-drag write sequence: arm, free-follow, re-snap. */
function writeMidDragSequence(): void {
  const scene = useScene.getState()
  // Drag arms: the tool stamps the node transient.
  scene.updateNode(DOOR_ID, { metadata: { isTransient: true } })
  // Floor free-follow: reparent to the level, hidden (wall A's children change).
  scene.updateNode(DOOR_ID, {
    position: [2, 1.05, -1.2],
    rotation: [0, 0, 0],
    parentId: LEVEL_ID,
    wallId: undefined,
    visible: false,
  })
  // Re-snap onto wall B (both walls' children change — the write that used
  // to wake the space-detection pause/resume pair mid-drag).
  scene.updateNode(DOOR_ID, {
    position: [0.8, 1.05, 0],
    rotation: [0, Math.PI, 0],
    parentId: WALL_B_ID,
    wallId: WALL_B_ID,
    visible: false,
  })
  // Slide along wall B.
  scene.updateNode(DOOR_ID, { position: [2.4, 1.05, 0] })
}

/** The MOVE tools' commit: restore the baseline paused, drop as ONE tracked write. */
function restoreBaselineThenCommit(session: ReturnType<typeof beginOpeningMoveHistorySession>) {
  const scene = useScene.getState()
  scene.updateNode(DOOR_ID, {
    position: [1.5, 1.05, 0],
    rotation: [0, 0, 0],
    parentId: WALL_A_ID,
    wallId: WALL_A_ID,
    metadata: {},
    visible: true,
  })
  session.commitStep(() => {
    scene.updateNode(DOOR_ID, {
      position: [3.1, 1.05, 0],
      rotation: [0, Math.PI, 0],
      parentId: WALL_B_ID,
      wallId: WALL_B_ID,
      metadata: {},
      visible: true,
    })
  })
}

describe('opening move history session', () => {
  beforeEach(resetScene)
  afterEach(() => {
    clearSceneHistory()
  })

  test('a completed gesture is EXACTLY ONE undo entry; undo restores the pre-drag state', () => {
    const cooperating = attachCooperatingSubscriber()
    try {
      const session = beginOpeningMoveHistorySession()

      writeMidDragSequence()
      // Mid-drag: nothing tracked, tracking still off, interaction visible
      // to cooperating systems (they stand down instead of leaking a resume).
      expect(pastLength()).toBe(0)
      expect(useScene.temporal.getState().isTracking).toBe(false)
      expect(getSceneHistoryPauseDepth()).toBeGreaterThan(0)
      expect(cooperating.ranTimes()).toBe(0)

      restoreBaselineThenCommit(session)
      session.end()

      // Drop wrote exactly one entry; the session released its lease fully.
      expect(pastLength()).toBe(1)
      expect(getSceneHistoryPauseDepth()).toBe(0)
      expect(useScene.temporal.getState().isTracking).toBe(true)
      // The cooperating system got its normal look-in during the tracked drop.
      expect(cooperating.ranTimes()).toBeGreaterThan(0)

      // The door committed to wall B...
      expect(node(DOOR_ID).parentId).toBe(WALL_B_ID)
      expect((node(WALL_B_ID) as { children: string[] }).children).toContain(DOOR_ID)
      expect((node(WALL_A_ID) as { children: string[] }).children).not.toContain(DOOR_ID)

      // ...and ONE undo restores the exact pre-drag world: position, host,
      // wall link, metadata, visibility, and both walls' children.
      useScene.temporal.getState().undo()
      const restored = node(DOOR_ID) as unknown as {
        position: number[]
        parentId: string
        wallId?: string
        metadata: unknown
        visible?: boolean
      }
      expect(restored.position).toEqual([1.5, 1.05, 0])
      expect(restored.parentId).toBe(WALL_A_ID)
      expect(restored.wallId).toBe(WALL_A_ID)
      expect((restored.metadata ?? {}) as Record<string, unknown>).not.toHaveProperty('isTransient')
      expect(restored.visible).not.toBe(false)
      expect((node(WALL_A_ID) as { children: string[] }).children).toContain(DOOR_ID)
      expect((node(WALL_B_ID) as { children: string[] }).children).not.toContain(DOOR_ID)
      expect(pastLength()).toBe(0)

      // Redo re-applies the drop — the gesture is one atomic step both ways.
      useScene.temporal.getState().redo()
      expect(node(DOOR_ID).parentId).toBe(WALL_B_ID)
      expect(useScene.temporal.getState().futureStates.length).toBe(0)
    } finally {
      cooperating.unsubscribe()
    }
  })

  test('a cancelled gesture leaves NO undo entry and the pre-drag state intact', () => {
    const session = beginOpeningMoveHistorySession()
    writeMidDragSequence()

    // The tools' cancel path: revert while paused, then end the session.
    useScene.getState().updateNode(DOOR_ID, {
      position: [1.5, 1.05, 0],
      rotation: [0, 0, 0],
      parentId: WALL_A_ID,
      wallId: WALL_A_ID,
      metadata: {},
      visible: true,
    })
    session.end()
    // Cancel (tool:cancel) and the effect cleanup BOTH end the session;
    // the second end must be a no-op, not an underflow of someone else's pause.
    session.end()

    expect(pastLength()).toBe(0)
    expect(getSceneHistoryPauseDepth()).toBe(0)
    expect(useScene.temporal.getState().isTracking).toBe(true)
    expect(node(DOOR_ID).parentId).toBe(WALL_A_ID)
    expect((node(WALL_A_ID) as { children: string[] }).children).toContain(DOOR_ID)
    expect((node(WALL_B_ID) as { children: string[] }).children).not.toContain(DOOR_ID)
  })

  test('writes after commitStep (tool teardown) stay untracked until end()', () => {
    const session = beginOpeningMoveHistorySession()
    writeMidDragSequence()
    restoreBaselineThenCommit(session)
    expect(pastLength()).toBe(1)

    // Teardown-time write (e.g. a safety-net visibility restore) — the
    // re-acquired lease keeps it out of history.
    useScene.getState().updateNode(DOOR_ID, { visible: true })
    expect(pastLength()).toBe(1)

    session.end()
    expect(getSceneHistoryPauseDepth()).toBe(0)
    expect(pastLength()).toBe(1)
  })

  test('the session composes with an outer pause owner (never steals its pause)', () => {
    pauseSceneHistory(useScene)
    const session = beginOpeningMoveHistorySession()
    writeMidDragSequence()
    restoreBaselineThenCommit(session)
    session.end()

    // The outer owner is still pausing: the commit write could not track and
    // the depth still reflects the outer pause.
    expect(pastLength()).toBe(0)
    expect(getSceneHistoryPauseDepth()).toBe(1)
    expect(useScene.temporal.getState().isTracking).toBe(false)

    resumeSceneHistory(useScene)
    expect(getSceneHistoryPauseDepth()).toBe(0)
    expect(useScene.temporal.getState().isTracking).toBe(true)
  })

  test('REGRESSION the raw temporal.pause() the session replaces leaked undo entries', () => {
    const cooperating = attachCooperatingSubscriber()
    try {
      // The old tool pattern: a raw pause, invisible to the refcount.
      useScene.temporal.getState().pause()
      expect(getSceneHistoryPauseDepth()).toBe(0)

      writeMidDragSequence()

      // The cooperating subscriber saw depth 0, ran its balanced
      // pause/resume pair, and RESUMED tracking out from under the raw
      // pause — zundo reads isTracking after subscribers, so the mid-drag
      // writes themselves were recorded as undo entries (transient states:
      // door hidden / reparented mid-drag), none of them the baseline.
      expect(cooperating.ranTimes()).toBeGreaterThan(0)
      expect(useScene.temporal.getState().isTracking).toBe(true)
      expect(pastLength()).toBeGreaterThan(1)
    } finally {
      cooperating.unsubscribe()
      useScene.temporal.getState().resume()
    }
  })
})
