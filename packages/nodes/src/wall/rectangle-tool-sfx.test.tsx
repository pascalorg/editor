import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import {
  BuildingNode,
  createSceneApi,
  emitter,
  type GridEvent,
  LevelNode,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { act, create } from '@react-three/test-renderer'
import type { ReactNode } from 'react'
import { RegistryToolProvider } from '../../../editor/src/components/tools/registry-tool-context'
import { sfxEmitter } from '../../../editor/src/lib/sfx-bus'
import { useFloorplanDraftPreview } from '../../../editor/src/store/use-floorplan-draft-preview'
import RectangleWallTool from './rectangle-tool'

const building = BuildingNode.parse({ id: 'building_rectangle_sfx' })
const level = LevelNode.parse({ id: 'level_rectangle_sfx', parentId: building.id })

let canvas: EventTarget | null = null
function CanvasProbe() {
  canvas = useThree((state) => state.gl.domElement)
  return null
}

const sounds: string[] = []
const record = (name: string) => () => sounds.push(name)
const listeners = {
  'sfx:structure-build-start': record('start'),
  'sfx:structure-build': record('build'),
  'sfx:grid-snap': record('tick'),
} as const

function grid(x: number, z: number): GridEvent {
  return {
    position: [x, 0, z],
    localPosition: [x, 0, z],
    nativeEvent: { target: canvas, button: 0 } as unknown as GridEvent['nativeEvent'],
  }
}

let savedScene: ReturnType<typeof useScene.getState>
let htmlLabels: ReturnType<typeof spyOn>
beforeEach(() => {
  // The cursor bubble and the side lengths are DOM labels; there is no DOM here.
  htmlLabels = spyOn(Html as unknown as { render: () => ReactNode }, 'render').mockImplementation(
    () => null,
  )
  sounds.length = 0
  for (const [event, listener] of Object.entries(listeners))
    sfxEmitter.on(event as keyof typeof listeners, listener)
  savedScene = useScene.getState()
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
})
afterEach(() => {
  htmlLabels.mockRestore()
  for (const [event, listener] of Object.entries(listeners))
    sfxEmitter.off(event as keyof typeof listeners, listener)
  useScene.setState(savedScene)
})

test('a Rectangle room sounds like a wall draft: start, ticks, then built', async () => {
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
      <RectangleWallTool />
    </RegistryToolProvider>,
  )
  try {
    await act(async () => emitter.emit('grid:click', grid(0, 0)))
    expect(sounds).toEqual(['start'])
    await act(async () => emitter.emit('grid:move', grid(2, 1)))
    await act(async () => emitter.emit('grid:move', grid(2, 1)))
    await act(async () => emitter.emit('grid:move', grid(3, 2)))
    expect(sounds).toEqual(['start', 'tick', 'tick'])
    await act(async () => emitter.emit('grid:click', grid(3, 2)))
    expect(sounds).toEqual(['start', 'tick', 'tick', 'build'])
    expect(Object.values(useScene.getState().nodes).filter((n) => n.type === 'wall')).toHaveLength(
      4,
    )
  } finally {
    await renderer.unmount()
  }
})

test('the first corner is mirrored out of tree until the room lands or is dropped', async () => {
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
      <RectangleWallTool />
    </RegistryToolProvider>,
  )
  const start = () => useFloorplanDraftPreview.getState().wallRectangleDraftStart
  try {
    await act(async () => emitter.emit('grid:click', grid(0, 0)))
    expect(start()).toEqual([0, 0])
    await act(async () => emitter.emit('grid:click', grid(3, 2)))
    expect(start()).toBeNull()
    await act(async () => emitter.emit('grid:click', grid(1, 1)))
    expect(start()).toEqual([1, 1])
    await act(async () => emitter.emit('tool:cancel'))
    expect(start()).toBeNull()
  } finally {
    await renderer.unmount()
  }
})
