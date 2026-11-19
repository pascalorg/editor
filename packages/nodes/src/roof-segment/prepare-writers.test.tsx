import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import * as core from '@pascal-app/core'
import * as editor from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { renderPanelControls } from '../__tests__/panel-controls'
import { createRoofGlazingPreview } from '../roof/glazing-preview'
import RoofPanel from '../roof/panel'
import { roofSegmentDefinition } from './definition'
import RoofSegmentPanel from './panel'

const { BuildingNode, LevelNode, RoofNode, RoofSegmentNode, useScene, useLiveNodeOverrides } = core
let restore = () => {}
let restoreAdmission = () => {}
beforeEach(() => {
  const scene = useScene.getState(),
    viewer = useViewer.getState(),
    ui = editor.useEditor.getState()
  const history = useScene.temporal.getState(),
    overrides = useLiveNodeOverrides.getState()
  restore = () => {
    useScene.setState(scene, true)
    useViewer.setState(viewer, true)
    editor.useEditor.setState(ui, true)
    useScene.temporal.setState(history, true)
    useLiveNodeOverrides.setState(overrides, true)
  }
  useViewer.setState({ unit: 'metric' })
})
afterEach(() => {
  restoreAdmission()
  restore()
})
const snapshot = () =>
  structuredClone({
    nodes: useScene.getState().nodes,
    materials: useScene.getState().materials,
    collections: useScene.getState().collections,
    selection: useViewer.getState().selection,
  })

function seed(layers = false) {
  const building = BuildingNode.parse({})
  const ground = LevelNode.parse({ parentId: building.id, level: 0, height: 3 })
  const host = LevelNode.parse({ parentId: building.id, level: 1, metadata: { role: 'roof' } })
  const roof = RoofNode.parse({ parentId: host.id, support: { kind: 'level' } })
  const chosen = core.ROOF_BUILD_UP_PRESETS[2]!
  const plane = RoofSegmentNode.parse({
    parentId: roof.id,
    roofType: 'gable',
    width: 4,
    depth: 2,
    ...(layers ? core.roofBuildUpPatch(chosen.buildUp) : {}),
  })
  const companion = RoofSegmentNode.parse({
    parentId: roof.id,
    roofType: 'gable',
    position: [6, 0, 0],
  })
  const vents = core.createDefaultRidgeVentsForSegment(plane)
  plane.children = vents.map((vent) => vent.id)
  roof.children = [plane.id, companion.id]
  host.children = [roof.id]
  building.children = [ground.id, host.id]
  useScene.setState({
    nodes: Object.fromEntries(
      [building, ground, host, roof, plane, companion, ...vents].map((node) => [node.id, node]),
    ),
    rootNodeIds: [building.id],
    materials: {},
    collections: {},
    dirtyNodes: new Set(),
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  core.clearSceneHistory()
  useViewer
    .getState()
    .setSelection({ buildingId: building.id, levelId: host.id, selectedIds: [plane.id] })
  // OLD-policy consumer test, not a simulated geometric policy oracle: only the existing
  // public admission outcome is controlled. Every UI callback and accepted writer stays native.
  const realSeat = core.seatRoofs
  const gate = { refuse: true, observations: [] as ReturnType<typeof snapshot>[] }
  const spy = spyOn(core, 'seatRoofs').mockImplementation((nodes, changes) => {
    gate.observations.push(snapshot())
    return gate.refuse
      ? { kind: 'refuse', code: 'storey_above', storeyAboveId: 'level_controlled' }
      : realSeat(nodes, changes)
  })
  restoreAdmission = () => spy.mockRestore()
  return { roof, plane, companion, vents, chosen, gate }
}
function rejected(before: ReturnType<typeof snapshot>, f: ReturnType<typeof seed>) {
  expect(f.gate.observations.length).toBeGreaterThan(0)
  for (const observation of f.gate.observations) expect(observation).toEqual(before)
  expect(snapshot()).toEqual(before)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  expect(useScene.temporal.getState().futureStates).toHaveLength(0)
  f.gate.refuse = false
}
function undoTo(before: ReturnType<typeof snapshot>) {
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(snapshot()).toEqual(before)
}
function conical() {
  const choices = renderPanelControls(<RoofSegmentPanel />).filter(
    (entry) =>
      entry.kind === 'SegmentedControl' &&
      entry.props.options.some((option: { value: string }) => option.value === 'conical'),
  )
  expect(choices).toHaveLength(1)
  choices[0]!.props.onChange('conical')
}
function applyAll() {
  const actions: Array<{ label?: string; onClick?: () => void }> = []
  const spy = spyOn(editor, 'ActionButton').mockImplementation(((
    props: (typeof actions)[number],
  ) => {
    actions.push(props)
    return null
  }) as never)
  try {
    renderPanelControls(<RoofSegmentPanel />)
  } finally {
    spy.mockRestore()
  }
  const matches = actions.filter((action) => action.label === 'Apply to all planes of this roof')
  expect(matches).toHaveLength(1)
  matches[0]!.onClick!()
}

test('actual conical panel callback admits shape and vent deletion together, or neither', () => {
  const f = seed()
  expect(f.vents.length).toBeGreaterThan(0)
  const before = snapshot()
  conical()
  rejected(before, f)
  conical()
  expect(useScene.getState().nodes[f.plane.id]).toMatchObject({
    roofType: 'conical',
    depth: 4,
    conicalFullCircle: true,
  })
  for (const vent of f.vents) expect(useScene.getState().nodes[vent.id]).toBeUndefined()
  undoTo(before)
})
test('actual apply-all panel callback does not partially publish a refused roof batch', () => {
  const f = seed(true)
  expect(f.companion.buildUp).toBeUndefined()
  const before = snapshot()
  applyAll()
  rejected(before, f)
  applyAll()
  for (const plane of [f.plane, f.companion])
    expect(useScene.getState().nodes[plane.id]).toMatchObject(
      core.roofBuildUpPatch(f.chosen.buildUp),
    )
  undoTo(before)
})
test('actual multi-selection preset prepares its whole batch before history or publication', () => {
  const f = seed()
  const controls = editor.getNodePanelModel(roofSegmentDefinition)!.multiControls!({
    selection: [f.plane, f.companion],
    nodes: useScene.getState().nodes,
  })
  const preset = controls.find((control) => 'options' in control && control.section === 'Layers')!
  expect(preset).toBeDefined()
  if (!('options' in preset)) throw new Error('Native layers choice missing')
  const before = snapshot()
  preset.onChange(f.chosen.id)
  rejected(before, f)
  preset.onChange(f.chosen.id)
  for (const plane of [f.plane, f.companion])
    expect(useScene.getState().nodes[plane.id]).toMatchObject(
      core.roofBuildUpPatch(f.chosen.buildUp),
    )
  undoTo(before)
})
test('actual whole-roof inspector field admits all planes before changing any', () => {
  const f = seed()
  useViewer.getState().setSelection({ selectedIds: [f.roof.id] })
  const change = () => {
    const fields = renderPanelControls(<RoofPanel />).filter(
      (entry) => entry.kind === 'SliderControl' && entry.props.label === 'Gable overhang',
    )
    expect(fields).toHaveLength(1)
    fields[0]!.props.onChange(0.4)
  }
  const before = snapshot()
  change()
  rejected(before, f)
  change()
  for (const plane of [f.plane, f.companion])
    expect(useScene.getState().nodes[plane.id]).toMatchObject({ gableOverhang: 0.4 })
  undoTo(before)
})
test('actual glazing finish clears refused preview without writing and remains usable', () => {
  const f = seed()
  const preview = createRoofGlazingPreview([f.plane.id, f.companion.id])
  const before = snapshot()
  try {
    preview.previewFields({ width: 5 })
    for (const plane of [f.plane, f.companion])
      expect(useLiveNodeOverrides.getState().get(plane.id)).toMatchObject({ width: 5 })
    expect(snapshot()).toEqual(before)
    expect(preview.finish()).toMatchObject({ kind: 'refuse' })
    rejected(before, f)
    for (const plane of [f.plane, f.companion])
      expect(useLiveNodeOverrides.getState().get(plane.id)).toBeUndefined()
    preview.previewFields({ width: 5 })
    expect(preview.finish()).toBeNull()
    for (const plane of [f.plane, f.companion])
      expect(useScene.getState().nodes[plane.id]).toMatchObject({ width: 5 })
    undoTo(before)
  } finally {
    preview.cancel()
  }
})
