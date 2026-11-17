import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  clearSceneHistory,
  createDormerDefaultWindow,
  DormerNode,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import * as editor from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderPanelControls } from '../__tests__/panel-controls'
import DormerPanel from './panel'
import { dormerParametrics } from './parametrics'

let restoreScene: ReturnType<typeof useScene.getState>
let restoreViewer: ReturnType<typeof useViewer.getState>
let restoreOverrides: ReturnType<typeof useLiveNodeOverrides.getState>
beforeEach(() => {
  restoreScene = useScene.getState()
  restoreViewer = useViewer.getState()
  restoreOverrides = useLiveNodeOverrides.getState()
  useViewer.setState({ unit: 'metric' })
})
afterEach(() => {
  useScene.setState(restoreScene, true)
  useViewer.setState(restoreViewer, true)
  useLiveNodeOverrides.setState(restoreOverrides, true)
  clearSceneHistory()
})
function seed() {
  const building = BuildingNode.parse({ id: 'building_b', children: ['level_l'] })
  const level = LevelNode.parse({ id: 'level_l', parentId: building.id, children: ['roof_r'] })
  const roof = RoofNode.parse({ id: 'roof_r', parentId: level.id, children: ['rseg_s'] })
  const segment = RoofSegmentNode.parse({
    id: 'rseg_s',
    parentId: roof.id,
    roofType: 'gable',
    width: 12,
    depth: 8,
    pitch: 45,
    wallHeight: 2,
    children: ['dormer_d'],
  })
  const dormer = DormerNode.parse({
    id: 'dormer_d',
    parentId: segment.id,
    roofSegmentId: segment.id,
    roofType: 'conical',
    position: [0, 4.123, 2],
    rotation: 0.37,
    width: 1.4,
    depth: 1.8,
    height: 0.6,
    children: ['window_w'],
  })
  const window = {
    ...createDormerDefaultWindow(dormer, 'window_w'),
    position: [0.1, -2, 0] as [number, number, number],
  }
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [building, level, roof, segment, dormer, window].map((node) => [node.id, node]),
  )
  useScene.setState({ nodes, rootNodeIds: [building.id], dirtyNodes: new Set(), readOnly: false })
  useViewer
    .getState()
    .setSelection({ buildingId: building.id, levelId: level.id, selectedIds: [dormer.id] })
  clearSceneHistory()
  return { dormer, window, before: structuredClone(nodes) }
}
function slider(label: string) {
  const controls = renderPanelControls(<DormerPanel />).filter(
    (entry) => entry.kind === 'SliderControl' && String(entry.props.label).toLowerCase() === label,
  )
  expect(controls).toHaveLength(1)
  return controls[0]!.props
}
function markup() {
  // Same current-store SSR convention as existing panel-controls; this is NOT
  // claimed as mounted browser/button interaction. VisualAcceptance owns that.
  // Hold only public panel chrome open; real dormer labels/buttons still render.
  const wrapper = spyOn(editor, 'PanelWrapper').mockImplementation((({
    children,
  }: {
    children: React.ReactNode
  }) => <>{children}</>) as never)
  const original = React.useSyncExternalStore
  const spy = spyOn(React, 'useSyncExternalStore').mockImplementation((subscribe, snapshot) =>
    original(subscribe, snapshot, snapshot),
  )
  try {
    return renderToStaticMarkup(<DormerPanel />)
  } finally {
    spy.mockRestore()
    wrapper.mockRestore()
  }
}

test('custom inspector body SSR and generic native metadata expose conical without losing existing profiles', () => {
  seed()
  const field = dormerParametrics.groups
    ?.flatMap((group) => group.fields)
    .find((entry) => entry.key === 'roofType')
  expect(field?.kind).toBe('enum')
  if (field?.kind !== 'enum') throw new Error('Missing native own-roof selector')
  expect(field.options).toEqual(
    expect.arrayContaining([
      'hip',
      'gable',
      'shed',
      'gambrel',
      'dutch',
      'mansard',
      'flat',
      'conical',
    ]),
  )
  expect(markup()).toMatch(/>Conical</i)
  expect(slider('width').value).toBe(1.4)
  expect(slider('depth').value).toBe(1.8)
  expect(slider('roof height').value).toBe(0.49)
})

test('native conical inspector dimension preview/commit keeps arbitrary yaw/Y and edited child in one undo', () => {
  // Stored unequal dimensions are retained; this does not assert independent
  // cone axes. Native conical body remains circular, driven by depth.
  const f = seed()
  const width = slider('width')
  width.onChange(1.6)
  expect(useScene.getState().nodes).toEqual(f.before)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  width.onCommit(1.6)
  expect(useScene.getState().nodes[f.dormer.id]).toMatchObject({
    width: 1.6,
    depth: 1.8,
    roofType: 'conical',
    position: [0, 4.123, 2],
    rotation: 0.37,
  })
  expect(useScene.getState().nodes[f.window.id]).toEqual(f.window)
  expect(useLiveNodeOverrides.getState().get(f.dormer.id)).toBeUndefined()
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(f.before)
})

test('native inspector refuses a footprint crossing ridge/eave without an undo entry or hidden geometry rewrite', () => {
  const f = seed()
  const depth = slider('depth')
  depth.onChange(5)
  expect(useScene.getState().nodes).toEqual(f.before)
  depth.onCommit(5)
  expect(useScene.getState().nodes).toEqual(f.before)
  expect(useLiveNodeOverrides.getState().get(f.dormer.id)).toBeUndefined()
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})
