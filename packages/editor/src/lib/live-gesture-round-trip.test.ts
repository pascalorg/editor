import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import {
  type AnyNodeId,
  clearSceneHistory,
  createMezzanine,
  createZoneDivisionContext,
  generateId,
  nodeRegistry,
  type SlabNode,
  useLiveNodeOverrides,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'
import { installImmediateAnimationFrames } from '../test-utils/immediate-animation-frames'
import {
  expectCancelRestores,
  expectCommitIsOneUndoStep,
  expectPreviewMatchesCommit,
  expectRemoteEditSurvives,
  type LiveGesture,
  seedRoundTripScene,
} from '../test-utils/live-gesture-round-trip'
import { beginFootprintHeightPreview } from './floor-footprints'
import { cancelGestures } from './gesture-lifecycle'
import { roomRelativeFloorHeight, stepRoomFloorElevation } from './room-construction-commands'
import {
  commitRoomElevation,
  mezzanineEdgeHandles,
  roomFloorElevation,
  roomPushHandles,
  runFloorplanMezzanineEdge,
  runFloorplanRoomPush,
  runFloorplanWallPush,
  runRoomHandleDrag,
  runWallPushDrag,
  useRoomHandleDrag,
  wallPushHandles,
} from './room-handle-drag'
import { applyRoomPlan } from './room-structure-commands'
import {
  cancelRoomTransform,
  commitRoomTransform,
  previewRoomTransform,
  startRoomTransform,
  useRoomTransform,
} from './room-transform-session'

// Every live gesture that can reshape the building (walls, and the plates,
// ceilings and zones derived from them): Escape puts the scene back exactly,
// release is one undo step that the derived nodes ride. The wall tools
// mounted from the nodes package run the same harness there.

const LEVEL = 'level_live_round_trip'
const stubbed: string[] = []
let stop = () => {}
let restoreFrames = () => {}
let registry: { mockRestore: () => void } | null = null
let zoneId = ''

const nodes = () => useScene.getState().nodes
const eastWall = () =>
  Object.values(nodes()).find(
    (n): n is WallNode => n.type === 'wall' && n.start[0] === 6 && n.end[0] === 6,
  )!
const basePlate = () =>
  Object.values(nodes()).find((n): n is SlabNode => n.type === 'slab' && n.plateRole === 'base')!

function pointer(type: 'pointermove' | 'pointerup', clientX: number, clientY = 0) {
  window.dispatchEvent(Object.assign(new Event(type), { clientX, clientY }))
}
function press(key: string) {
  window.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key }))
}
const hasOverrides = () => useLiveNodeOverrides.getState().overrides.size > 0
// Plan coordinates straight from the client point: x → plan x, y → plan z.
const toPlan = (x: number, y: number) => [x, y] as const

beforeEach(() => {
  restoreFrames = installImmediateAnimationFrames()
  if (!globalThis.document) {
    globalThis.document = { body: { style: { cursor: '' } } } as unknown as Document
    stubbed.push('document')
  }
  if (!globalThis.window) {
    globalThis.window = new EventTarget() as Window & typeof globalThis
    stubbed.push('window')
  }
  // The nodes package that registers walls is not loaded here.
  const get = nodeRegistry.get.bind(nodeRegistry)
  registry = spyOn(nodeRegistry, 'get').mockImplementation(((kind: string) =>
    kind === 'wall' ? { snapProfile: 'structural' } : get(kind)) as typeof nodeRegistry.get)
  cancelGestures('cancel')
  useInteractionScope.getState().end()
  useScene.temporal.getState().resume()
  ;({ stop, zoneId } = seedRoundTripScene('building_live_round_trip', LEVEL))
  useViewer.getState().setSelection({
    buildingId: 'building_live_round_trip',
    levelId: LEVEL,
    selectedIds: [],
  })
  useEditor.setState({ phase: 'building', mode: 'select', gridSnapStep: 0.5 })
  useEditor.getState().setSnappingMode('polygon', 'grid')
  clearSceneHistory()
})

afterEach(() => {
  cancelGestures('cancel')
  cancelRoomTransform()
  useRoomTransform.setState({ session: null })
  useLiveNodeOverrides.getState().clearAll()
  stop()
  registry?.mockRestore()
  registry = null
  restoreFrames()
})

afterAll(async () => {
  // Let the click-swallow timers fire before the stubs go.
  await new Promise((resolve) => setTimeout(resolve, 350))
  for (const key of stubbed.splice(0)) delete (globalThis as Record<string, unknown>)[key]
})

const gestures: Record<string, () => LiveGesture> = {
  'wall push arrow (3D)': () => ({
    start: () => {
      const handle = wallPushHandles(eastWall(), nodes()).find((h) => h.outward[0] > 0.5)!
      runWallPushDrag({ handle, levelId: LEVEL, from: 0, along: (clientX) => clientX })
      pointer('pointermove', 1.2)
    },
    previewed: hasOverrides,
    cancel: () => press('Escape'),
    commit: () => pointer('pointerup', 1.2),
  }),
  'wall push arrow (floor plan)': () => ({
    start: () => {
      const toPlan = (x: number, y: number) => [x, y] as const
      runFloorplanWallPush({ wallId: eastWall().id, side: 'b' }, 6.4, 2, toPlan)
      pointer('pointermove', 7.6, 2)
    },
    previewed: hasOverrides,
    cancel: () => press('Escape'),
    commit: () => pointer('pointerup', 7.6, 2),
  }),
  'room push chevron (floor plan)': () => ({
    start: () => {
      const spans = createZoneDivisionContext(nodes(), zoneId).face!.spans
      const handle = roomPushHandles(nodes(), spans).find((h) => h.outward[0] > 0.5)!
      const [x, z] = handle.position
      runFloorplanRoomPush({ handle, levelId: LEVEL, zoneId, clientX: x, clientY: z, toPlan })
      pointer('pointermove', x + 1.2, z + 0.3)
    },
    previewed: hasOverrides,
    cancel: () => press('Escape'),
    commit: () => {
      const drag = useRoomHandleDrag.getState().drag
      if (drag?.kind !== 'push') throw new Error('no push drag')
      pointer('pointerup', drag.anchor[0] + 1.2, drag.anchor[1] + 0.3)
    },
  }),
  'room floor elevation': () => ({
    start: () => {
      let value = 0
      runRoomHandleDrag({
        label: 'room-elevation',
        nodeId: zoneId,
        zoneId,
        levelId: LEVEL,
        requires: [zoneId],
        sample: (clientX) => clientX,
        onValue: (next) => {
          value = next
        },
        onCommit: () => commitRoomElevation(zoneId, value),
        onCancel: () => {},
      })
      pointer('pointermove', 0.45)
    },
    cancel: () => press('Escape'),
    commit: () => pointer('pointerup', 0.45),
  }),
  'room move': () => ({
    start: () => {
      const zone = nodes()[zoneId as AnyNodeId] as { polygon: [number, number][] }
      startRoomTransform('move', {
        zoneId,
        levelId: LEVEL,
        outline: [zone.polygon],
        walls: [],
        floorY: 0,
      })
      previewRoomTransform([2, 1], 0)
    },
    previewed: () => useRoomTransform.getState().session?.valid === true,
    cancel: () => press('Escape'),
    commit: () => commitRoomTransform(),
  }),
  'footprint height': () => {
    let preview: ReturnType<typeof beginFootprintHeightPreview> | null = null
    return {
      start: () => {
        preview = beginFootprintHeightPreview(basePlate().id)
        preview.preview(0.3)
        preview.preview(0.6)
      },
      // The preview writes the building itself, outside history.
      previewed: () => (basePlate().floorHeight ?? 0) > 0.5,
      cancel: () => preview?.cancel(),
      commit: () => preview?.commit(0.6),
    }
  },
}

// A raised footprint moves its walls and room floors, not the plate outlines.
const derivedTypes: Record<string, readonly string[]> = {
  'room floor elevation': ['slab'],
  'footprint height': ['slab'],
}

// The node a collaborator edits mid-gesture: one the gesture itself writes.
const remoteTargets: Record<string, () => AnyNodeId> = {
  'room floor elevation': () => zoneId as AnyNodeId,
  'room move': () => zoneId as AnyNodeId,
  'footprint height': () => basePlate().id as AnyNodeId,
}

describe('live gestures: Escape restores exactly, release is one undo step', () => {
  for (const [name, gesture] of Object.entries(gestures)) {
    test(`${name}: cancel`, () => expectCancelRestores(gesture()))
    test(`${name}: commit`, () => expectCommitIsOneUndoStep(gesture(), derivedTypes[name]))
    test(`${name}: a collaborator's edit mid-gesture survives`, () =>
      expectRemoteEditSurvives(gesture, remoteTargets[name] ?? (() => eastWall().id as AnyNodeId)))
  }
  for (const name of [
    'wall push arrow (3D)',
    'wall push arrow (floor plan)',
    'room push chevron (floor plan)',
  ])
    test(`${name}: the preview is the commit, and only what it reshapes`, () =>
      expectPreviewMatchesCommit(gestures[name]!()))
})

test('the push drag’s room floor preview is drawn from overrides and rebuilt on Escape', async () => {
  // Guards the harness itself: the push previews the derived room surfaces.
  await expectCancelRestores({
    start: () => {
      const handle = wallPushHandles(eastWall(), nodes()).find((h) => h.outward[0] > 0.5)!
      runWallPushDrag({ handle, levelId: LEVEL, from: 0, along: (clientX) => clientX })
      pointer('pointermove', 1.2)
      if (!useLiveNodeOverrides.getState().overrides.has(zoneId))
        throw new Error('the push did not preview the room')
      if (useRoomHandleDrag.getState().drag?.kind !== 'push') throw new Error('no push drag')
    },
    cancel: () => press('Escape'),
    commit: () => {},
  })
})

describe('the plan’s mezzanine edge arrows', () => {
  let mezzanineId = ''
  beforeEach(() => {
    useScene.getState().updateNodes([{ id: LEVEL as AnyNodeId, data: { height: 5 } }])
    const plan = createMezzanine(nodes(), {
      hostZoneId: zoneId,
      polygon: [
        [1, 1],
        [4, 1],
        [4, 3],
        [1, 3],
      ],
      mintId: generateId,
    })
    applyRoomPlan(plan)
    mezzanineId = plan.zoneId
    clearSceneHistory()
  })

  const edgeDrag = (): LiveGesture => ({
    start: () => {
      const handle = mezzanineEdgeHandles(nodes(), mezzanineId).find((h) => h.outward[0] > 0.5)!
      const [x, z] = handle.position
      runFloorplanMezzanineEdge({
        handle,
        levelId: LEVEL,
        zoneId: mezzanineId,
        clientX: x,
        clientY: z,
        toPlan,
      })
      pointer('pointermove', x + 1.2, z)
    },
    previewed: () => useRoomHandleDrag.getState().drag?.kind === 'mezzanine-edge',
    cancel: () => press('Escape'),
    commit: () => {
      const drag = useRoomHandleDrag.getState().drag
      if (drag?.kind !== 'mezzanine-edge') throw new Error('no edge drag')
      pointer('pointerup', drag.anchor[0] + 1.2, drag.anchor[1])
    },
  })

  test('cancel restores exactly', () => expectCancelRestores(edgeDrag()))
  test('commit is one undo step', () => expectCommitIsOneUndoStep(edgeDrag()))
  test('a collaborator’s edit mid-drag survives', () =>
    expectRemoteEditSurvives(edgeDrag, () => mezzanineId as AnyNodeId))
  test('the outline the drag draws is the one the release commits', () => {
    const gesture = edgeDrag()
    gesture.start()
    const drag = useRoomHandleDrag.getState().drag
    if (drag?.kind !== 'mezzanine-edge') throw new Error('no edge drag')
    const outline = JSON.stringify(drag.outline)
    gesture.commit()
    const zone = nodes()[mezzanineId as AnyNodeId] as { polygon: unknown }
    expect(JSON.stringify(zone.polygon)).toBe(outline)
  })
})

describe('the plan pill’s floor height stepper', () => {
  const height = () => roomRelativeFloorHeight(nodes(), zoneId)
  test('steps the room floor 5 cm at a time, one undo step a click', async () => {
    await expectCommitIsOneUndoStep(
      {
        start: () => {},
        cancel: () => {},
        commit: () => {
          const next = stepRoomFloorElevation(nodes(), zoneId, 0.05)
          if (next === null) throw new Error('refused')
          commitRoomElevation(zoneId, next)
        },
      },
      ['zone', 'slab'],
    )
    expect(height()).toBe(0)
    commitRoomElevation(zoneId, stepRoomFloorElevation(nodes(), zoneId, 0.05)!)
    commitRoomElevation(zoneId, stepRoomFloorElevation(nodes(), zoneId, 0.05)!)
    expect(height()).toBeCloseTo(0.1)
    commitRoomElevation(zoneId, stepRoomFloorElevation(nodes(), zoneId, -0.05)!)
    expect(height()).toBeCloseTo(0.05)
  })
  test('an off-grid height lands on the next 5 cm step', () => {
    commitRoomElevation(zoneId, roomFloorElevation(nodes(), zoneId) + 0.12)
    const up = stepRoomFloorElevation(nodes(), zoneId, 0.05)!
    const down = stepRoomFloorElevation(nodes(), zoneId, -0.05)!
    const base = roomFloorElevation(nodes(), zoneId) - height()
    expect(up - base).toBeCloseTo(0.15)
    expect(down - base).toBeCloseTo(0.1)
  })
  test('the clamp stops it: at the highest floor the room allows, raising reports no step', () => {
    let guard = 0
    let next = stepRoomFloorElevation(nodes(), zoneId, 0.05)
    while (next !== null && guard++ < 200) {
      commitRoomElevation(zoneId, next)
      next = stepRoomFloorElevation(nodes(), zoneId, 0.05)
    }
    expect(next).toBeNull()
    expect(guard).toBeLessThan(200)
    expect(height()).toBeGreaterThan(0)
  })
})
