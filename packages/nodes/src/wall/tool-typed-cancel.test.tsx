import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import {
  BuildingNode,
  createSceneApi,
  emitter,
  type GridEvent,
  LevelNode,
  useScene,
} from '@pascal-app/core'
import {
  cancelActiveTool,
  getWallDrawVariant,
  PLACEMENT_TYPING_LENGTH_ANGLE,
  RegistryToolProvider,
  sceneLayout,
  selectWallDrawVariant,
  useEditor,
  useFloorplanDraftPreview,
  usePlacementTyping,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { act, create } from '@react-three/test-renderer'
import type { ReactNode } from 'react'
import WallTool from './tool'

const building = BuildingNode.parse({ id: 'building_typed_cancel' })
const level = LevelNode.parse({ id: 'level_typed_cancel', parentId: building.id })

let canvas: EventTarget | null = null
function CanvasProbe() {
  canvas = useThree((state) => state.gl.domElement)
  return null
}

function grid(x: number, z: number): GridEvent {
  return {
    position: [x, 0, z],
    localPosition: [x, 0, z],
    nativeEvent: { target: canvas, button: 0, detail: 1 } as unknown as GridEvent['nativeEvent'],
  }
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
  // The draft's labels and the typing HUD are DOM overlays; there is no DOM here.
  htmlLabels = spyOn(Html as unknown as { render: () => ReactNode }, 'render').mockImplementation(
    () => null,
  )
  // The tool listens for typed keys on window; there is no DOM here.
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

test('a cancel from any source first ends the typed session, then the draft', async () => {
  const renderer = await create(
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
  const draftStart = () => useFloorplanDraftPreview.getState().wallDraftStart
  try {
    await act(async () => emitter.emit('grid:click', grid(0, 0)))
    await act(async () => emitter.emit('grid:move', grid(2, 0)))
    expect(draftStart()).toEqual([0, 0])
    await act(async () => {
      usePlacementTyping.getState().begin({ labels: PLACEMENT_TYPING_LENGTH_ANGLE })
      usePlacementTyping.getState().append('3')
    })

    // The path ⌘Z takes mid-draft, not a keydown the tool sees itself.
    await act(async () => {
      expect(cancelActiveTool()).toBe(true)
    })
    expect(usePlacementTyping.getState().isActive).toBe(false)
    expect(draftStart()).toEqual([0, 0])
    expect(useEditor.getState().mode).toBe('build')
    expect(useEditor.getState().tool).toBe('wall')

    await act(async () => {
      expect(cancelActiveTool()).toBe(true)
    })
    expect(draftStart()).toBeNull()
    expect(useEditor.getState().tool).toBe('wall')
  } finally {
    await renderer.unmount()
  }
})
