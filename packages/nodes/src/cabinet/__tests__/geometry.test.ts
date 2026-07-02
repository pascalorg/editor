import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId, GeometryContext } from '@pascal-app/core'
import { Box3 } from 'three'
import type { BufferAttribute, Mesh, Object3D } from 'three'
import { buildCabinetGeometry } from '../geometry'
import { CabinetModuleNode, CabinetNode } from '../schema'
import { cabinetSlots } from '../slots'
import { MICROWAVE_STANDARD_HEIGHT } from '../stack'

function findMeshByName(root: { children: unknown[] }, name: string): Mesh {
  const queue = [...root.children]
  while (queue.length > 0) {
    const item = queue.shift() as { children?: unknown[]; name?: string }
    if (item.name === name) return item as Mesh
    if (item.children) queue.push(...item.children)
  }
  throw new Error(`Mesh not found: ${name}`)
}

function hasVertex(
  mesh: Mesh,
  predicate: (point: { x: number; y: number; z: number }) => boolean,
): boolean {
  const position = mesh.geometry.getAttribute('position') as BufferAttribute
  for (let i = 0; i < position.count; i += 1) {
    if (
      predicate({
        x: position.getX(i),
        y: position.getY(i),
        z: position.getZ(i),
      })
    ) {
      return true
    }
  }
  return false
}

function findMeshesBySlot(root: Object3D, slotId: string): Mesh[] {
  const meshes: Mesh[] = []
  root.traverse((object) => {
    const mesh = object as Mesh
    if (mesh.isMesh && mesh.userData.slotId === slotId) meshes.push(mesh)
  })
  return meshes
}

function worldBounds(object: Object3D): Box3 {
  let root = object
  while (root.parent) root = root.parent
  root.updateMatrixWorld(true)
  return new Box3().setFromObject(object)
}

function geometryContext({
  children,
  resolvables = [],
  siblings = [],
}: {
  children: AnyNode[]
  resolvables?: AnyNode[]
  siblings?: AnyNode[]
}): GeometryContext {
  const nodes = new Map([...children, ...resolvables, ...siblings].map((node) => [node.id, node]))
  return {
    children,
    parent: null,
    resolve: (id) => nodes.get(id) as never,
    siblings,
  }
}

function countertopBounds(group: Object3D) {
  return findMeshesBySlot(group, 'countertop')
    .map((mesh) => {
      mesh.geometry.computeBoundingBox()
      const box = mesh.geometry.boundingBox
      expect(box).toBeDefined()
      return {
        minX: mesh.position.x + box!.min.x,
        maxX: mesh.position.x + box!.max.x,
      }
    })
    .sort((a, b) => a.minX - b.minX)
}

describe('buildCabinetGeometry — cutout handles', () => {
  test('door cutouts sit vertically on the handle edge instead of the top edge', () => {
    const node = CabinetModuleNode.parse({
      handleStyle: 'cutout',
      width: 0.6,
      frontGap: 0.003,
      stack: [{ id: 'door', type: 'door', doorType: 'double', shelfCount: 2 }],
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)
    const leftDoor = findMeshByName(group, 'cabinet-door-left-0.460')

    leftDoor.geometry.computeBoundingBox()
    const box = leftDoor.geometry.boundingBox
    expect(box).toBeDefined()

    const maxX = box!.max.x
    const halfHeight = box!.max.y
    const hasSideBite = hasVertex(
      leftDoor,
      ({ x, y }) => Math.abs(x - (maxX - 0.014)) < 0.002 && Math.abs(y) < 0.008,
    )
    const hasTopBite = hasVertex(
      leftDoor,
      ({ x, y }) => Math.abs(x) < 0.01 && Math.abs(y - (halfHeight - 0.014)) < 0.002,
    )

    expect(hasSideBite).toBe(true)
    expect(hasTopBite).toBe(false)
  })
})

describe('buildCabinetGeometry — glass doors', () => {
  test('glass door panes use the glass slot and transparent material', () => {
    const node = CabinetModuleNode.parse({
      cabinetType: 'tall',
      width: 0.6,
      carcassHeight: 2.07,
      stack: [{ id: 'glass-door', type: 'door', doorType: 'glass', shelfCount: 4 }],
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)
    const glassPanes = findMeshesBySlot(group, 'glass')

    expect(glassPanes.length).toBe(2)
    for (const pane of glassPanes) {
      const material = Array.isArray(pane.material) ? pane.material[0]! : pane.material
      expect(pane.name.endsWith('-glass')).toBe(true)
      expect(material.transparent).toBe(true)
      expect(typeof material.opacity).toBe('number')
      expect(material.opacity).toBeLessThan(1)
    }
  })
})

describe('buildCabinetGeometry — appliance compartments', () => {
  function findObjectByName(root: Object3D, name: string): Object3D {
    let found: Object3D | null = null
    root.traverse((object) => {
      if (object.name === name) found = object
    })
    if (!found) throw new Error(`Object not found: ${name}`)
    return found
  }

  test('oven compartment emits fascia, cavity, racks, and glass door with appliance slots', () => {
    const node = CabinetModuleNode.parse({
      width: 0.6,
      carcassHeight: 0.72,
      stack: [{ id: 'oven', type: 'oven', height: 0.595 }],
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)

    expect(findMeshByName(group, 'cabinet-oven-0-fascia')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-oven-0-control-panel')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-oven-0-display')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-oven-0-display-segment-0')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-oven-0-knob-0')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-oven-0-knob-0-indicator')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-oven-0-mode-button-0')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-oven-0-status-light-0')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-oven-0-vent-0')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-oven-0-cavity-back')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-oven-0-cavity-lip-top')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-oven-0-convection-fan-ring')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-oven-0-top-heating-element')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-oven-0-rack-0-bar-1')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-oven-0-rack-1-bar-1')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-oven-0-window-gasket-top')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-oven-0-door-lower-rail')).toBeDefined()

    const glass = findMeshByName(group, 'cabinet-oven-0-door-glass')
    expect(glass.userData.slotId).toBe('glass')
    const applianceMeshes = findMeshesBySlot(group, 'appliance')
    const interiorMeshes = findMeshesBySlot(group, 'applianceInterior')
    expect(applianceMeshes.length).toBeGreaterThan(0)
    expect(interiorMeshes.length).toBeGreaterThan(0)
  })

  test('oven controls fit inside the black panel without display or light overlap', () => {
    const node = CabinetModuleNode.parse({
      width: 0.6,
      carcassHeight: 0.72,
      stack: [{ id: 'oven', type: 'oven', height: 0.595 }],
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)

    const panel = worldBounds(findMeshByName(group, 'cabinet-oven-0-control-panel'))
    const display = worldBounds(findMeshByName(group, 'cabinet-oven-0-display'))
    const controls = [
      'cabinet-oven-0-mode-button-0',
      'cabinet-oven-0-mode-button-1',
      'cabinet-oven-0-mode-button-2',
      'cabinet-oven-0-status-light-0',
      'cabinet-oven-0-status-light-1',
      'cabinet-oven-0-status-light-2',
      'cabinet-oven-0-vent-0',
      'cabinet-oven-0-vent-5',
    ].map((name) => worldBounds(findMeshByName(group, name)))

    for (const control of controls) {
      expect(control.min.x).toBeGreaterThanOrEqual(panel.min.x - 0.001)
      expect(control.max.x).toBeLessThanOrEqual(panel.max.x + 0.001)
      expect(control.min.y).toBeGreaterThanOrEqual(panel.min.y - 0.001)
      expect(control.max.y).toBeLessThanOrEqual(panel.max.y + 0.001)
    }

    for (const light of controls.slice(3, 6)) {
      expect(light.intersectsBox(display)).toBe(false)
    }
  })

  test('oven door keeps a thinner border around a larger glass window', () => {
    const node = CabinetModuleNode.parse({
      width: 0.6,
      carcassHeight: 0.72,
      stack: [{ id: 'oven', type: 'oven', height: 0.595 }],
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)

    const door = worldBounds(findObjectByName(group, 'cabinet-oven-0-door'))
    const glass = worldBounds(findMeshByName(group, 'cabinet-oven-0-door-glass'))
    const glassWidthRatio = (glass.max.x - glass.min.x) / (door.max.x - door.min.x)
    const glassHeightRatio = (glass.max.y - glass.min.y) / (door.max.y - door.min.y)

    expect(glassWidthRatio).toBeGreaterThan(0.84)
    expect(glassHeightRatio).toBeGreaterThan(0.8)
  })

  test('appliance interior default avoids a near-black void when opened', () => {
    expect(cabinetSlots().find((slot) => slot.slotId === 'applianceInterior')?.default).toBe(
      'library:preset-charcoal',
    )
  })

  test('microwave compartment emits keypad, vents, mesh window, and turntable details', () => {
    const node = CabinetModuleNode.parse({
      width: 0.61,
      carcassHeight: 0.72,
      stack: [{ id: 'micro', type: 'microwave', height: MICROWAVE_STANDARD_HEIGHT }],
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)

    expect(findMeshByName(group, 'cabinet-microwave-0-control-panel')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-microwave-0-display')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-microwave-0-display-segment-0')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-microwave-0-button-0-0')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-microwave-0-quick-button-30s')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-microwave-0-start-button')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-microwave-0-cancel-button')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-microwave-0-top-vent-0')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-microwave-0-window-dot-0-0')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-microwave-0-turntable')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-microwave-0-roller-ring')).toBeDefined()
  })

  test('microwave keypad stays compact inside the control panel', () => {
    const node = CabinetModuleNode.parse({
      width: 0.61,
      carcassHeight: 0.72,
      stack: [{ id: 'micro', type: 'microwave', height: MICROWAVE_STANDARD_HEIGHT }],
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)

    const panel = worldBounds(findMeshByName(group, 'cabinet-microwave-0-control-panel'))
    const controls = [
      'cabinet-microwave-0-display',
      'cabinet-microwave-0-quick-button-30s',
      'cabinet-microwave-0-button-0-0',
      'cabinet-microwave-0-button-3-2',
      'cabinet-microwave-0-cancel-button',
      'cabinet-microwave-0-start-button',
    ].map((name) => worldBounds(findMeshByName(group, name)))

    for (const control of controls) {
      expect(control.min.x).toBeGreaterThanOrEqual(panel.min.x - 0.001)
      expect(control.max.x).toBeLessThanOrEqual(panel.max.x + 0.001)
      expect(control.min.y).toBeGreaterThanOrEqual(panel.min.y - 0.001)
      expect(control.max.y).toBeLessThanOrEqual(panel.max.y + 0.001)
    }

    const cancel = worldBounds(findMeshByName(group, 'cabinet-microwave-0-cancel-button'))
    const start = worldBounds(findMeshByName(group, 'cabinet-microwave-0-start-button'))
    const panelHeight = panel.max.y - panel.min.y
    expect(cancel.min.y - panel.min.y).toBeGreaterThan(panelHeight * 0.14)
    expect(start.min.y - panel.min.y).toBeGreaterThan(panelHeight * 0.14)

    const ventSlats = [
      'cabinet-microwave-0-top-vent-4',
      'cabinet-microwave-0-bottom-vent-0',
    ].map((name) => worldBounds(findMeshByName(group, name)))
    for (const vent of ventSlats) {
      expect(vent.intersectsBox(panel)).toBe(false)
    }
  })

  test('oven door drops down with operationState, microwave door swings sideways', () => {
    const oven = CabinetModuleNode.parse({
      width: 0.6,
      carcassHeight: 0.72,
      operationState: 1,
      stack: [{ id: 'oven', type: 'oven', height: 0.595 }],
    })
    const ovenGroup = buildCabinetGeometry(oven, undefined, 'rendered', false)
    const ovenHinge = findObjectByName(ovenGroup, 'cabinet-oven-0-door-hinge')
    expect(ovenHinge.rotation.x).toBeCloseTo((88 * Math.PI) / 180)
    expect(ovenHinge.rotation.y).toBeCloseTo(0)

    const microwave = CabinetModuleNode.parse({
      width: 0.6,
      carcassHeight: 0.72,
      operationState: 1,
      stack: [{ id: 'micro', type: 'microwave', height: MICROWAVE_STANDARD_HEIGHT }],
    })
    const microwaveGroup = buildCabinetGeometry(microwave, undefined, 'rendered', false)
    const microwaveHinge = findObjectByName(microwaveGroup, 'cabinet-microwave-0-door-hinge')
    expect(microwaveHinge.rotation.y).toBeCloseTo(-Math.PI / 2)
    expect(microwaveHinge.rotation.x).toBeCloseTo(0)
  })
})

describe('buildCabinetGeometry — run countertops', () => {
  test('countertop overhang does not enter an adjacent tall module span', () => {
    const run = CabinetNode.parse({
      withCountertop: true,
      countertopThickness: 0.02,
      countertopOverhang: 0.02,
    })
    const modules = [
      CabinetModuleNode.parse({
        id: 'cabinet-module_base-left',
        parentId: run.id,
        cabinetType: 'base',
        position: [-0.3, 0.1, 0],
        width: 0.6,
        carcassHeight: 0.72,
      }),
      CabinetModuleNode.parse({
        id: 'cabinet-module_tall-middle',
        parentId: run.id,
        cabinetType: 'tall',
        position: [0.3, 0.1, 0],
        width: 0.6,
        carcassHeight: 2.07,
      }),
      CabinetModuleNode.parse({
        id: 'cabinet-module_base-right',
        parentId: run.id,
        cabinetType: 'base',
        position: [0.9, 0.1, 0],
        width: 0.6,
        carcassHeight: 0.72,
      }),
    ]
    const group = buildCabinetGeometry(
      run,
      geometryContext({ children: modules }),
      'rendered',
      false,
    )
    const countertops = countertopBounds(group)

    expect(countertops.length).toBe(2)
    expect(countertops[0]!.maxX).toBeCloseTo(0)
    expect(countertops[1]!.minX).toBeCloseTo(0.6)
  })

  test('countertop overhang does not enter an adjacent sibling tall cabinet', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_base-run',
      position: [0, 0, 0],
      withCountertop: true,
      countertopThickness: 0.02,
      countertopOverhang: 0.02,
    })
    const baseModule = CabinetModuleNode.parse({
      id: 'cabinet-module_base',
      parentId: run.id,
      cabinetType: 'base',
      position: [0, 0.1, 0],
      width: 0.6,
      carcassHeight: 0.72,
    })
    const tallRun = CabinetNode.parse({
      id: 'cabinet_tall-run',
      position: [-0.6, 0, 0],
      children: ['cabinet-module_tall' as AnyNodeId],
      withCountertop: true,
      countertopThickness: 0.02,
      countertopOverhang: 0.02,
    })
    const tallModule = CabinetModuleNode.parse({
      id: 'cabinet-module_tall',
      parentId: tallRun.id,
      cabinetType: 'tall',
      position: [0, 0.1, 0],
      width: 0.6,
      carcassHeight: 2.07,
    })

    const group = buildCabinetGeometry(
      run,
      geometryContext({
        children: [baseModule],
        resolvables: [tallModule],
        siblings: [tallRun],
      }),
      'rendered',
      false,
    )
    const countertops = countertopBounds(group)

    expect(countertops.length).toBe(1)
    expect(countertops[0]!.minX).toBeCloseTo(-0.3)
    expect(countertops[0]!.maxX).toBeCloseTo(0.32)
  })

  test('countertop overhang is trimmed between adjacent sibling base cabinets', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_left-run',
      position: [0, 0, 0],
      withCountertop: true,
      countertopThickness: 0.02,
      countertopOverhang: 0.02,
    })
    const baseModule = CabinetModuleNode.parse({
      id: 'cabinet-module_left',
      parentId: run.id,
      cabinetType: 'base',
      position: [0, 0.1, 0],
      width: 0.6,
      carcassHeight: 0.72,
    })
    const siblingRun = CabinetNode.parse({
      id: 'cabinet_right-run',
      position: [0.6, 0, 0],
      children: ['cabinet-module_right' as AnyNodeId],
      withCountertop: true,
      countertopThickness: 0.02,
      countertopOverhang: 0.02,
    })
    const siblingModule = CabinetModuleNode.parse({
      id: 'cabinet-module_right',
      parentId: siblingRun.id,
      cabinetType: 'base',
      position: [0, 0.1, 0],
      width: 0.6,
      carcassHeight: 0.72,
    })

    const group = buildCabinetGeometry(
      run,
      geometryContext({
        children: [baseModule],
        resolvables: [siblingModule],
        siblings: [siblingRun],
      }),
      'rendered',
      false,
    )
    const countertops = countertopBounds(group)

    expect(countertops.length).toBe(1)
    expect(countertops[0]!.minX).toBeCloseTo(-0.32)
    expect(countertops[0]!.maxX).toBeCloseTo(0.3)
  })
})
