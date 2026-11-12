import { expect, test } from 'bun:test'
import { clearSceneHistory, emitter, type GridEvent, LevelNode, useScene } from '@pascal-app/core'
import { useEditor, usePlacementPreview } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { act } from '@react-three/test-renderer'
import { installMountedScene, mount } from '../__tests__/harness'
import ColumnTool from './tool'

installMountedScene()
test('repeated placement reuses a transient ghost but persists distinct columns and undo steps', async () => {
  const level = LevelNode.parse({})
  useScene.setState({ nodes: { [level.id]: level }, rootNodeIds: [level.id], readOnly: false })
  useViewer.getState().setSelection({ levelId: level.id })
  useEditor.getState().setSnappingMode('item', 'off')
  useEditor.getState().setContinuation('point', 'repeat')
  clearSceneHistory()
  const renderer = await mount(<ColumnTool />)
  const send = async (type: 'grid:move' | 'grid:click', x: number) => {
    await act(async () =>
      emitter.emit(type, {
        position: [x, 0, 0],
        localPosition: [x, 0, 0],
        nativeEvent: {},
        stopPropagation() {},
      } as GridEvent),
    )
  }
  const initial = useScene.getState().nodes
  await send('grid:move', 1)
  const id = usePlacementPreview.getState().node!.id
  await send('grid:move', 2)
  expect(usePlacementPreview.getState().node!.id).toBe(id)
  expect(useScene.getState().nodes).toBe(initial)
  await send('grid:click', 2)
  await send('grid:move', 4)
  await send('grid:click', 4)
  const columns = Object.values(useScene.getState().nodes).filter((node) => node.type === 'column')
  expect(columns).toHaveLength(2)
  expect(new Set(columns.map((node) => node.id)).size).toBe(2)
  expect(columns.every((node) => node.id !== id)).toBe(true)
  expect(useScene.temporal.getState().pastStates).toHaveLength(2)
  await renderer.unmount()
  expect(usePlacementPreview.getState().node).toBeNull()
})
