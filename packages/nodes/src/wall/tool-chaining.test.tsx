import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import {
  BuildingNode,
  createSceneApi,
  emitter,
  findOpenWallEnds,
  type GridEvent,
  LevelNode,
  useScene,
  WallNode,
} from '@pascal-app/core'
import {
  getWallDrawVariant,
  PLACEMENT_TYPING_LENGTH_ANGLE,
  RegistryToolProvider,
  sceneLayout,
  selectWallDrawVariant,
  useEditor,
  useFloorplanDraftPreview,
  usePlacementTyping,
  useSegmentDraftChain,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { act, create } from '@react-three/test-renderer'
import type { ReactNode } from 'react'
import WallTool from './tool'

const building = BuildingNode.parse({ id: 'building_wall_chaining' })
const level = LevelNode.parse({ id: 'level_wall_chaining', parentId: building.id })

let canvas: EventTarget | null = null
function CanvasProbe() {
  canvas = useThree((state) => state.gl.domElement)
  return null
}

function grid(x: number, z: number, detail = 1): GridEvent {
  return {
    position: [x, 0, z],
    localPosition: [x, 0, z],
    nativeEvent: { target: canvas, button: 0, detail } as unknown as GridEvent['nativeEvent'],
  }
}

function levelWalls(): WallNode[] {
  return Object.values(useScene.getState().nodes).filter(
    (node): node is WallNode => node?.type === 'wall' && node.parentId === level.id,
  )
}

function mountWallTool() {
  return create(
    <RegistryToolProvider
      value={{
        activeLevelId: level.id,
        isCameraDragging: () => false,
        sceneApi: createSceneApi(),
        selectNode: () => {},
        unit: 'metric',
      }}
    >
      <CanvasProbe />
      <WallTool />
    </RegistryToolProvider>,
  )
}

let savedScene: ReturnType<typeof useScene.getState>
let savedEditor: ReturnType<typeof useEditor.getState>
let savedVariant: ReturnType<typeof getWallDrawVariant>
const DOM_GLOBALS = [
  'window',
  'HTMLCanvasElement',
  'cancelAnimationFrame',
  'IS_REACT_ACT_ENVIRONMENT',
] as const
let savedGlobals: (PropertyDescriptor | undefined)[] = []
let htmlLabels: ReturnType<typeof spyOn>

beforeEach(() => {
  htmlLabels = spyOn(Html as unknown as { render: () => ReactNode }, 'render').mockImplementation(
    () => null,
  )
  savedGlobals = DOM_GLOBALS.map((key) => Object.getOwnPropertyDescriptor(globalThis, key))
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: new EventTarget() },
    HTMLCanvasElement: { configurable: true, value: class {} },
    cancelAnimationFrame: { configurable: true, value: () => {} },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  })
  savedScene = useScene.getState()
  savedEditor = useEditor.getState()
  useScene.setState({
    nodes: {
      [building.id]: { ...building, children: [level.id] },
      [level.id]: level,
    },
    rootNodeIds: [building.id],
    dirtyNodes: new Set(),
    readOnly: false,
  })
  useViewer.getState().setSelection({ buildingId: building.id, levelId: level.id })
  useEditor.getState().setViewLayout(sceneLayout('3d'))
  useEditor.getState().setSnappingMode('wall', 'grid')
  useEditor.getState().setGridSnapStep(0.5)
  useEditor.getState().armToolMode({ mode: 'build', tool: 'wall' })
  savedVariant = getWallDrawVariant()
  selectWallDrawVariant('walls')
  usePlacementTyping.getState().clear()
})

afterEach(() => {
  htmlLabels.mockRestore()
  usePlacementTyping.getState().clear()
  selectWallDrawVariant(savedVariant)
  DOM_GLOBALS.forEach((key, index) => {
    const saved = savedGlobals[index]
    if (saved) Object.defineProperty(globalThis, key, saved)
    else delete (globalThis as Record<string, unknown>)[key]
  })
  useScene.setState(savedScene)
  useEditor.setState(savedEditor)
})

test('Walls mode chains consecutive off-grid typed walls from exact resolved endpoints with zero open ends', async () => {
  const renderer = await mountWallTool()
  const draftStart = () => useFloorplanDraftPreview.getState().wallDraftStart
  try {
    // Start at [0, 0] in default 0.5m grid mode
    await act(async () => emitter.emit('grid:click', grid(0, 0)))
    expect(draftStart()).toEqual([0, 0])

    // Wall 1: 3.2m along +X (off the 0.5m grid)
    await act(async () => emitter.emit('grid:move', grid(4, 0)))
    await act(async () => {
      usePlacementTyping.getState().begin({ labels: PLACEMENT_TYPING_LENGTH_ANGLE })
      usePlacementTyping.getState().append('3.2')
    })
    await act(async () => emitter.emit('grid:click', grid(4, 0)))
    expect(draftStart()).toEqual([3.2, 0])

    // Wall 2: 2.7m along +Z directly from [3.2, 0] (no manual re-click)
    await act(async () => emitter.emit('grid:move', grid(3.2, 4)))
    await act(async () => {
      usePlacementTyping.getState().begin({ labels: PLACEMENT_TYPING_LENGTH_ANGLE })
      usePlacementTyping.getState().append('2.7')
    })
    await act(async () => emitter.emit('grid:click', grid(3.2, 4)))
    expect(draftStart()?.[0]).toBeCloseTo(3.2, 5)
    expect(draftStart()?.[1]).toBeCloseTo(2.7, 5)

    // Wall 3: 3.2m along -X
    await act(async () => emitter.emit('grid:move', grid(0, 2.7)))
    await act(async () => {
      usePlacementTyping.getState().begin({ labels: PLACEMENT_TYPING_LENGTH_ANGLE })
      usePlacementTyping.getState().append('3.2')
    })
    await act(async () => emitter.emit('grid:click', grid(0, 2.7)))
    expect(draftStart()?.[0]).toBeCloseTo(0, 5)
    expect(draftStart()?.[1]).toBeCloseTo(2.7, 5)

    // Wall 4: 2.7m along -Z closing back to [0, 0] -> auto-stops cleanly
    await act(async () => emitter.emit('grid:move', grid(0, 0)))
    await act(async () => {
      usePlacementTyping.getState().begin({ labels: PLACEMENT_TYPING_LENGTH_ANGLE })
      usePlacementTyping.getState().append('2.7')
    })
    await act(async () => emitter.emit('grid:click', grid(0, 0)))

    expect(draftStart()).toBeNull()
    expect(levelWalls()).toHaveLength(4)
    expect(findOpenWallEnds(useScene.getState().nodes, level.id)).toEqual([])
  } finally {
    await renderer.unmount()
  }
})

test('collinear transit advances draft origin along an existing wall centerline so a branch T-joins cleanly', async () => {
  const host = WallNode.parse({
    id: 'wall_host',
    parentId: level.id,
    start: [0, 0],
    end: [6, 0],
  })
  useScene.setState((state) => ({
    nodes: {
      ...state.nodes,
      [level.id]: { ...level, children: [host.id] },
      [host.id]: host,
    },
  }))

  const renderer = await mountWallTool()
  const draftStart = () => useFloorplanDraftPreview.getState().wallDraftStart
  try {
    // Start at the host wall's [0, 0] corner and track 2.3m along its centerline
    await act(async () => emitter.emit('grid:click', grid(0, 0)))
    await act(async () => emitter.emit('grid:move', grid(4, 0)))
    await act(async () => {
      usePlacementTyping.getState().begin({ labels: PLACEMENT_TYPING_LENGTH_ANGLE })
      usePlacementTyping.getState().append('2.3')
    })
    await act(async () => emitter.emit('grid:click', grid(4, 0)))

    // No duplicate wall created; draft origin advanced to [2.3, 0] on the host centerline
    expect(levelWalls()).toHaveLength(1)
    expect(draftStart()?.[0]).toBeCloseTo(2.3, 5)
    expect(draftStart()?.[1]).toBeCloseTo(0, 5)

    // Branch perpendicular 3m along +Z -> splits host wall and T-joins cleanly
    await act(async () => emitter.emit('grid:move', grid(2.3, 4)))
    await act(async () => {
      usePlacementTyping.getState().begin({ labels: PLACEMENT_TYPING_LENGTH_ANGLE })
      usePlacementTyping.getState().append('3')
    })
    await act(async () => emitter.emit('grid:click', grid(2.3, 4)))

    // Double-click finishes the open branch
    await act(async () => emitter.emit('grid:click', grid(2.3, 3, 2)))
    expect(draftStart()).toBeNull()

    // Host wall was split at [2.3, 0] and joined with the branch (3 wall segments total)
    expect(levelWalls()).toHaveLength(3)
    const joinableGaps = findOpenWallEnds(useScene.getState().nodes, level.id).filter(
      (end) => end.candidate,
    )
    expect(joinableGaps).toEqual([])
  } finally {
    await renderer.unmount()
  }
})

test('first click publishes chain start so a refused first commit keeps split-view synced until cancel', async () => {
  // Two very closely spaced parallel walls trigger a sliver refusal on a crossing draft
  const wallA = WallNode.parse({
    id: 'wall_sliver_a',
    parentId: level.id,
    start: [1, -2],
    end: [1, 2],
  })
  const wallB = WallNode.parse({
    id: 'wall_sliver_b',
    parentId: level.id,
    start: [1.005, -2],
    end: [1.005, 2],
  })
  useScene.setState((state) => ({
    nodes: {
      ...state.nodes,
      [level.id]: { ...level, children: [wallA.id, wallB.id] },
      [wallA.id]: wallA,
      [wallB.id]: wallB,
    },
  }))

  const renderer = await mountWallTool()
  try {
    await act(async () => emitter.emit('grid:click', grid(0, 0)))
    expect(useSegmentDraftChain.getState().wall).toEqual([0, 0])
    expect(useSegmentDraftChain.getState().wallOutcome).toBe('active')

    // Attempt a crossing that planWallInsertion refuses (not collinear transit)
    await act(async () => emitter.emit('grid:click', grid(3, 0)))
    expect(levelWalls()).toHaveLength(2)
    // Chain start remains published with outcome 'refused' so split-view 2D neither
    // tears down nor clears typed fields / run reference
    expect(useSegmentDraftChain.getState().wall).toEqual([0, 0])
    expect(useSegmentDraftChain.getState().wallOutcome).toBe('refused')
    expect(useFloorplanDraftPreview.getState().wallDraftStart).toEqual([0, 0])

    // Canceling clears the published chain start and resets outcome
    await act(async () => emitter.emit('tool:cancel'))
    expect(useSegmentDraftChain.getState().wall).toBeNull()
    expect(useSegmentDraftChain.getState().wallOutcome).toBe('idle')
  } finally {
    await renderer.unmount()
  }
})
