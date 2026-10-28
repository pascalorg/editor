import { afterEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  clearSceneHistory,
  emitter,
  type FootingNode,
  type GridEvent,
  LevelNode,
  useScene,
} from '@pascal-app/core'
import {
  getFloorplanNodeExtension,
  sceneLayout,
  useEditor,
  usePlacementPreview,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { createElement } from 'react'
import { footingDefinition } from './definition'
import { FootingFloorplanTool } from './tool'

type RafFn = (cb: (time: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (cb) => {
  cb(0)
  return 0
}
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const previous = { editor: useEditor.getState(), viewer: useViewer.getState() }

afterEach(() => {
  useEditor.setState(previous.editor, true)
  useViewer.setState(previous.viewer, true)
  usePlacementPreview.getState().clear()
})

function setScene() {
  const building = BuildingNode.parse({})
  const ground = LevelNode.parse({ parentId: building.id, level: 0, height: 3 })
  const upper = LevelNode.parse({ parentId: building.id, level: 1, height: 3 })
  building.children = [ground.id, upper.id]
  const nodes = Object.fromEntries([building, ground, upper].map((node) => [node.id, node]))
  useScene.getState().setScene(nodes as Record<AnyNodeId, AnyNode>, [building.id as AnyNodeId], {
    installedPlugins: [],
    hasExplicitPluginInstallState: false,
  })
  clearSceneHistory()
  useViewer.getState().setSelection({ buildingId: building.id, levelId: upper.id })
  useEditor.setState({
    mode: 'build',
    tool: 'footing',
    toolDefaults: { ...useEditor.getState().toolDefaults, footing: { shape: 'strip' } },
    workspaceMode: 'edit',
  })
  return { ground, upper }
}

const footings = () =>
  Object.values(useScene.getState().nodes).filter(
    (node): node is FootingNode => node.type === 'footing',
  )

const gridEvent = (x: number, z: number) =>
  ({
    position: [x, 0, z],
    localPosition: [x, 0, z],
    nativeEvent: { altKey: true } as GridEvent['nativeEvent'],
  }) satisfies GridEvent

const move = (x: number, z: number) => act(async () => emitter.emit('grid:move', gridEvent(x, z)))
const click = (x: number, z: number) =>
  act(async () => {
    emitter.emit('grid:move', gridEvent(x, z))
    emitter.emit('grid:click', gridEvent(x, z))
  })

// The footing tool was 3D-only: in 2D-only view its canvas never renders, so nothing drew. Drawn
// with an upper floor shown, the footing landed on the ground level, off the plan on screen.
test('in 2D-only view the plan draws footings, on the lowest level, which it shows', async () => {
  const { ground } = setScene()
  useEditor.setState({ viewLayouts: { edit: sceneLayout('2d') } })
  const renderer = await create(createElement(FootingFloorplanTool))
  try {
    expect(useViewer.getState().selection.levelId).toBe(ground.id)
    await click(0, 0)
    await move(3, 0)
    expect(usePlacementPreview.getState().node).toMatchObject({
      type: 'footing',
      start: [0, 0],
      end: [3, 0],
    })
    await click(3, 0)
    expect(footings()).toHaveLength(1)
    expect(footings()[0]).toMatchObject({ parentId: ground.id, start: [0, 0], end: [3, 0] })

    // Split view: the 3D tool owns the plan's clicks.
    await act(async () => useEditor.setState({ viewLayouts: { edit: sceneLayout('split') } }))
    await click(0, 2)
    await click(3, 2)
    expect(footings()).toHaveLength(1)
  } finally {
    await act(async () => renderer.unmount())
  }
})

test('the plan tool the footing registers draws a strip and a pad in 2D-only view', async () => {
  const { ground } = setScene()
  useEditor.setState({ viewLayouts: { edit: sceneLayout('2d') } })
  const extension = getFloorplanNodeExtension(footingDefinition)
  // A plan click on a footing inside a room picks the footing.
  expect(extension?.planHitSelectsNode).toBe(true)
  const { default: PlanTool } = await extension!.tool!()
  const renderer = await create(createElement(PlanTool as () => null))
  try {
    await click(1, 1)
    await click(4, 1)
    await act(async () => useEditor.getState().setToolDefaults('footing', { shape: 'pad' }))
    await click(6, 3)
    expect(footings().map(({ shape, parentId }) => ({ shape, parentId }))).toEqual([
      { shape: 'strip', parentId: ground.id },
      { shape: 'pad', parentId: ground.id },
    ])
    expect(footings()[1]).toMatchObject({ center: [6, 3] })
  } finally {
    await act(async () => renderer.unmount())
  }
})
