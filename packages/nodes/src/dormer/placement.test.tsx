import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  clearSceneHistory,
  createDormerDefaultWindow,
  DormerNode,
  emitter,
  getSceneHistoryPauseDepth,
  LevelNode,
  type RoofEvent,
  RoofNode,
  RoofSegmentNode,
  type SceneCommit,
  sceneRegistry,
  subscribeSceneCommits,
  useScene,
} from '@pascal-app/core'
import * as editor from '@pascal-app/editor'
import {
  cancelActiveTool,
  duplicateNodeAndPickUp,
  useEditor,
  useMovingNode,
  useOpeningGuides,
  usePlacementPreview,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { act } from '@react-three/test-renderer'
import type { ComponentType } from 'react'
import { Group, Vector3 } from 'three'
import { installMountedScene, mount } from '../__tests__/harness'
import { builtinPlugin } from '../index'
import MoveDormerTool from './move-tool'

installMountedScene()
beforeEach(() => {
  useOpeningGuides.getState().clear()
  usePlacementPreview.getState().clear()
  useEditor.setState({ mode: 'select', tool: null })
  useEditor.getState().setSnappingMode('item', 'off')
})
afterEach(() => {
  useOpeningGuides.getState().clear()
  usePlacementPreview.getState().clear()
})

function fixture(existing = false) {
  const building = BuildingNode.parse({
    id: 'building_b',
    position: [20, 5, -10],
    rotation: [0, 0.3, 0],
    children: ['level_l'],
  })
  const level = LevelNode.parse({
    id: 'level_l',
    parentId: building.id,
    baseElevation: 6,
    children: ['roof_r'],
  })
  const roof = RoofNode.parse({
    id: 'roof_r',
    parentId: level.id,
    position: [2, 1, 3],
    rotation: -0.2,
    children: ['rseg_s'],
  })
  const segment = RoofSegmentNode.parse({
    id: 'rseg_s',
    parentId: roof.id,
    position: [1, 2, -1],
    rotation: 0.4,
    roofType: 'gable',
    width: 12,
    depth: 8,
    pitch: 45,
    wallHeight: 2,
    wallThickness: 0,
    deckThickness: 0.1,
    shingleThickness: 0.05,
    overhang: 0,
    gableOverhang: 0,
    children: existing ? ['dormer_old'] : [],
  })
  const dormer = DormerNode.parse({
    id: 'dormer_old',
    parentId: segment.id,
    roofSegmentId: segment.id,
    position: [0, 4.123, 2],
    rotation: 0.37,
    width: 1.4,
    depth: 1.8,
    height: 0.6,
    roofType: 'shed',
    shedHighSide: 'front',
    roofHeight: 0.7,
    metadata: { marker: 'preserve' },
    children: ['window_old'],
  })
  const window = {
    ...createDormerDefaultWindow(dormer, 'window_old', 'front'),
    position: [0.13, -0.2, 0.01] as [number, number, number],
    width: 0.54,
    height: 0.45,
    columnRatios: [1, 2],
    rowRatios: [1, 1, 1, 1],
  }
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [building, level, roof, segment, ...(existing ? [dormer, window] : [])].map((node) => [
      node.id,
      node,
    ]),
  )
  useScene.setState({ nodes, rootNodeIds: [building.id], readOnly: false, dirtyNodes: new Set() })
  const buildingObject = new Group(),
    levelObject = new Group(),
    roofObject = new Group(),
    segmentObject = new Group()
  buildingObject.position.fromArray(building.position)
  buildingObject.rotation.set(...building.rotation)
  levelObject.position.y = 6
  roofObject.position.fromArray(roof.position)
  roofObject.rotation.y = roof.rotation
  segmentObject.position.fromArray(segment.position)
  segmentObject.rotation.y = segment.rotation
  buildingObject.add(levelObject)
  levelObject.add(roofObject)
  roofObject.add(segmentObject)
  buildingObject.updateMatrixWorld(true)
  for (const [id, object] of [
    [building.id, buildingObject],
    [level.id, levelObject],
    [roof.id, roofObject],
    [segment.id, segmentObject],
  ] as const)
    sceneRegistry.nodes.set(id, object)
  if (existing) {
    const object = new Group()
    object.position.fromArray(dormer.position)
    object.rotation.y = dormer.rotation
    segmentObject.add(object)
    buildingObject.updateMatrixWorld(true)
    sceneRegistry.nodes.set(dormer.id, object)
  }
  useViewer.getState().setSelection({
    buildingId: building.id,
    levelId: level.id,
    selectedIds: existing ? [dormer.id] : [],
  })
  clearSceneHistory()
  return { building, level, roof, segment, segmentObject, dormer, window }
}
async function send(
  f: ReturnType<typeof fixture>,
  type: 'roof:move' | 'roof:click',
  x: number,
  z = 2,
) {
  // Independent native45° finished covering, transformed through real Three groups.
  const point = f.segmentObject.localToWorld(new Vector3(x, 6 - Math.abs(z) + 0.15 * Math.SQRT2, z))
  await act(async () =>
    emitter.emit(type, {
      node: f.roof,
      position: point.toArray(),
      nativeEvent: {},
      stopPropagation() {},
    } as RoofEvent),
  )
}
async function freshTool() {
  const def = builtinPlugin.nodes!.find((entry) => entry.kind === 'dormer')!
  const Tool = (await def.tool!()).default as ComponentType
  return mount(<Tool />)
}
function RunningMove() {
  const node = useMovingNode()
  return node?.type === 'dormer' ? <MoveDormerTool node={node} /> : null
}
const dormers = () =>
  Object.values(useScene.getState().nodes).filter(
    (node): node is DormerNode => node.type === 'dormer',
  )

function assertPairAtCommit(commit: SceneCommit, sourceId?: string) {
  const created = Object.values(commit.current.nodes).filter(
    (node): node is DormerNode => node.type === 'dormer' && node.id !== sourceId,
  )
  expect(created).toHaveLength(1)
  const dormer = created[0]!
  expect(dormer.children).toHaveLength(1)
  const window = commit.current.nodes[dormer.children[0]!]
  expect(window).toMatchObject({ type: 'window', parentId: dormer.id, dormerId: dormer.id })
  expect(
    (commit.current.nodes[dormer.parentId!] as RoofSegmentNode).children.filter(
      (id) => id === dormer.id,
    ),
  ).toHaveLength(1)
  return { dormer, window }
}

test('mounted fresh tool keeps preview transient, preserves R yaw, and commits one complete pair/undo', async () => {
  const f = fixture()
  const before = structuredClone(useScene.getState().nodes)
  const commits: SceneCommit[] = []
  const unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))
  try {
    const renderer = await freshTool()
    await send(f, 'roof:move', 0)
    await act(async () => {
      window.dispatchEvent(
        Object.assign(new Event('keydown', { cancelable: true }), { key: 'r', shiftKey: false }),
      )
    })
    await send(f, 'roof:move', 0)
    expect(useScene.getState().nodes).toEqual(before)
    const preview = usePlacementPreview.getState().node
    if (preview?.type !== 'dormer') throw new Error('Expected native dormer preview')
    preview.position.forEach((value, i) => {
      expect(value).toBeCloseTo([0, 4, 2][i]!, 8)
    })
    expect(preview.rotation).toBeCloseTo(Math.PI / 12, 10)
    expect(preview).toMatchObject({ width: 1.21, depth: 1.55 })
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    await send(f, 'roof:click', 0)
    expect(commits).toHaveLength(1)
    const { dormer } = assertPairAtCommit(commits[0]!)
    dormer.position.forEach((value, i) => {
      expect(value).toBeCloseTo([0, 4, 2][i]!, 8)
    })
    expect(dormer.rotation).toBeCloseTo(Math.PI / 12, 10)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    const after = structuredClone(useScene.getState().nodes)
    await renderer.unmount()
    expect(usePlacementPreview.getState().node).toBeNull()
    expect(useOpeningGuides.getState().guides).toEqual([])
    await send(f, 'roof:click', 3)
    expect(useScene.getState().nodes).toEqual(after)
    unsubscribe()
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(before)
    useScene.temporal.getState().redo()
    expect(useScene.getState().nodes).toEqual(after)
    expect(getSceneHistoryPauseDepth()).toBe(0)
  } finally {
    unsubscribe()
  }
})

test('fresh cancellation and invalid whole-footprint/ridge click add no nodes or history', async () => {
  const f = fixture()
  const before = structuredClone(useScene.getState().nodes)
  const renderer = await freshTool()
  await send(f, 'roof:move', 0)
  await renderer.unmount()
  expect(usePlacementPreview.getState().node).toBeNull()
  expect(useScene.getState().nodes).toEqual(before)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  const again = await freshTool()
  const sound = spyOn(editor, 'triggerSFX')
  try {
    await send(f, 'roof:move', 0, 0.2)
    await send(f, 'roof:click', 0, 0.2)
    expect(useScene.getState().nodes).toEqual(before)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    expect(useViewer.getState().selection.selectedIds).toEqual([])
    expect(sound.mock.calls.some(([name]) => name === 'sfx:item-place')).toBe(false)
    // Rejection must not latch this mounted tool as committed.
    await send(f, 'roof:move', 0, 2)
    await send(f, 'roof:click', 0, 2)
    expect(dormers()).toHaveLength(1)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  } finally {
    sound.mockRestore()
    await again.unmount()
  }
})

for (const cancel of [false, true]) {
  test(`mounted existing move ${cancel ? 'cancels cleanly' : 'keeps arbitrary yaw and edited children in one undo'}`, async () => {
    const f = fixture(true)
    const before = structuredClone(useScene.getState().nodes)
    useEditor.getState().setMovingNode(f.dormer)
    const renderer = await mount(<RunningMove />)
    // A clear roof point beside the source anchors relative dragging. Do not
    // fabricate a roof intersection inside the source dormer's existing cut.
    await send(f, 'roof:move', 1.5)
    await send(f, 'roof:move', 3.5)
    expect(usePlacementPreview.getState().node).toMatchObject({
      type: 'dormer',
      width: 1.4,
      depth: 1.8,
      height: 0.6,
      roofType: 'shed',
      shedHighSide: 'front',
      rotation: 0.37,
    })
    expect((useScene.getState().nodes[f.dormer.id] as DormerNode).position).toEqual(
      f.dormer.position,
    )
    if (cancel) {
      await act(async () => void cancelActiveTool())
      await renderer.unmount()
      expect(useScene.getState().nodes).toEqual(before)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    } else {
      await send(f, 'roof:click', 3.5)
      const moved = useScene.getState().nodes[f.dormer.id] as DormerNode
      expect(moved.rotation).toBe(0.37)
      expect(moved.position[0]).toBeCloseTo(2, 8)
      expect(moved.position[1]).toBeCloseTo(4.123, 8)
      expect(moved.position[2]).toBeCloseTo(2, 8)
      expect(moved).toMatchObject({
        width: 1.4,
        depth: 1.8,
        height: 0.6,
        roofType: 'shed',
        shedHighSide: 'front',
        metadata: { marker: 'preserve' },
      })
      expect(useScene.getState().nodes[f.window.id]).toEqual(f.window)
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      await renderer.unmount()
      useScene.temporal.getState().undo()
      expect(useScene.getState().nodes).toEqual(before)
    }
    expect(usePlacementPreview.getState().node).toBeNull()
    expect(getSceneHistoryPauseDepth()).toBe(0)
  })
}

for (const cancel of [false, true]) {
  test(`native duplicate pickup ${cancel ? 'cancels without history/leaked children' : 'retains source overlap and remaps children before the sole commit'}`, async () => {
    const f = fixture(true)
    const before = structuredClone(useScene.getState().nodes)
    await act(async () => duplicateNodeAndPickUp(f.dormer))
    const renderer = await mount(<RunningMove />)
    const commits: SceneCommit[] = []
    const unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))
    try {
      // The first clear hover anchors the duplicate at the source, so its
      // candidate overlaps even though the actual pointer hits exposed roof.
      await send(f, 'roof:move', 1.5)
      await send(f, 'roof:click', 1.5)
      expect(commits).toHaveLength(0)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      expect(useScene.getState().nodes[f.dormer.id]).toEqual(f.dormer)
      if (cancel) {
        await act(async () => void cancelActiveTool())
        await renderer.unmount()
        expect(useScene.getState().nodes).toEqual(before)
        expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      } else {
        await send(f, 'roof:move', 4.5)
        await send(f, 'roof:click', 4.5)
        expect(commits).toHaveLength(1)
        const pair = assertPairAtCommit(commits[0]!, f.dormer.id)
        expect(pair.dormer.id).not.toBe(f.dormer.id)
        expect(pair.window.id).not.toBe(f.window.id)
        expect(pair.window).toMatchObject({
          position: [0.13, -0.2, 0.01],
          width: 0.54,
          height: 0.45,
          columnRatios: [1, 2],
          rowRatios: [1, 1, 1, 1],
        })
        expect(pair.dormer.rotation).toBe(0.37)
        expect(pair.dormer.position[0]).toBeCloseTo(3, 8)
        expect(pair.dormer.position[1]).toBeCloseTo(4.123, 8)
        expect(dormers()).toHaveLength(2)
        expect(useScene.getState().nodes[f.dormer.id]).toEqual(f.dormer)
        expect(useScene.getState().nodes[f.window.id]).toEqual(f.window)
        expect(useScene.temporal.getState().pastStates).toHaveLength(1)
        await renderer.unmount()
        unsubscribe()
        useScene.temporal.getState().undo()
        expect(useScene.getState().nodes).toEqual(before)
      }
      expect(getSceneHistoryPauseDepth()).toBe(0)
    } finally {
      unsubscribe()
    }
  })
}
