import { afterEach, expect, test } from 'bun:test'
import { DuctFittingNode, PipeFittingNode } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { Mesh } from 'three'
import { ductFittingDefinition } from '../duct-fitting/definition'
import { buildDuctFittingGeometry } from '../duct-fitting/geometry'
import { getDuctFittingPorts } from '../duct-fitting/ports'
import { pipeFittingDefinition } from '../pipe-fitting/definition'
import { buildPipeFittingGeometry } from '../pipe-fitting/geometry'
import { getPipeFittingPorts } from '../pipe-fitting/ports'
import { inheritFittingProfile } from './accessory-placement'
import { ductFittingToolOptions, pipeFittingToolOptions } from './fitting-tool-options'

const original = useEditor.getState().toolDefaults
afterEach(() => useEditor.setState({ toolDefaults: original }))

for (const kind of ['duct-fitting', 'pipe-fitting'] as const) {
  test(`selecting ${kind} reducer creates a taper rather than a straight coupling`, () => {
    useEditor.getState().setToolDefaults(kind, null)
    const options = kind === 'duct-fitting' ? ductFittingToolOptions : pipeFittingToolOptions
    options.find((o) => o.id === 'fittingType')!.set('reducer')
    const defaults = useEditor.getState().toolDefaults[kind]
    const node =
      kind === 'duct-fitting'
        ? DuctFittingNode.parse({ ...ductFittingDefinition.defaults(), ...defaults })
        : PipeFittingNode.parse({ ...pipeFittingDefinition.defaults(), ...defaults })
    expect(node.diameter2).toBeLessThan(node.diameter)
    const group =
      node.type === 'duct-fitting' ? buildDuctFittingGeometry(node) : buildPipeFittingGeometry(node)
    const taper = group.getObjectByName(
      node.type === 'duct-fitting' ? 'fitting-taper' : 'pipe-reducer-taper',
    )
    expect(taper).toBeInstanceOf(Mesh)
    if (taper instanceof Mesh && 'parameters' in taper.geometry) {
      const parameters = taper.geometry.parameters as { radiusTop: number; radiusBottom: number }
      expect(parameters.radiusTop).toBeLessThan(parameters.radiusBottom)
    }
  })
}
test('round tee and cross branches advertise the round profile that is rendered', () => {
  for (const fittingType of ['tee', 'cross'] as const) {
    const node = DuctFittingNode.parse({ fittingType, shape: 'round', shape2: 'rect' })
    expect(getDuctFittingPorts(node).every((port) => port.shape === 'round')).toBe(true)
  }
})

test('every duct catalog choice creates its advertised model and connection count', () => {
  const models: Record<string, [string, number]> = {
    elbow: ['fitting-elbow-rect', 2],
    tee: ['fitting-run', 3],
    cross: ['fitting-run', 4],
    reducer: ['fitting-taper', 2],
    transition: ['fitting-transition-loft', 2],
    'end-cap': ['end-cap-closure', 1],
    damper: ['damper-blade', 2],
    'access-panel': ['access-door', 0],
  }
  const catalog = ductFittingToolOptions.find((o) => o.id === 'fittingType')!
  for (const choice of catalog.choices) {
    useEditor.getState().setToolDefaults('duct-fitting', null)
    catalog.set(choice.value)
    const node = DuctFittingNode.parse({
      ...ductFittingDefinition.defaults(),
      ...useEditor.getState().toolDefaults['duct-fitting'],
    })
    const [part, count] = models[choice.value]!
    expect(node.fittingType).toBe(choice.value)
    expect(buildDuctFittingGeometry(node).getObjectByName(part)).toBeDefined()
    expect(getDuctFittingPorts(node)).toHaveLength(count)
    if (node.fittingType === 'transition') {
      expect(getDuctFittingPorts(node).map((p) => p.shape)).toEqual(['rect', 'round'])
    }
  }
})

test('duct coupling stays loadable but is absent from the placement catalog', () => {
  const catalog = ductFittingToolOptions.find((option) => option.id === 'fittingType')!
  expect(catalog.choices.some((choice) => choice.value === 'coupling')).toBe(false)

  const savedCoupling = DuctFittingNode.parse({ fittingType: 'coupling' })
  expect(
    buildDuctFittingGeometry(savedCoupling).getObjectByName('coupling-center-seam'),
  ).toBeDefined()
  expect(getDuctFittingPorts(savedCoupling)).toHaveLength(2)
})

test('every pipe catalog choice creates its advertised model and connection count', () => {
  const models: Record<string, [string, number]> = {
    elbow: ['pipe-fitting-elbow-sweep', 2],
    wye: ['pipe-fitting-wye-branch-sweep', 3],
    'sanitary-tee': ['pipe-fitting-sanitary-tee-branch-sweep', 3],
    cross: ['pipe-fitting-cross-branch2-sweep', 4],
    reducer: ['pipe-reducer-taper', 2],
    'end-cap': ['pipe-end-cap-closure', 1],
    cleanout: ['cleanout-hex-head', 1],
    coupling: ['pipe-accessory-body', 2],
  }
  const catalog = pipeFittingToolOptions.find((o) => o.id === 'fittingType')!
  for (const choice of catalog.choices) {
    useEditor.getState().setToolDefaults('pipe-fitting', null)
    catalog.set(choice.value)
    const node = PipeFittingNode.parse({
      ...pipeFittingDefinition.defaults(),
      ...useEditor.getState().toolDefaults['pipe-fitting'],
    })
    const [part, count] = models[choice.value]!
    expect(node.fittingType).toBe(choice.value)
    expect(buildPipeFittingGeometry(node).getObjectByName(part)).toBeDefined()
    expect(getPipeFittingPorts(node)).toHaveLength(count)
  }
})

test('reducer resizing and port inheritance keep a real size change', () => {
  for (const kind of ['duct-fitting', 'pipe-fitting'] as const) {
    useEditor.getState().setToolDefaults(kind, null)
    const options = kind === 'duct-fitting' ? ductFittingToolOptions : pipeFittingToolOptions
    options.find((o) => o.id === 'fittingType')!.set('reducer')
    options.find((o) => o.id === 'diameter')!.set('4')
    options.find((o) => o.id === 'diameter2')!.set('4')
    const defaults = useEditor.getState().toolDefaults[kind]
    const node =
      kind === 'duct-fitting'
        ? DuctFittingNode.parse({ ...ductFittingDefinition.defaults(), ...defaults })
        : PipeFittingNode.parse({ ...pipeFittingDefinition.defaults(), ...defaults })
    expect(node.diameter).not.toBe(node.diameter2)
    const placed = inheritFittingProfile(
      node,
      {
        nodeId: 'pipe-segment_test',
        id: 'end',
        position: [0, 0, 0],
        direction: [1, 0, 0],
        diameter: node.diameter2,
      },
      {},
    )
    expect(placed.diameter).toBe(node.diameter2)
    expect(placed.diameter2).not.toBe(placed.diameter)
  }
})

test('round branch controls match geometry while rectangular branches keep their own dimensions', () => {
  useEditor.getState().setToolDefaults('duct-fitting', null)
  const set = (id: string, value: string) =>
    ductFittingToolOptions.find((o) => o.id === id)!.set(value)
  const visible = (id: string) => ductFittingToolOptions.find((o) => o.id === id)!.visible!.value()
  set('fittingType', 'tee')
  set('shape', 'round')
  expect(visible('branchDiameter')).toBe(true)
  expect(visible('width2')).toBe(false)
  set('branchDiameter', '6')
  set('shape', 'rect')
  set('shape2', 'oval')
  expect(visible('branchDiameter')).toBe(false)
  expect(visible('width2')).toBe(true)
  const node = DuctFittingNode.parse({
    ...ductFittingDefinition.defaults(),
    ...useEditor.getState().toolDefaults['duct-fitting'],
  })
  expect(getDuctFittingPorts(node).find((p) => p.id === 'branch')?.shape).toBe('oval')
})

for (const shape of ['round', 'rect', 'oval'] as const) {
  test(`placing a transition on a ${shape} end keeps different end profiles`, () => {
    const node = DuctFittingNode.parse({ fittingType: 'transition', width: 20, height: 10 })
    const placed = inheritFittingProfile(
      node,
      {
        nodeId: 'duct-segment_test',
        id: 'end',
        position: [0, 0, 0],
        direction: [1, 0, 0],
        diameter: 6,
        shape,
        width: 14,
        height: 8,
      },
      {},
    )
    const ports = getDuctFittingPorts(placed)
    expect(ports[0]!.shape).toBe(shape)
    expect(ports[1]!.shape).not.toBe(shape)
    expect(
      buildDuctFittingGeometry(placed).getObjectByName('fitting-transition-loft'),
    ).toBeDefined()
    if (shape === 'round') {
      expect(ports[1]!.shape).toBe('rect')
      expect(ports[1]!.width).toBe(20)
      expect(ports[1]!.height).toBe(10)
    }
  })
}
test('snapping onto the configured outlet reverses the transition and preserves the other end dimensions', () => {
  const node = DuctFittingNode.parse({
    fittingType: 'transition',
    inletShape: 'oval',
    outletShape: 'round',
    width: 24,
    height: 10,
  })
  const placed = inheritFittingProfile(
    node,
    {
      nodeId: 'duct-segment_test',
      id: 'end',
      position: [0, 0, 0],
      direction: [0, 1, 0],
      diameter: 8,
      shape: 'round',
    },
    {},
  )
  expect(getDuctFittingPorts(placed).map((port) => port.shape)).toEqual(['round', 'oval'])
  expect(placed.width2).toBe(24)
  expect(placed.height2).toBe(10)
  expect(node.inletShape).toBe('oval')
})

test('transition stays circular-to-rectangular when stale placement supplies two round ends', () => {
  const node = DuctFittingNode.parse({
    fittingType: 'transition',
    inletShape: 'round',
    outletShape: 'round',
    diameter: 12,
    diameter2: 10,
  })
  expect(getDuctFittingPorts(node).map((port) => port.shape)).toEqual(['round', 'rect'])
  const model = buildDuctFittingGeometry(node)
  expect(model.getObjectByName('fitting-flange-outlet')).toBeDefined()
  expect(model.getObjectByName('fitting-taper')).toBeUndefined()
})

test('choosing a round transition inlet automatically selects a rectangular outlet', () => {
  useEditor.getState().setToolDefaults('duct-fitting', null)
  ductFittingToolOptions.find((option) => option.id === 'fittingType')!.set('transition')
  ductFittingToolOptions.find((option) => option.id === 'inletShape')!.set('round')
  const defaults = useEditor.getState().toolDefaults['duct-fitting']!
  expect(defaults.fittingType).toBe('transition')
  expect(defaults.inletShape).toBe('round')
  expect(defaults.outletShape).toBe('rect')
})
