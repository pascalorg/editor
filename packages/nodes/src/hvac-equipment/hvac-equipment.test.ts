import { expect, test } from 'bun:test'
import { HvacEquipmentNode, LinesetNode, LiquidLineNode, portConnection } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { Box3, type Group, Mesh, Vector3 } from 'three'
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

for (const [definition, schema] of [
  [hvacEquipmentDefinition, HvacEquipmentNode],
  [linesetDefinition, LinesetNode],
  [liquidLineDefinition, LiquidLineNode],
] as const) {
  test(`${definition.kind} paint survives reload without moving geometry or adding triangles`, () => {
    const node = schema.parse({
      path: [
        [0, 0, 0],
        [2, 0, 0],
      ],
    })
    const before = JSON.stringify(node)
    const build = definition.geometry as (value: typeof node, ctx: never) => Group
    const original = build(node, {} as never)
    expect(JSON.stringify(node)).toBe(before)
    expect(node.slots).toBeUndefined()
    const meshes: Mesh[] = []
    original.traverse((object) => {
      if (object instanceof Mesh) meshes.push(object)
    })
    expect(meshes.length).toBeGreaterThan(0)
    for (const mesh of meshes) {
      const role = definition.capabilities!.paint!.resolveRole({ node, hitObject: mesh } as never)
      expect(role).toBe(mesh.userData.slotId)
      expect(role).toBeTruthy()
    }
    const role = meshes[0]!.userData.slotId as string
    const paint = definition.capabilities!.paint!
    const patch = paint.buildPatch({
      node,
      role,
      material: undefined,
      materialPreset: 'library:preset-white',
    })
    const restored = schema.parse(JSON.parse(JSON.stringify({ ...node, ...patch })))
    expect(restored.slots?.[role]).toBe('library:preset-white')
    const painted = build(restored, {} as never)
    const snapshot = (group: Group) => {
      const result: unknown[] = []
      group.traverse((object) => {
        if (!(object instanceof Mesh)) return
        result.push({
          name: object.name,
          position: object.position.toArray(),
          vertices: Array.from(object.geometry.getAttribute('position').array),
          indices: object.geometry.index ? Array.from(object.geometry.index.array) : null,
        })
      })
      return result
    }
    expect(snapshot(painted)).toEqual(snapshot(original))
    const paintedMesh = painted.getObjectByName(meshes[0]!.name) as Mesh
    expect(paintedMesh.material).not.toBe(meshes[0]!.material)
    meshes[0]!.userData.__fromGeometry = true
    const previous = meshes[0]!.material
    const restore = paint.applyPreview({
      node,
      role,
      root: original,
      material: undefined,
      materialPreset: 'library:preset-white',
    })
    expect(meshes[0]!.material).not.toBe(previous)
    restore?.()
    expect(meshes[0]!.material).toBe(previous)
  })
}
