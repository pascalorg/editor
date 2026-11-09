import { describe, expect, test } from 'bun:test'
import { type FloorplanGeometry, type GeometryContext, ItemNode, LevelNode } from '@pascal-app/core'
import { createFloorplanContextExtensions } from '@pascal-app/editor'
import { cabinetDefinition, cabinetModuleDefinition } from '../cabinet/definition'
import { buildCabinetModuleFloorplan } from '../cabinet/floorplan'
import { CabinetModuleNode, CabinetNode } from '../cabinet/schema'
import { buildItemFloorplan } from './floorplan'
import { classifyPlanItem, PLAN_SYMBOL_METADATA_KEY } from './plan-symbols'

function flatten(geometry: FloorplanGeometry | null): FloorplanGeometry[] {
  if (!geometry) return []
  if (geometry.kind !== 'group') return [geometry]
  return [geometry, ...geometry.children.flatMap(flatten)]
}

function texts(geometry: FloorplanGeometry | null): string[] {
  return flatten(geometry)
    .filter((g): g is Extract<FloorplanGeometry, { kind: 'text' }> => g.kind === 'text')
    .map((g) => g.text)
}

const drafting = createFloorplanContextExtensions({ purpose: 'document', drafting: true })
const editing = createFloorplanContextExtensions({ purpose: 'edit' })

function context(
  nodes: Record<string, unknown>,
  extensions: Readonly<Record<string, unknown>>,
): GeometryContext {
  return {
    children: [],
    parent: null,
    siblings: [],
    resolve: ((id: string) => nodes[id]) as never,
    extensions,
  }
}

function item(
  id: string,
  name: string,
  dimensions: [number, number, number],
  extra: Record<string, unknown> = {},
) {
  const level = LevelNode.parse({})
  const node = ItemNode.parse({
    parentId: level.id,
    position: [2, 0, 3],
    asset: {
      id,
      name,
      category: 'bathroom',
      src: `/${id}.glb`,
      thumbnail: '',
      floorPlanUrl: `/${id}.png`,
      dimensions,
      ...extra,
    },
  })
  return { node, nodes: { [level.id]: level, [node.id]: node } }
}

describe('permit-set item classification', () => {
  test('plumbing fixtures and appliances get their standard plan labels', () => {
    expect(classifyPlanItem({ id: 'toilet', name: 'Toilet' })).toMatchObject({
      kind: 'fixture',
      label: 'WC',
    })
    expect(classifyPlanItem({ id: 'bathroom-sink', name: 'Bathroom Sink' })).toMatchObject({
      kind: 'fixture',
      label: 'LAV',
    })
    expect(classifyPlanItem({ id: 'bathtub', name: 'Bathtub' })).toMatchObject({
      kind: 'fixture',
      label: 'TUB',
    })
    expect(classifyPlanItem({ id: 'shower-square', name: 'Squared Shower' })).toMatchObject({
      kind: 'fixture',
      label: 'SHWR',
    })
    expect(classifyPlanItem({ id: 'washing-machine', name: 'Washing Machine' })).toMatchObject({
      kind: 'fixture',
      label: 'W',
    })
    expect(classifyPlanItem({ id: 'clothes-dryer', name: 'Dryer' })).toMatchObject({
      kind: 'fixture',
      label: 'D',
    })
    expect(classifyPlanItem({ id: 'water-heater', name: 'Water Heater' })).toMatchObject({
      kind: 'fixture',
      label: 'WH',
    })
    expect(classifyPlanItem({ id: 'fridge', name: 'Fridge' })).toMatchObject({
      kind: 'fixture',
      label: 'REF',
    })
    expect(classifyPlanItem({ id: 'stove', name: 'Stove' })).toMatchObject({
      kind: 'fixture',
      label: 'R',
    })
    expect(classifyPlanItem({ id: 'dishwasher-movn72ls', name: 'Dishwasher' })).toMatchObject({
      kind: 'fixture',
      label: 'DW',
    })
    expect(classifyPlanItem({ id: 'microwave', name: 'Microwave' })).toMatchObject({
      kind: 'fixture',
      label: 'MW',
    })
    expect(classifyPlanItem({ id: 'fireplace-movn1fnn', name: 'Fireplace' })).toMatchObject({
      kind: 'fixture',
      label: 'FP',
    })
  })

  test('look-alikes are not fixtures', () => {
    expect(classifyPlanItem({ id: 'toilet-paper', name: 'Toilet Paper' }).kind).toBe('omit')
    expect(classifyPlanItem({ id: 'shower-rug', name: 'Shower Rug' }).kind).toBe('omit')
    expect(classifyPlanItem({ id: 'drying-rack', name: 'Drying Rack' }).kind).toBe('omit')
    expect(classifyPlanItem({ id: 'bedside-table', name: 'Bedside Table' })).toEqual({
      kind: 'furniture',
      shape: 'plain',
    })
  })

  test('ceiling items, decor and the car', () => {
    expect(
      classifyPlanItem({ id: 'ceiling-lamp', name: 'Ceiling Lamp', attachTo: 'ceiling' }).kind,
    ).toBe('omit')
    expect(classifyPlanItem({ id: 'indoor-plant', name: 'Indoor Plant' }).kind).toBe('omit')
    expect(classifyPlanItem({ id: 'tesla', name: 'Tesla Model Y' }).kind).toBe('car')
    expect(classifyPlanItem({ id: 'double-bed', name: 'Double Bed' })).toEqual({
      kind: 'furniture',
      shape: 'bed',
    })
    expect(classifyPlanItem({ id: 'kitchen-counter', name: 'Kitchen Counter' }).kind).toBe(
      'casework',
    )
  })
})

describe('item floor plan on a sheet (drafting)', () => {
  test('a toilet draws labelled linework and no sprite', () => {
    const { node, nodes } = item('toilet', 'Toilet', [0.42, 0.82, 0.72])
    const drawn = buildItemFloorplan(node, context(nodes, drafting))
    expect(drawn?.kind).toBe('group')
    expect(
      flatten(drawn).some(
        (g) =>
          (g as { metadata?: Record<string, unknown> }).metadata?.[PLAN_SYMBOL_METADATA_KEY] ===
          'fixture',
      ),
    ).toBe(true)
    expect(texts(drawn)).toEqual(['WC'])
    expect(flatten(drawn).some((g) => g.kind === 'image')).toBe(false)
  })

  test('a double vanity labels each basin, each in its own group', () => {
    const { node, nodes } = item('bathroom-sink', 'Bathroom Sink', [1.83, 0.97, 0.63])
    const drawn = buildItemFloorplan(node, context(nodes, drafting))
    expect(texts(drawn)).toEqual(['LAV', 'LAV'])
    // two labels at one x in one group would be re-spaced as a stacked block
    const groupsWithLabels = flatten(drawn).filter(
      (g) => g.kind === 'group' && g.children.some((c) => c.kind === 'text'),
    )
    expect(groupsWithLabels).toHaveLength(2)
  })

  test('a ceiling lamp draws nothing on the sheet', () => {
    const { node, nodes } = item('ceiling-lamp', 'Ceiling Lamp', [0.55, 0.86, 0.55], {
      attachTo: 'ceiling',
    })
    expect(buildItemFloorplan(node, context(nodes, drafting))).toBeNull()
  })

  test('the editor keeps its sprite', () => {
    const { node, nodes } = item('toilet', 'Toilet', [0.42, 0.82, 0.72])
    const drawn = buildItemFloorplan(node, context(nodes, editing))
    expect(flatten(drawn).some((g) => g.kind === 'image')).toBe(true)
    expect(texts(drawn)).toEqual([])
  })
})

describe('cabinet module labels on a sheet', () => {
  function moduleLabel(
    stack: Array<Record<string, unknown>>,
    run: Partial<Record<string, unknown>> = {},
    module: Partial<Record<string, unknown>> = {},
  ): string[] {
    const parent = CabinetNode.parse({ ...cabinetDefinition.defaults(), id: 'cabinet_run', ...run })
    const node = CabinetModuleNode.parse({
      ...cabinetModuleDefinition.defaults(),
      id: 'cabinet-module_a',
      parentId: parent.id,
      stack,
      ...module,
    })
    const nodes = { [parent.id]: parent, [node.id]: node }
    return texts(
      buildCabinetModuleFloorplan(node, { ...context(nodes, drafting), parent } as GeometryContext),
    )
  }

  test('a kitchen sink base is SINK, a vanity sink base is LAV', () => {
    const sink = [{ id: 'c1', type: 'sink', sinkLayout: 'single' }]
    expect(moduleLabel(sink, { name: 'Base Cabinets' }, { depth: 0.6096 })).toEqual(['SINK'])
    expect(moduleLabel(sink, { name: 'Vanity' }, { depth: 0.5334 })).toEqual(['LAV'])
  })

  test('an oven under a cooktop is the range, R', () => {
    expect(
      moduleLabel([
        { id: 'c1', type: 'oven' },
        { id: 'c2', type: 'cooktop-gas' },
      ]),
    ).toEqual(['R'])
  })
})
