import { afterEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  LUMBER_DEPTH,
  ROOF_BUILD_UP_PRESETS,
  RoofSegmentNode,
  roofBuildUpDepths,
  roofBuildUpPatch,
  useScene,
} from '@pascal-app/core'
import { getNodePanelModel, type MultiPanelControl } from '@pascal-app/editor'
import { roofSegmentDefinition } from './definition'
import { keptName, namedLayer, roofBuildUpOfDeck, roofBuildUpPresetValue } from './panel-model'

globalThis.requestAnimationFrame ??= () => 0
globalThis.cancelAnimationFrame ??= () => {}

const originalState = useScene.getState()
afterEach(() => useScene.setState(originalState))

type Choice = Extract<MultiPanelControl, { options: unknown }>

const load = (nodes: AnyNode[]) => {
  useScene.setState({
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<AnyNodeId, AnyNode>,
    rootNodeIds: [],
  })
  useScene.temporal.getState().clear()
  useScene.temporal.getState().resume()
}
const current = <T extends AnyNode>(nodes: T[]) =>
  nodes.map((n) => useScene.getState().nodes[n.id as AnyNodeId] as T)

test('multi-selected roof planes take one layers preset, their deck and covering with it, in one step', () => {
  const planes = [RoofSegmentNode.parse({}), RoofSegmentNode.parse({ deckThickness: 0.2 })]
  load(planes)
  const [preset] = getNodePanelModel(roofSegmentDefinition)!.multiControls!({
    selection: planes,
    nodes: useScene.getState().nodes,
  }) as Choice[]
  expect(preset).toMatchObject({ section: 'Layers', value: 'none' })
  const chosen = ROOF_BUILD_UP_PRESETS[2]!
  preset!.onChange(chosen.id)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  const { deck, covering } = roofBuildUpDepths(chosen.buildUp)
  for (const plane of current(planes)) {
    expect(plane.buildUp).toEqual(chosen.buildUp)
    expect([plane.deckThickness, plane.shingleThickness]).toEqual([deck, covering])
  }
  preset!.onChange('none')
  for (const plane of current(planes)) expect(plane.buildUp).toBeUndefined()
})

test("a layer's own name rides the plane: through the schema, a save and the preset it came from; emptied it goes", () => {
  const preset = ROOF_BUILD_UP_PRESETS[0]!.buildUp
  const named = { ...preset, roofing: namedLayer(preset.roofing, '  GAF Timberline HDZ ') }
  const plane = RoofSegmentNode.parse(roofBuildUpPatch(named))
  expect(plane.buildUp?.roofing).toEqual({ ...preset.roofing, name: 'GAF Timberline HDZ' })
  // a name is no change of material: still the preset
  expect(roofBuildUpPresetValue(plane.buildUp)).toBe(preset.presetId!)
  expect([plane.deckThickness, plane.shingleThickness]).toEqual([
    roofBuildUpDepths(preset).deck,
    roofBuildUpDepths(preset).covering,
  ])
  expect(RoofSegmentNode.parse(JSON.parse(JSON.stringify(plane))).buildUp).toEqual(plane.buildUp)
  // emptied, the kind's own name stands for it again
  expect(namedLayer(plane.buildUp!.roofing, '  ')).toEqual(preset.roofing)
  expect(namedLayer(preset.roofing, 'x'.repeat(80)).name).toHaveLength(60)
  expect(() =>
    RoofSegmentNode.parse(
      roofBuildUpPatch({ ...preset, roofing: { ...preset.roofing, name: 'x'.repeat(61) } }),
    ),
  ).toThrow()
  // a new thickness of the same panel keeps its name; another material does not
  const sheathing = namedLayer(preset.sheathing, 'AdvanTech')
  expect(keptName(sheathing, { kind: 'osb' as const, thickness: 0.0127 })).toEqual({
    kind: 'osb',
    thickness: 0.0127,
    name: 'AdvanTech',
  })
  expect(keptName(sheathing, { kind: 'plywood' as const, thickness: 0.0127 })).toEqual({
    kind: 'plywood',
    thickness: 0.0127,
  })
})

test('a plane without layers reads as the layers its deck holds, which Edit layers writes with its deck', () => {
  const preset = ROOF_BUILD_UP_PRESETS[0]!.buildUp
  // the default trusses on their heel, and the schema's 0.100 m deck: one chord before the heel
  // counted, which Edit layers deepens to the heel
  expect(roofBuildUpOfDeck(roofBuildUpDepths(preset).deck)).toBe(preset)
  expect(roofBuildUpOfDeck(RoofSegmentNode.parse({}).deckThickness)).toBe(preset)
  expect(roofBuildUpDepths(preset).deck).toBeCloseTo(
    2 * LUMBER_DEPTH['2x4'] + preset.sheathing.thickness,
    9,
  )
  // a generated roof's 2x6 rafters and their sheathing
  const generated = LUMBER_DEPTH['2x6'] + preset.sheathing.thickness
  const layers = roofBuildUpOfDeck(generated)
  expect(layers.structure).toEqual({
    system: 'rafters',
    size: '2x6',
    spacing: preset.structure.spacing,
  })
  expect(layers.presetId).toBeUndefined()
  expect(roofBuildUpDepths(layers).deck).toBeCloseTo(generated, 9)
  // a deck no framing makes reads as the default preset
  expect(roofBuildUpOfDeck(0.25)).toBe(preset)
})
