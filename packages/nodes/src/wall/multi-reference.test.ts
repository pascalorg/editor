import { afterEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  GYPSUM_HALF,
  getWallAssemblyPreset,
  SiteNode,
  STUCCO_3_COAT,
  STUD_2X8,
  useScene,
  WallNode,
  wallAssemblyPatch,
  wallTypeAssembly,
} from '@pascal-app/core'
import { getNodePanelModel, type MultiPanelControl } from '@pascal-app/editor'
import { wallDefinition } from './definition'

globalThis.requestAnimationFrame ??= () => 0
globalThis.cancelAnimationFrame ??= () => {}

const originalState = useScene.getState()
afterEach(() => useScene.setState(originalState))

const room = () => {
  const points: [number, number][] = [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ]
  return points.map((start, i) =>
    WallNode.parse({ start, end: points[(i + 1) % 4], thickness: 0.2 }),
  )
}

type Choice = Extract<MultiPanelControl, { options: unknown }>
const controls = (selection: WallNode[]) =>
  getNodePanelModel(wallDefinition)!.multiControls!({
    selection,
    nodes: useScene.getState().nodes,
  })
const choices = (selection: WallNode[]) =>
  controls(selection).filter((control): control is Choice => control.kind !== 'readout')
const control = (selection: WallNode[], id: string) =>
  controls(selection).find((entry) => entry.id === id)

const load = (walls: WallNode[]) => {
  const nodes = Object.fromEntries(walls.map((w) => [w.id, w])) as Record<AnyNodeId, AnyNode>
  useScene.setState({ nodes, rootNodeIds: [] })
  useScene.temporal.getState().clear()
  useScene.temporal.getState().resume()
}
const current = (walls: WallNode[]) =>
  walls.map((w) => useScene.getState().nodes[w.id as AnyNodeId] as WallNode)

test('multi-select Preset and Exterior apply to every wall in one step, mixed reads as mixed', () => {
  const walls = room()
  load(walls)
  const preset = control(walls, 'wall-assembly-preset') as Choice
  expect(preset).toMatchObject({ kind: 'select', section: 'Assembly', value: 'none' })
  preset.onChange('exterior-2x6-siding')
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  const sided = current(walls)
  const total = wallAssemblyPatch(getWallAssemblyPreset('exterior-2x6-siding')!.assembly).thickness
  for (const wall of sided) {
    expect(wall.assembly?.presetId).toBe('exterior-2x6-siding')
    expect(wall.thickness).toBeCloseTo(total, 9)
  }
  // The assembly owns the thickness: a readout, not a field to type over.
  expect(control(sided, 'wall-thickness-assembly')).toMatchObject({
    kind: 'readout',
    detail: 'from assembly',
  })
  const exterior = control(sided, 'wall-assembly-exterior') as Choice
  expect(exterior.value).toBe('siding')
  exterior.onChange('stucco')
  expect(useScene.temporal.getState().pastStates).toHaveLength(2)
  const stucco = current(walls)
  expect((control(stucco, 'wall-assembly-exterior') as Choice).value).toBe('stucco')
  for (const wall of stucco)
    expect(wall.assembly?.layers.find((layer) => layer.role === 'finish')?.material).toBe('stucco')
  expect(stucco[0]!.assembly?.presetId).toBeUndefined()
  // One wall back to a plain single layer: the selection's preset is mixed.
  const mixed = [{ ...stucco[0]!, assembly: undefined }, ...stucco.slice(1)] as WallNode[]
  expect((control(mixed, 'wall-assembly-preset') as Choice).value).toBeNull()
  expect(control(mixed, 'wall-assembly-exterior')).toBeUndefined()
  // The readout covers only the assembly walls; the plain one keeps its Thickness field.
  expect(control(mixed, 'wall-thickness-assembly')).toMatchObject({
    label: 'Assembly walls',
    detail: '3 of 4, from assembly',
  })
  const thickness = wallDefinition.parametrics!.groups[0]!.fields.find(
    (field) => field.key === 'thickness',
  ) as { appliesTo?: (wall: WallNode) => boolean }
  expect(mixed.map((wall) => thickness.appliesTo!(wall))).toEqual([true, false, false, false])
  // A curtain wall is neither in the readout nor given a preset.
  const curtain = [{ ...stucco[0]!, wallType: 'curtain' }, ...stucco.slice(1)] as WallNode[]
  expect(control(curtain, 'wall-thickness-assembly')).toMatchObject({
    detail: '3 of 4, from assembly',
  })
})

test("the Preset lists the project's own wall types by name and applies one like a preset", () => {
  const walls = room()
  const type = {
    id: 'custom-deep',
    label: '2x8 stucco',
    assembly: wallTypeAssembly('custom-deep', [
      { role: 'finish', material: 'stucco', thickness: STUCCO_3_COAT },
      { role: 'structure', core: true, material: 'wood', thickness: STUD_2X8 },
      { role: 'lining', material: 'drywall', thickness: GYPSUM_HALF },
    ]),
  }
  const site = SiteNode.parse({ id: 'site_lot', wallTypes: [type] })
  const nodes = Object.fromEntries([site, ...walls].map((n) => [n.id, n])) as Record<
    AnyNodeId,
    AnyNode
  >
  useScene.setState({ nodes, rootNodeIds: [site.id as AnyNodeId] })
  useScene.temporal.getState().clear()
  useScene.temporal.getState().resume()
  const preset = control(walls, 'wall-assembly-preset') as Choice
  expect(preset.options.at(-1)).toEqual({ value: 'custom-deep', label: '2x8 stucco' })
  preset.onChange('custom-deep')
  const applied = current(walls)
  for (const wall of applied) {
    expect(wall.assembly?.presetId).toBe('custom-deep')
    expect(wall.thickness).toBeCloseTo(STUCCO_3_COAT + STUD_2X8 + GYPSUM_HALF, 9)
  }
  expect((control(applied, 'wall-assembly-preset') as Choice).value).toBe('custom-deep')
  // A type this project does not have reads as a custom stack.
  useScene.setState({ rootNodeIds: [] })
  expect((control(applied, 'wall-assembly-preset') as Choice).value).toBe('custom')
})

test('multi-select Reference: room labels, mixed shows no option, one step for every wall', () => {
  const walls = room()
  const nodes = Object.fromEntries(walls.map((w) => [w.id, w])) as Record<AnyNodeId, AnyNode>
  useScene.setState({ nodes, rootNodeIds: [] })
  useScene.temporal.getState().clear()
  useScene.temporal.getState().resume()
  const [reference] = choices(walls)
  expect(reference).toMatchObject({
    id: 'wall-reference',
    section: 'Dimensions',
    label: 'Reference',
  })
  expect(reference!.options.map((option) => option.label)).toEqual([
    'Outside face',
    'Center',
    'Inside face',
  ])
  expect(reference!.value).toBe('center')
  reference!.onChange('outside')
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  const after = walls.map((w) => useScene.getState().nodes[w.id as AnyNodeId] as WallNode)
  expect(choices(after)[0]!.value).toBe('outside')
  // Mixed: one wall back to centre.
  const mixed = [{ ...after[0]!, justification: undefined }, ...after.slice(1)] as WallNode[]
  expect(choices(mixed)[0]!.value).toBeNull()
})
