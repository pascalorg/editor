import { afterEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  type BeamNode,
  BuildingNode,
  clearSceneHistory,
  emitter,
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
import { beamDefinition } from './definition'
import { useBeamDraft } from './draft-settings'
import { beamDraftDimensions } from './tool'

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
  useBeamDraft.setState({ preset: '6x8', material: 'sawn', top: 'ceiling-dropped' })
})

function setScene() {
  const building = BuildingNode.parse({})
  const ground = LevelNode.parse({ parentId: building.id, level: 0, height: 2.7 })
  building.children = [ground.id]
  const nodes = Object.fromEntries([building, ground].map((node) => [node.id, node]))
  useScene.getState().setScene(nodes as Record<AnyNodeId, AnyNode>, [building.id as AnyNodeId], {
    installedPlugins: [],
    hasExplicitPluginInstallState: false,
  })
  clearSceneHistory()
  useViewer.getState().setSelection({ buildingId: building.id, levelId: ground.id })
  useEditor.setState({
    mode: 'build',
    tool: 'beam',
    workspaceMode: 'edit',
    viewLayouts: { edit: sceneLayout('2d') },
  })
  return { ground }
}

const beams = () =>
  Object.values(useScene.getState().nodes).filter((node): node is BeamNode => node.type === 'beam')

// Alt: the points are the pointer's, whatever the snapping mode.
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

test('in 2D-only view the plan draws a run of beams, each from where the last ended', async () => {
  const { ground } = setScene()
  useBeamDraft.setState({ preset: '(2)2x10', material: 'pressure-treated' })
  const extension = getFloorplanNodeExtension(beamDefinition)
  // A plan click on a beam over a room picks the beam.
  expect(extension?.planHitSelectsNode).toBe(true)
  const { default: PlanTool } = await extension!.tool!()
  const renderer = await create(createElement(PlanTool as () => null))
  try {
    await click(0, 0)
    await move(3, 0)
    expect(usePlacementPreview.getState().node).toMatchObject({
      type: 'beam',
      start: [0, 0],
      end: [3, 0],
    })
    // the plan shows the draft's length
    expect(usePlacementPreview.getState().dimensions[0]).toMatchObject({ value: 3 })
    await click(3, 0)
    await click(3, 2)
    expect(beams().map(({ start, end, parentId }) => ({ start, end, parentId }))).toEqual([
      { start: [0, 0], end: [3, 0], parentId: ground.id },
      { start: [3, 0], end: [3, 2], parentId: ground.id },
    ])
    expect(beams()[0]).toMatchObject({ size: '2x10', plies: 2, material: 'pressure-treated' })

    // Esc ends the run: the next click starts a new beam.
    await act(async () => emitter.emit('tool:cancel'))
    await click(5, 5)
    expect(beams()).toHaveLength(2)
    await click(6, 5)
    expect(beams()[2]).toMatchObject({ start: [5, 5], end: [6, 5] })
  } finally {
    await act(async () => renderer.unmount())
  }
  expect(usePlacementPreview.getState().node).toBeNull()
})

test('the draft length reads along the beam, off its side', () => {
  const [dimension] = beamDraftDimensions(
    beamDefinition.schema.parse({ start: [0, 0], end: [0, 4], width: 0.14 }),
  )
  expect(dimension).toMatchObject({ value: 4, renderIn3d: false })
  expect(dimension?.offsetNormal[0]).toBeCloseTo(-1)
})
