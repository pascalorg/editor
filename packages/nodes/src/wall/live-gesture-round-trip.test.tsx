import { afterAll, afterEach, beforeAll, beforeEach, describe, spyOn, test } from 'bun:test'
import {
  type AnyNodeId,
  clearSceneHistory,
  emitter,
  type FloorplanMoveTargetSession,
  type GridEvent,
  pauseSceneHistory,
  resumeSceneHistory,
  useLiveNodeOverrides,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { act, create } from '@react-three/test-renderer'
import { createElement, type ReactNode } from 'react'
import { createSessionWrites } from '../../../editor/src/lib/session-writes'
import useEditor from '../../../editor/src/store/use-editor'
import useInteractionScope from '../../../editor/src/store/use-interaction-scope'
import {
  expectCancelRestores,
  expectCommitIsOneUndoStep,
  expectPreviewMatchesCommit,
  expectRemoteEditSurvives,
  type LiveGesture,
  seedRoundTripScene,
} from '../../../editor/src/test-utils/live-gesture-round-trip'
import { wallMoveEndpointAffordance } from './floorplan-affordances'
import { wallFloorplanMoveTarget } from './floorplan-move'
import { MoveWallEndpointTool } from './move-endpoint-tool'
import { MoveWallTool } from './move-tool'

// The wall's own live gestures (3D endpoint and body drags, and the floor
// plan's sessions) under the editor's round-trip harness: Escape leaves every
// node — the derived plates, ceilings and zones included — exactly as before,
// and a release is one undo step.

const LEVEL = 'level_wall_round_trip'
const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
let stop = () => {}
let html: { mockRestore: () => void } | null = null

const nodes = () => useScene.getState().nodes
const eastWall = () =>
  Object.values(nodes()).find(
    (n): n is WallNode => n.type === 'wall' && n.start[0] === 6 && n.end[0] === 6,
  )!
const endAt = (wall: WallNode, point: readonly [number, number]) =>
  wall.end[0] === point[0] && wall.end[1] === point[1] ? 'end' : 'start'
const hasOverrides = () => useLiveNodeOverrides.getState().overrides.size > 0

function grid(x: number, z: number) {
  emitter.emit('grid:move', {
    position: [x, 0, z],
    localPosition: [x, 0, z],
    nativeEvent: { altKey: false },
  } as unknown as GridEvent)
}
const pointerUp = () => window.dispatchEvent(new Event('pointerup'))

beforeAll(() => {
  globalThis.window = new EventTarget() as Window & typeof globalThis
  // Measurement pills and hints are DOM labels; there is no DOM here.
  html = spyOn(Html as unknown as { render: () => ReactNode }, 'render').mockImplementation(
    () => null,
  )
})
afterAll(async () => {
  // Let the tools' click-swallow timers fire before the stub goes.
  await new Promise((resolve) => setTimeout(resolve, 350))
  html?.mockRestore()
  if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow)
  else Reflect.deleteProperty(globalThis, 'window')
})

beforeEach(() => {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  useInteractionScope.getState().end()
  useScene.temporal.getState().resume()
  ;({ stop } = seedRoundTripScene('building_wall_round_trip', LEVEL))
  useViewer.getState().setSelection({
    buildingId: 'building_wall_round_trip',
    levelId: LEVEL,
    selectedIds: [],
  })
  useEditor.setState({ phase: 'structure', mode: 'select', gridSnapStep: 0.5 })
  clearSceneHistory()
})

afterEach(() => {
  useLiveNodeOverrides.getState().clearAll()
  useEditor.getState().setMovingNode(null)
  stop()
})

/** A mounted 3D wall tool: Escape (`tool:cancel`) or a release ends it, then it unmounts. */
function mountedTool(element: () => ReturnType<typeof createElement>, drive: () => void) {
  let renderer: Awaited<ReturnType<typeof create>> | null = null
  const unmount = async () => {
    await renderer?.unmount()
    renderer = null
  }
  return {
    start: async () => {
      renderer = await create(element())
      await act(async () => drive())
    },
    previewed: hasOverrides,
    cancel: async () => {
      await act(async () => {
        emitter.emit('tool:cancel')
        // Still holding the button when Escape lands: the release comes
        // before the tool unmounts, and must not commit what was cancelled.
        pointerUp()
      })
      await unmount()
    },
    commit: async () => {
      await act(async () => pointerUp())
      await unmount()
    },
  } satisfies LiveGesture
}

/**
 * A floor-plan session as its dispatchers run it: paused preview with the
 * session's own writes recorded, taken back on Escape and before the commit.
 */
function planSession(
  begin: () => FloorplanMoveTargetSession,
  drive: (s: FloorplanMoveTargetSession) => void,
) {
  let session: FloorplanMoveTargetSession | null = null
  let writes = createSessionWrites()
  return {
    start: () => {
      session = begin()
      writes = createSessionWrites()
      pauseSceneHistory(useScene)
      writes.record(() => drive(session!))
    },
    previewed: hasOverrides,
    cancel: () => {
      writes.revert()
      for (const id of session!.affectedIds) useLiveNodeOverrides.getState().clear(id)
      resumeSceneHistory(useScene)
    },
    commit: () => {
      writes.revert()
      resumeSceneHistory(useScene)
      session!.commit?.()
    },
  } satisfies LiveGesture
}

const modifiers = { altKey: false, shiftKey: false, ctrlKey: false, metaKey: false }

const gestures: Record<string, () => LiveGesture> = {
  'endpoint drag (3D)': () => {
    const wall = eastWall()
    const endpoint = endAt(wall, [6, 4])
    return mountedTool(
      () => createElement(MoveWallEndpointTool, { target: { wall, endpoint } }),
      () => {
        grid(7, 4.5)
        grid(7.5, 5)
      },
    )
  },
  'wall body move (3D)': () => {
    const wall = eastWall()
    return mountedTool(
      () => createElement(MoveWallTool, { node: wall }),
      () => {
        grid(6, 2)
        grid(7.2, 2)
      },
    )
  },
  'endpoint drag (floor plan)': () =>
    planSession(
      () => {
        const wall = eastWall()
        return wallMoveEndpointAffordance.start({
          node: wall,
          payload: { wallId: wall.id, endpoint: endAt(wall, [6, 4]) },
          nodes: nodes(),
          initialPlanPoint: [6, 4],
          gridSnapStep: 0.5,
          sceneApi: {} as never,
        }) as unknown as FloorplanMoveTargetSession
      },
      (session) => session.apply({ planPoint: [7.5, 5], modifiers }),
    ),
  'wall body move (floor plan)': () =>
    planSession(
      () => wallFloorplanMoveTarget({ node: eastWall(), nodes: nodes(), sceneApi: {} as never }),
      (session) => {
        session.apply({ planPoint: [6, 2], modifiers })
        session.apply({ planPoint: [7.2, 2], modifiers })
      },
    ),
}

describe('wall live gestures: Escape restores exactly, release is one undo step', () => {
  for (const [name, gesture] of Object.entries(gestures)) {
    test(`${name}: cancel`, () => expectCancelRestores(gesture()))
    test(`${name}: commit`, () => expectCommitIsOneUndoStep(gesture()))
    test(`${name}: a collaborator's edit mid-drag survives`, () =>
      expectRemoteEditSurvives(gesture, () => eastWall().id as AnyNodeId))
  }
  // The endpoint drags draw no floors live; the body moves do.
  for (const name of ['wall body move (3D)', 'wall body move (floor plan)'])
    test(`${name}: the preview is the commit, and only what it reshapes`, () =>
      expectPreviewMatchesCommit(gestures[name]!()))
})
