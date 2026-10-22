import { expect, test } from 'bun:test'
import { HvacEquipmentNode, LinesetNode, LiquidLineNode, portConnection } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { Box3, type Group, Vector3 } from 'three'
import { hvacEquipmentDefinition, linesetDefinition, liquidLineDefinition } from '../index'

const equipment = HvacEquipmentNode.parse({})

test('legacy equipment preserves its original collars and gains a separate liquid port', () => {
  const ports = hvacEquipmentDefinition.ports!(equipment)
  expect(ports.find((p) => p.id === 'supply')!.position).toEqual([0, equipment.height, 0])
  expect(ports.find((p) => p.id === 'return')!.position).toEqual([
    -equipment.width / 2,
    equipment.height * 0.35,
    0,
  ])
  const suction = ports.find((p) => p.id === 'lineset')!
  expect(suction.position).toEqual([equipment.width / 2, equipment.height * 0.8, 0])
  expect(suction.diameter).toBe(0.875)
  const liquid = ports.find((p) => p.id === 'liquid')!
  expect(liquid.position).not.toEqual(suction.position)
  expect(liquid.connectionType).toBe('liquid')
  expect(liquid.diameter).toBe(0.375)
})

test('configurable faces and rotation place rendered collars at the advertised ports', () => {
  for (const equipmentType of ['furnace', 'air-handler', 'condenser'] as const) {
    const node = HvacEquipmentNode.parse({
      equipmentType,
      supplyFace: 'left',
      returnFace: 'right',
      serviceFace: 'left',
      suctionDiameter: 1.125,
      liquidDiameter: 0.5,
    })
    const ports = hvacEquipmentDefinition.ports!(node)
    const geometry = hvacEquipmentDefinition.geometry!(node, {} as never) as Group
    geometry.updateMatrixWorld(true)
    for (const port of ports.filter((p) => p.system !== 'refrigerant')) {
      const collar = geometry.getObjectByName(`equipment-collar-${port.id}`)!
      expect(collar).toBeDefined()
      expect(new Box3().setFromObject(collar).containsPoint(new Vector3(...port.position))).toBe(
        true,
      )
    }
    for (const port of ports.filter((p) => p.system === 'refrigerant')) {
      const stub = geometry.getObjectByName(`service-valve-stub-${port.id}`)!
      const tip = new Vector3(0, -0.035, 0).applyMatrix4(stub.matrixWorld)
      expect(tip.distanceTo(new Vector3(...port.position))).toBeLessThan(0.0001)
    }
    const rotated = hvacEquipmentDefinition.ports!({
      ...node,
      position: [4, 1, 2],
      rotation: Math.PI / 2,
    })
    const suction = rotated.find((p) => p.id === 'lineset')!
    expect(suction.direction[2]).toBeCloseTo(1)
    expect(suction.position[0]).toBeCloseTo(4)
    expect(suction.position[2]).toBeCloseTo(2 + node.width / 2)
  }
})

test('separate suction and liquid routes mate only to their own service connections', () => {
  const ports = hvacEquipmentDefinition.ports!(equipment)
  for (const id of ['lineset', 'liquid']) {
    const port = ports.find((p) => p.id === id)!
    const path = [port.position, [port.position[0] + 1, port.position[1], port.position[2]]]
    const run =
      id === 'lineset'
        ? LinesetNode.parse({ path, liquidDiameter: 0.75 })
        : LiquidLineNode.parse({ path })
    const start = (
      id === 'lineset'
        ? linesetDefinition.ports!(run as LinesetNode)
        : liquidLineDefinition.ports!(run as LiquidLineNode)
    )[0]!
    expect(portConnection(port, start).status).toBe('match')
    expect(
      portConnection({ ...port, connectionType: id === 'lineset' ? 'liquid' : 'suction' }, start)
        .status,
    ).toBe('incompatible')
  }
})

test('equipment choices apply valid named cabinet presets before placement', () => {
  const previous = useEditor.getState().toolDefaults
  try {
    const option = hvacEquipmentDefinition.toolOptions![0]!
    for (const value of ['furnace', 'air-handler', 'condenser']) {
      option.set(value)
      const configured = HvacEquipmentNode.parse({
        ...hvacEquipmentDefinition.defaults(),
        ...useEditor.getState().toolDefaults['hvac-equipment'],
      })
      expect(configured.equipmentType).toBe(value)
      expect(configured.name).toBeDefined()
      expect(option.value()).toBe(value)
    }
  } finally {
    useEditor.setState({ toolDefaults: previous })
  }
})
