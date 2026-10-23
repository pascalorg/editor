import { expect, test } from 'bun:test'
import { DuctSegmentNode, HvacEquipmentNode, useScene } from '@pascal-app/core'
import { getHvacEquipmentPorts } from '../hvac-equipment/ports'
import { ductSurfaceClearanceM, planDuctDraw } from './tool'

const profile = { shape: 'round' as const, diameter: 6, width: 12, height: 8 }

test('keeps rectangular and oval ducts outside wall faces using their largest dimension', () => {
  expect(ductSurfaceClearanceM({ shape: 'round', diameter: 6, width: 12, height: 8 })).toBeCloseTo(
    0.0762,
  )
  expect(
    ductSurfaceClearanceM({ shape: 'rect', diameter: 6, width: 14, height: 8 }, true),
  ).toBeCloseTo(0.1878)
  expect(
    ductSurfaceClearanceM({ shape: 'oval', diameter: 6, width: 14, height: 8 }, true),
  ).toBeCloseTo(0.1878)
})

test('floor and ceiling clearance uses the height of rectangular and oval ducts', () => {
  for (const shape of ['rect', 'oval'] as const) {
    expect(ductSurfaceClearanceM({ shape, diameter: 6, width: 14, height: 8 })).toBeCloseTo(0.1016)
    expect(ductSurfaceClearanceM({ shape, diameter: 6, width: 20, height: 8 })).toBeCloseTo(0.1016)
  }
})

test('a short existing run cannot silently lose its required elbow', () => {
  const node = DuctSegmentNode.parse({
    path: [
      [-0.1, 0, 0],
      [0, 0, 0],
    ],
  })
  const original = useScene.getState().nodes
  useScene.setState({ nodes: { ...original, [node.id]: node } })
  try {
    const plan = planDuctDraw(
      [0, 0, 0],
      [0, 0, 2],
      {
        nodeId: node.id,
        id: 'end',
        position: [0, 0, 0],
        direction: [1, 0, 0],
        diameter: 6,
        system: 'supply',
      },
      null,
      null,
      null,
      profile,
      useScene.getState().nodes,
    )
    expect(plan?.validationMessage).toBeTruthy()
  } finally {
    useScene.setState({ nodes: original })
  }
})

test('a free run remains drawable', () => {
  const plan = planDuctDraw([0, 0, 0], [2, 0, 0], null, null, null, null, profile, {})
  expect(plan?.validationMessage).toBeNull()
  expect(plan?.ducts).toHaveLength(1)
  expect(plan?.fittings.map((fitting) => fitting.fittingType)).toEqual(['end-cap', 'end-cap'])
})

test('a short branch reports failure instead of omitting its tee', () => {
  const node = DuctSegmentNode.parse({
    path: [
      [-0.1, 0, 0],
      [0.1, 0, 0],
    ],
  })
  const original = useScene.getState().nodes
  useScene.setState({ nodes: { ...original, [node.id]: node } })
  try {
    const plan = planDuctDraw(
      [0, 0, 0],
      [0, 0, 2],
      null,
      { nodeId: node.id, segmentIndex: 0, point: [0, 0, 0] },
      null,
      null,
      profile,
      useScene.getState().nodes,
    )
    expect(plan?.validationMessage).toBeTruthy()
    expect(plan?.ducts).toHaveLength(0)
    expect(plan?.updates).toHaveLength(0)
  } finally {
    useScene.setState({ nodes: original })
  }
})

test('cross without joining leaves the trunk intact while connect inserts a cross', () => {
  const trunk = DuctSegmentNode.parse({
    parentId: 'level_test',
    shape: 'round',
    path: [
      [0, 2, -3],
      [0, 2, 3],
    ],
  })
  const previous = useScene.getState().nodes
  const nodes = { [trunk.id]: trunk }
  useScene.setState({ nodes })
  const surface = {
    kind: 'surface' as const,
    levelId: 'level_test' as const,
    frame: {
      origin: [0, 2, 0] as [number, number, number],
      normal: [0, 1, 0] as [number, number, number],
      tangent: [1, 0, 0] as [number, number, number],
      bitangent: [0, 0, 1] as [number, number, number],
    },
  }
  try {
    const connected = planDuctDraw(
      [-3, 2, 0],
      [3, 2, 0],
      null,
      null,
      null,
      null,
      profile,
      nodes,
      surface,
    )
    expect(connected?.validationMessage).toBeNull()
    expect(connected?.fittings.some((fitting) => fitting.fittingType === 'cross')).toBe(true)
    expect(connected?.updates.some((update) => update.id === trunk.id)).toBe(true)
    const defaults = { crossingMode: 'cross', shape: 'round' as const }
    const separate = planDuctDraw(
      [-3, 2, 0],
      [3, 2, 0],
      null,
      null,
      null,
      null,
      profile,
      nodes,
      surface,
      false,
      defaults,
    )
    expect(separate?.validationMessage).toBeNull()
    expect(separate?.fittings.some((fitting) => fitting.fittingType === 'cross')).toBe(false)
    expect(separate?.updates.some((update) => update.id === trunk.id)).toBe(false)
    expect(separate?.ducts).toHaveLength(1)
    expect(useScene.getState().nodes[trunk.id]).toEqual(trunk)
  } finally {
    useScene.setState({ nodes: previous })
  }
})

test('fixed equipment collars require a straight, matching-system connection', () => {
  const equipment = HvacEquipmentNode.parse({
    parentId: 'level_test',
    supplyShape: 'round',
    supplyDiameter: 6,
    returnShape: 'round',
    returnDiameter: 6,
  })
  const nodes = { [equipment.id]: equipment }
  for (const port of getHvacEquipmentPorts(equipment).filter((p) => p.system !== 'refrigerant')) {
    const source = { ...port, nodeId: equipment.id }
    const start: [number, number, number] = [...port.position]
    const end = start.map((value, index) => value + port.direction[index]! * 2) as [
      number,
      number,
      number,
    ]
    const plan = planDuctDraw(start, end, source, null, null, null, profile, nodes)!
    expect(plan.validationMessage).toBeNull()
    expect(plan.ducts[0]!.system).toBe(port.system)
    expect(plan.ducts[0]!.path[0]).toEqual(start)
    const wrongAxis: [number, number, number] = [start[0], start[1], start[2] + 2]
    for (const invalid of [
      planDuctDraw(start, wrongAxis, source, null, null, null, profile, nodes),
      planDuctDraw(start, end, source, null, null, null, profile, nodes, null, false, {
        system: port.system === 'supply' ? 'return' : 'supply',
      }),
    ]) {
      expect(invalid?.validationMessage).toBeTruthy()
      expect(invalid?.ducts).toHaveLength(0)
      expect(invalid?.updates).toHaveLength(0)
    }
  }
})
