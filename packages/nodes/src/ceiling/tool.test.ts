import { afterEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  clearSceneHistory,
  emitter,
  type GridEvent,
  LevelNode,
  useScene,
} from '@pascal-app/core'
import { sceneLayout, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { createElement } from 'react'
import { CeilingTool } from './tool'

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
})

const ceilings = () => Object.values(useScene.getState().nodes).filter((n) => n.type === 'ceiling')

const click = (x: number, z: number) =>
  act(async () => {
    const event = {
      position: [x, 0, z],
      localPosition: [x, 0, z],
      nativeEvent: {} as GridEvent['nativeEvent'],
    } satisfies GridEvent
    emitter.emit('grid:move', event)
    emitter.emit('grid:click', event)
  })

async function drawSquare() {
  for (const [x, z] of [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
    [0, 0],
  ] as const)
    await click(x, z)
}

function seedLevel() {
  const building = BuildingNode.parse({})
  const level = LevelNode.parse({ parentId: building.id, level: 0, height: 3 })
  building.children = [level.id]
  useScene
    .getState()
    .setScene(
      { [building.id]: building, [level.id]: level } as Record<AnyNodeId, AnyNode>,
      [building.id as AnyNodeId],
      { installedPlugins: [], hasExplicitPluginInstallState: false },
    )
  clearSceneHistory()
  useViewer.getState().setSelection({ buildingId: building.id, levelId: level.id })
}

const showScene = (scene: '2d' | '3d' | 'split') =>
  act(async () => useEditor.setState({ viewLayouts: { edit: sceneLayout(scene) } }))

// The 3D tool stays mounted behind the hidden canvas once 3D has been shown, and hears the plan's
// clicks; in 2D-only view the plan commits the ceiling too, so each one was made twice.
test('the 3D ceiling tool leaves a 2D-only plan its clicks, and commits beside a plan', async () => {
  seedLevel()
  useEditor.setState({
    mode: 'build',
    tool: null,
    workspaceMode: 'edit',
    viewLayouts: { edit: sceneLayout('2d') },
  })
  const renderer = await create(createElement(CeilingTool))
  try {
    await drawSquare()
    expect(ceilings()).toHaveLength(0)

    await showScene('split')
    await drawSquare()
    expect(ceilings()).toHaveLength(1)
  } finally {
    await act(async () => renderer.unmount())
  }
})

// The plan finishes a ceiling begun beside it once the view goes 2D-only; corners the 3D tool kept
// would start the next ceiling drawn back in split view, which then never closed.
test('a ceiling begun in split view and finished on the 2D-only plan leaves no corners behind', async () => {
  seedLevel()
  useEditor.setState({
    mode: 'build',
    tool: null,
    workspaceMode: 'edit',
    viewLayouts: { edit: sceneLayout('split') },
  })
  const renderer = await create(createElement(CeilingTool))
  try {
    await click(10, 10)
    await click(14, 10)
    await showScene('2d')
    for (const [x, z] of [
      [14, 14],
      [10, 14],
      [10, 10],
    ] as const)
      await click(x, z)
    await showScene('split')
    await drawSquare()
    expect(ceilings().map((ceiling) => ceiling.polygon)).toEqual([
      [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
    ])
  } finally {
    await act(async () => renderer.unmount())
  }
})

// The plan starts its own copy of the draft empty whenever it appears, so corners this tool kept
// from 3D-only view closed a different polygon than the one the plan beside it showed.
test('a ceiling drawn beside the plan starts from the corners the plan shows', async () => {
  seedLevel()
  useEditor.setState({
    mode: 'build',
    tool: null,
    workspaceMode: 'edit',
    viewLayouts: { edit: sceneLayout('3d') },
  })
  const renderer = await create(createElement(CeilingTool))
  try {
    await click(10, 10)
    await click(14, 10)
    await showScene('split')
    await drawSquare()
    expect(ceilings().map((ceiling) => ceiling.polygon)).toEqual([
      [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
    ])
  } finally {
    await act(async () => renderer.unmount())
  }
})
