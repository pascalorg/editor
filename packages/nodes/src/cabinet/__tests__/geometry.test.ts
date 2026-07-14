import { describe, expect, test } from 'bun:test'
import type {
  AnyNode,
  AnyNodeId,
  GeometryContext,
  HandleDescriptor,
  LinearResizeHandle,
} from '@pascal-app/core'
import type { BufferAttribute, Mesh, Object3D } from 'three'
import { Box3 } from 'three'
import { bakeCabinetAnimationClip } from '../animation'
import { cabinetDefinition, cabinetModuleDefinition } from '../definition'
import { buildCabinetGeometry } from '../geometry'
import { runLocalToPlan } from '../run-layout'
import { addCornerRun, wallBottomHeightForTallAlignment } from '../run-ops'
import { CabinetModuleNode, CabinetNode } from '../schema'
import { cabinetSlots } from '../slots'
import {
  backAnchoredModuleZ,
  COOKTOP_DEFAULT_HEIGHT,
  COOKTOP_STANDARD_WIDTH,
  DISHWASHER_STANDARD_HEIGHT,
  DISHWASHER_STANDARD_WIDTH,
  FRIDGE_COLUMN_HEIGHT,
  FRIDGE_COLUMN_WIDTH,
  FRIDGE_STANDARD_DEPTH,
  FRIDGE_WIDE_WIDTH,
  fridgeCabinetStack,
  HOOD_CANOPY_DEPTH,
  HOOD_CURVED_TOTAL_HEIGHT,
  HOOD_DUCT_SIZE,
  HOOD_PYRAMID_CANOPY_HEIGHT,
  MICROWAVE_STANDARD_HEIGHT,
  PULL_OUT_PANTRY_DEFAULT_SHELF_COUNT,
  PULL_OUT_PANTRY_STANDARD_WIDTH,
  SINK_STANDARD_WIDTH,
  TALL_CABINET_CARCASS_HEIGHT,
} from '../stack'

function findMeshByName(root: { children: unknown[] }, name: string): Mesh {
  const queue = [...root.children]
  while (queue.length > 0) {
    const item = queue.shift() as { children?: unknown[]; name?: string }
    if (item.name === name) return item as Mesh
    if (item.children) queue.push(...item.children)
  }
  throw new Error(`Mesh not found: ${name}`)
}

function findMeshByNamePrefix(root: { children: unknown[] }, prefix: string): Mesh {
  const queue = [...root.children]
  while (queue.length > 0) {
    const item = queue.shift() as { children?: unknown[]; name?: string }
    if (item.name?.startsWith(prefix)) return item as Mesh
    if (item.children) queue.push(...item.children)
  }
  throw new Error(`Mesh not found with prefix: ${prefix}`)
}

/**
 * Coordinate-encoded names (`cabinet-drawer-front-<centerY>-<i>`) shift when
 * dimension defaults change; match on the stable prefix/suffix instead.
 */
function findMeshByNamePattern(root: { children: unknown[] }, pattern: RegExp): Mesh {
  const queue = [...root.children]
  while (queue.length > 0) {
    const item = queue.shift() as { children?: unknown[]; name?: string }
    if (item.name && pattern.test(item.name)) return item as Mesh
    if (item.children) queue.push(...item.children)
  }
  throw new Error(`Mesh not found matching: ${pattern}`)
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

function sceneApiFixture(seed: AnyNode[]) {
  const nodes = Object.fromEntries(seed.map((node) => [node.id, node])) as Record<
    AnyNodeId,
    AnyNode
  >

  return {
    get: (id: AnyNodeId) => nodes[id],
    nodes: () => nodes,
    update: (id: AnyNodeId, patch: Partial<AnyNode>) => {
      const current = nodes[id]
      if (!current) return
      nodes[id] = { ...current, ...patch } as AnyNode
    },
    upsert: (node: AnyNode, parentId?: AnyNodeId | null) => {
      nodes[node.id as AnyNodeId] = node
      if (parentId) {
        const parent = nodes[parentId]
        if (parent && Array.isArray((parent as { children?: unknown }).children)) {
          const children = new Set(((parent as { children?: AnyNodeId[] }).children ?? []).slice())
          children.add(node.id as AnyNodeId)
          nodes[parentId] = { ...parent, children: [...children] } as AnyNode
        }
      }
      return node.id as AnyNodeId
    },
    delete: () => {},
    restore: () => {},
    restoreAll: () => {},
    markDirty: () => {},
    pauseHistory: () => {},
    resumeHistory: () => {},
    getSubtree: () => null,
    cloneNodesInto: () => null,
  }
}

function resolveCabinetWorldTransform(
  node: CabinetNode | CabinetModuleNode,
  nodes: Record<AnyNodeId, AnyNode>,
): { position: [number, number, number]; rotation: number } {
  const parent = node.parentId ? nodes[node.parentId as AnyNodeId] : null
  if (parent?.type === 'cabinet' || parent?.type === 'cabinet-module') {
    const worldParent = resolveCabinetWorldTransform(parent, nodes)
    return {
      position: runLocalToPlan(
        {
          position: worldParent.position,
          rotation: worldParent.rotation,
        },
        node.position,
      ),
      rotation: worldParent.rotation + node.rotation,
    }
  }

  return {
    position: [...node.position] as [number, number, number],
    rotation: node.rotation,
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
        minZ: mesh.position.z + box!.min.z,
        maxZ: mesh.position.z + box!.max.z,
      }
    })
    .sort((a, b) => a.minX - b.minX)
}

function boxTopUvSpan(mesh: Mesh) {
  const uv = mesh.geometry.getAttribute('uv') as BufferAttribute
  const faceStart = 8
  const values = Array.from({ length: 4 }, (_, index) => ({
    u: uv.getX(faceStart + index),
    v: uv.getY(faceStart + index),
  }))
  return {
    u: Math.max(...values.map((value) => value.u)) - Math.min(...values.map((value) => value.u)),
    v: Math.max(...values.map((value) => value.v)) - Math.min(...values.map((value) => value.v)),
  }
}

function boxFrontUvSpan(mesh: Mesh) {
  const uv = mesh.geometry.getAttribute('uv') as BufferAttribute
  const faceStart = 16
  const values = Array.from({ length: 4 }, (_, index) => ({
    u: uv.getX(faceStart + index),
    v: uv.getY(faceStart + index),
  }))
  return {
    u: Math.max(...values.map((value) => value.u)) - Math.min(...values.map((value) => value.u)),
    v: Math.max(...values.map((value) => value.v)) - Math.min(...values.map((value) => value.v)),
  }
}

function shakerFrameSize(width: number, height: number) {
  return Math.min(0.085, Math.max(0.045, Math.min(width, height) * (height >= 0.22 ? 0.16 : 0.2)))
}

function raisedArchFrameSize(width: number, height: number) {
  return Math.min(0.09, Math.max(0.048, Math.min(width, height) * (height >= 0.22 ? 0.17 : 0.21)))
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
    const leftDoor = findMeshByNamePattern(group, /^cabinet-door-left-[\d.]+$/)

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

describe('buildCabinetGeometry — shaker fronts', () => {
  test('door fronts add a recessed center panel while keeping the outer frame proud', () => {
    const node = CabinetModuleNode.parse({
      frontStyle: 'shaker',
      width: 0.6,
      stack: [{ id: 'door', type: 'door', doorType: 'double', shelfCount: 2 }],
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)
    const leftDoor = findMeshByNamePattern(group, /^cabinet-door-left-[\d.]+$/)

    leftDoor.geometry.computeBoundingBox()
    const box = leftDoor.geometry.boundingBox
    expect(box).toBeDefined()

    const position = leftDoor.geometry.getAttribute('position') as BufferAttribute
    let frameMaxZ = -Infinity
    let panelMaxZ = -Infinity
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i)
      const y = position.getY(i)
      const z = position.getZ(i)
      if (Math.abs(x) < 0.07 && Math.abs(y) < 0.16) panelMaxZ = Math.max(panelMaxZ, z)
      else frameMaxZ = Math.max(frameMaxZ, z)
    }

    expect(frameMaxZ).toBeGreaterThan(panelMaxZ + 0.002)
  })

  test('door bar handles sit on the shaker side frame instead of the recessed panel', () => {
    const node = CabinetModuleNode.parse({
      frontStyle: 'shaker',
      width: 0.6,
      stack: [{ id: 'door', type: 'door', doorType: 'double', shelfCount: 2 }],
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)
    const leftDoor = findMeshByNamePattern(group, /^cabinet-door-left-[\d.]+$/)
    const handle = findMeshByNamePattern(group, /^cabinet-door-left-[\d.]+-handle$/)

    leftDoor.geometry.computeBoundingBox()
    const box = leftDoor.geometry.boundingBox
    expect(box).toBeDefined()

    const frame = shakerFrameSize(box!.max.x - box!.min.x, box!.max.y - box!.min.y)
    expect(handle.position.x).toBeCloseTo(box!.max.x - frame / 2, 3)
  })

  test('door knob handles sit on the shaker side frame too', () => {
    const node = CabinetModuleNode.parse({
      frontStyle: 'shaker',
      handleStyle: 'knob',
      width: 0.6,
      stack: [{ id: 'door', type: 'door', doorType: 'double', shelfCount: 2 }],
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)
    const leftDoor = findMeshByNamePattern(group, /^cabinet-door-left-[\d.]+$/)
    const knob = findMeshByNamePattern(group, /^cabinet-door-left-[\d.]+-handle$/)

    leftDoor.geometry.computeBoundingBox()
    const box = leftDoor.geometry.boundingBox
    expect(box).toBeDefined()

    const frame = shakerFrameSize(box!.max.x - box!.min.x, box!.max.y - box!.min.y)
    expect(knob.position.x).toBeCloseTo(box!.max.x - frame / 2, 3)
  })

  test('drawer fronts support the same recessed shaker profile', () => {
    const node = CabinetModuleNode.parse({
      frontStyle: 'shaker',
      width: 0.6,
      stack: [{ id: 'drawer', type: 'drawer', drawerCount: 3 }],
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)
    const drawerFront = findMeshByNamePrefix(group, 'cabinet-drawer-front-')

    drawerFront.geometry.computeBoundingBox()
    const box = drawerFront.geometry.boundingBox
    expect(box).toBeDefined()

    const position = drawerFront.geometry.getAttribute('position') as BufferAttribute
    let frameMaxZ = -Infinity
    let panelMaxZ = -Infinity
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i)
      const y = position.getY(i)
      const z = position.getZ(i)
      if (Math.abs(x) < 0.08 && Math.abs(y) < 0.03) panelMaxZ = Math.max(panelMaxZ, z)
      else frameMaxZ = Math.max(frameMaxZ, z)
    }

    expect(frameMaxZ).toBeGreaterThan(panelMaxZ + 0.002)
  })

  test('drawer handles sit on the shaker top rail instead of the recessed panel', () => {
    const node = CabinetModuleNode.parse({
      frontStyle: 'shaker',
      width: 0.6,
      stack: [{ id: 'drawer', type: 'drawer', drawerCount: 3 }],
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)
    const drawerFront = findMeshByNamePrefix(group, 'cabinet-drawer-front-')
    const handle = findMeshByNamePattern(group, /^cabinet-drawer-handle-[\d.]+-\d+$/)

    drawerFront.geometry.computeBoundingBox()
    const box = drawerFront.geometry.boundingBox
    expect(box).toBeDefined()

    const frame = shakerFrameSize(box!.max.x - box!.min.x, box!.max.y - box!.min.y)
    expect(handle.position.y).toBeCloseTo(box!.max.y - frame / 2, 3)
  })
})

describe('buildCabinetGeometry — raised arch fronts', () => {
  test('door bar handles sit on the raised-arch side frame instead of the recessed panel', () => {
    const node = CabinetModuleNode.parse({
      frontStyle: 'raised-arch',
      width: 0.6,
      stack: [{ id: 'door', type: 'door', doorType: 'double', shelfCount: 2 }],
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)
    const leftDoor = findMeshByNamePattern(group, /^cabinet-door-left-[\d.]+$/)
    const handle = findMeshByNamePattern(group, /^cabinet-door-left-[\d.]+-handle$/)

    leftDoor.geometry.computeBoundingBox()
    const box = leftDoor.geometry.boundingBox
    expect(box).toBeDefined()

    const frame = raisedArchFrameSize(box!.max.x - box!.min.x, box!.max.y - box!.min.y)
    expect(handle.position.x).toBeCloseTo(box!.max.x - frame / 2, 3)
  })

  test('drawer auto handles sit on the raised-arch top rail instead of the recessed panel', () => {
    const node = CabinetModuleNode.parse({
      frontStyle: 'raised-arch',
      width: 0.6,
      stack: [{ id: 'drawer', type: 'drawer', drawerCount: 3 }],
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)
    const drawerFront = findMeshByNamePrefix(group, 'cabinet-drawer-front-')
    const handle = findMeshByNamePattern(group, /^cabinet-drawer-handle-[\d.]+-\d+$/)

    drawerFront.geometry.computeBoundingBox()
    const box = drawerFront.geometry.boundingBox
    expect(box).toBeDefined()

    const frame = raisedArchFrameSize(box!.max.x - box!.min.x, box!.max.y - box!.min.y)
    expect(handle.position.y).toBeCloseTo(box!.max.y - frame / 2, 3)
  })

  test('drawer centered handles stay vertically centered when requested', () => {
    const node = CabinetModuleNode.parse({
      frontStyle: 'raised-arch',
      handlePosition: 'center',
      width: 0.6,
      stack: [{ id: 'drawer', type: 'drawer', drawerCount: 3 }],
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)
    const handle = findMeshByNamePattern(group, /^cabinet-drawer-handle-[\d.]+-\d+$/)

    expect(handle.position.y).toBeCloseTo(0, 3)
  })
})

describe('buildCabinetGeometry — inset internals', () => {
  test('inset drawer boxes stay set back behind the front plane', () => {
    const node = CabinetModuleNode.parse({
      frontStyle: 'shaker',
      frontOverlay: 'inset',
      width: 0.6,
      stack: [{ id: 'drawer', type: 'drawer', drawerCount: 3 }],
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)
    const drawerFront = findMeshByNamePrefix(group, 'cabinet-drawer-front-')
    const drawerSide = findMeshByNamePrefix(group, 'cabinet-drawer-side-left-')

    const frontBounds = worldBounds(drawerFront)
    const sideBounds = worldBounds(drawerSide)

    expect(sideBounds.max.z).toBeLessThan(frontBounds.min.z - 0.005)
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

  test('rectangular glass panes stay inside the front frame instead of protruding past it', () => {
    const node = CabinetModuleNode.parse({
      cabinetType: 'tall',
      width: 0.6,
      carcassHeight: 2.07,
      stack: [{ id: 'glass-door', type: 'door', doorType: 'glass', shelfCount: 4 }],
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)
    const frame = findMeshByNamePattern(group, /^cabinet-door-left-[\d.]+-frame-top$/)
    const glass = findMeshByNamePattern(group, /^cabinet-door-left-[\d.]+-glass$/)

    const frameBounds = worldBounds(frame)
    const glassBounds = worldBounds(glass)

    expect(glassBounds.max.z).toBeLessThanOrEqual(frameBounds.max.z)
    expect(glassBounds.min.z).toBeGreaterThanOrEqual(frameBounds.min.z)
  })

  test('raised-arch glass panes stay inside the front frame instead of protruding past it', () => {
    const node = CabinetModuleNode.parse({
      cabinetType: 'tall',
      width: 0.6,
      carcassHeight: 2.07,
      frontStyle: 'raised-arch',
      stack: [{ id: 'glass-door', type: 'door', doorType: 'glass', shelfCount: 4 }],
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)
    const frame = findMeshByNamePattern(group, /^cabinet-door-left-[\d.]+-frame$/)
    const glass = findMeshByNamePattern(group, /^cabinet-door-left-[\d.]+-glass$/)

    const frameBounds = worldBounds(frame)
    const glassBounds = worldBounds(glass)

    expect(glassBounds.max.z).toBeLessThanOrEqual(frameBounds.max.z)
    expect(glassBounds.min.z).toBeGreaterThanOrEqual(frameBounds.min.z)
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

  function hasObjectByName(root: Object3D, name: string): boolean {
    let found = false
    root.traverse((object) => {
      if (object.name === name) found = true
    })
    return found
  }

  test('bakes open clips for cabinet storage and appliance moving parts', () => {
    const cases = [
      {
        name: 'door',
        expectedTrack: '.quaternion',
        stack: [{ id: 'door', type: 'door', doorType: 'double', shelfCount: 2 }],
      },
      {
        name: 'drawer',
        expectedTrack: '.position',
        stack: [{ id: 'drawer', type: 'drawer', drawerCount: 3 }],
      },
      {
        name: 'pull-out-pantry',
        expectedTrack: '.position',
        stack: [{ id: 'pantry', type: 'pull-out-pantry', height: 1.8, shelfCount: 5 }],
      },
      {
        name: 'oven',
        expectedTrack: '.quaternion',
        stack: [{ id: 'oven', type: 'oven', height: 0.595 }],
      },
      {
        name: 'microwave',
        expectedTrack: '.quaternion',
        stack: [{ id: 'micro', type: 'microwave', height: MICROWAVE_STANDARD_HEIGHT }],
      },
      {
        name: 'dishwasher',
        expectedTrack: '.quaternion',
        stack: [{ id: 'dishwasher', type: 'dishwasher', height: DISHWASHER_STANDARD_HEIGHT }],
      },
      {
        name: 'fridge-single',
        expectedTrack: '.quaternion',
        stack: [{ id: 'fridge', type: 'fridge-single', height: FRIDGE_COLUMN_HEIGHT }],
      },
      {
        name: 'fridge-double',
        expectedTrack: '.quaternion',
        stack: [{ id: 'fridge', type: 'fridge-double', height: FRIDGE_COLUMN_HEIGHT }],
      },
      {
        name: 'fridge-top-freezer',
        expectedTrack: '.quaternion',
        stack: [{ id: 'fridge', type: 'fridge-top-freezer', height: FRIDGE_COLUMN_HEIGHT }],
      },
      {
        name: 'fridge-bottom-freezer',
        expectedTrack: '.quaternion',
        stack: [{ id: 'fridge', type: 'fridge-bottom-freezer', height: FRIDGE_COLUMN_HEIGHT }],
      },
    ] as const

    for (const entry of cases) {
      const node = CabinetModuleNode.parse({
        id: `cabinet-module_anim_${entry.name.replaceAll('-', '_')}`,
        width: entry.name.includes('fridge') ? FRIDGE_COLUMN_WIDTH : 0.8,
        carcassHeight: entry.name.includes('fridge') ? TALL_CABINET_CARCASS_HEIGHT : 0.9,
        stack: entry.stack,
      })
      const group = buildCabinetGeometry(node, undefined, 'rendered', false)
      const clip = bakeCabinetAnimationClip(node, group)

      expect(clip?.name).toBe(`${node.id}: open`)
      expect(clip?.duration).toBe(1)
      expect(clip?.userData).toEqual({ loop: false })
      expect(clip!.tracks.length).toBeGreaterThan(0)
      expect(clip!.tracks.some((track) => track.name.endsWith(entry.expectedTrack))).toBe(true)
      for (const track of clip!.tracks) {
        const targetUuid = track.name.slice(0, track.name.lastIndexOf('.'))
        expect(group.getObjectByProperty('uuid', targetUuid)).toBeDefined()
      }
    }
  })

  test('does not bake a cabinet clip when no compartment part moves', () => {
    const node = CabinetModuleNode.parse({
      id: 'cabinet-module_anim_static_sink',
      stack: [{ id: 'sink', type: 'sink' }],
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)

    expect(bakeCabinetAnimationClip(node, group)).toBeNull()
  })

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

    const ventSlats = ['cabinet-microwave-0-top-vent-4', 'cabinet-microwave-0-bottom-vent-0'].map(
      (name) => worldBounds(findMeshByName(group, name)),
    )
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

  test('dishwasher compartment emits tub racks, controls, toe vent, and drop-down door', () => {
    const node = CabinetModuleNode.parse({
      width: DISHWASHER_STANDARD_WIDTH,
      carcassHeight: DISHWASHER_STANDARD_HEIGHT,
      operationState: 1,
      stack: [{ id: 'dishwasher', type: 'dishwasher', height: DISHWASHER_STANDARD_HEIGHT }],
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)

    expect(findMeshByName(group, 'cabinet-dishwasher-0-tub-back')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-dishwasher-0-upper-rack-bar-1')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-dishwasher-0-lower-rack-bar-1')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-dishwasher-0-spray-arm')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-dishwasher-0-control-panel')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-dishwasher-0-display')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-dishwasher-0-display-segment-0')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-dishwasher-0-cycle-button-0')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-dishwasher-0-outer-trim-top')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-dishwasher-0-outer-trim-left')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-dishwasher-0-pocket-handle-lip')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-dishwasher-0-brushed-front-panel')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-dishwasher-0-front-highlight')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-dishwasher-0-front-groove-left')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-dishwasher-0-brushed-line-0')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-dishwasher-0-badge')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-dishwasher-0-detergent-cup')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-dishwasher-0-toe-vent-slat-0')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-dishwasher-0-door-panel').userData.slotId).toBe(
      'appliance',
    )

    const hinge = findObjectByName(group, 'cabinet-dishwasher-0-door-hinge')
    expect(hinge.rotation.x).toBeCloseTo((88 * Math.PI) / 180)
    expect(hinge.rotation.y).toBeCloseTo(0)

    const door = findObjectByName(group, 'cabinet-dishwasher-0-door')
    expect(findObjectByName(group, 'cabinet-dishwasher-0-toe-vent').parent).toBe(door)
    expect(findMeshByName(group, 'cabinet-dishwasher-0-detergent-cup').position.z).toBeLessThan(0)
  })

  test('gas cooktop emits trim, five stepped burners, continuous grate, and knobs', () => {
    const node = CabinetModuleNode.parse({
      width: COOKTOP_STANDARD_WIDTH,
      carcassHeight: 0.72,
      stack: [
        { id: 'drawer', type: 'drawer', drawerCount: 2 },
        { id: 'cooktop', type: 'cooktop-gas', height: COOKTOP_DEFAULT_HEIGHT },
      ],
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)

    expect(findMeshByName(group, 'cabinet-cooktop-gas-1-surface').userData.slotId).toBe('appliance')
    expect(findMeshByName(group, 'cabinet-cooktop-gas-1-frame-front')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-cooktop-gas-1-frame-left')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-cooktop-gas-1-burner-4-base')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-cooktop-gas-1-burner-0-ring')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-cooktop-gas-1-burner-3-cap').userData.slotId).toBe(
      'hardware',
    )
    expect(findMeshByName(group, 'cabinet-cooktop-gas-1-continuous-grate-front')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-cooktop-gas-1-continuous-grate-row-1')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-cooktop-gas-1-continuous-grate-column-1')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-cooktop-gas-1-knob-4')).toBeDefined()
    expect(
      findMeshByName(group, 'cabinet-cooktop-gas-1-knob-4-hit').userData.cabinetCooktopKnob,
    ).toEqual({
      type: 'gas',
      compartmentIndex: 1,
      burnerIndex: 4,
    })
    expect(findMeshByName(group, 'cabinet-cooktop-gas-1-knob-4-notch')).toBeDefined()
  })

  test('gas cooktop can hide the top grate and show individual burner flames', () => {
    const node = CabinetModuleNode.parse({
      width: COOKTOP_STANDARD_WIDTH,
      carcassHeight: 0.72,
      stack: [
        { id: 'drawer', type: 'drawer', drawerCount: 2 },
        {
          id: 'cooktop',
          type: 'cooktop-gas',
          height: COOKTOP_DEFAULT_HEIGHT,
          cooktopActiveBurners: [0],
          cooktopKnobProgress: [1, 0, 0, 0, 0],
          cooktopShowGrate: false,
        },
      ],
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)

    expect(hasObjectByName(group, 'cabinet-cooktop-gas-1-continuous-grate-front')).toBe(false)
    expect(findMeshByName(group, 'cabinet-cooktop-gas-1-burner-0-flame-ring')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-cooktop-gas-1-burner-0-flame-core')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-cooktop-gas-1-burner-0-flame-0')).toBeDefined()
    expect(hasObjectByName(group, 'cabinet-cooktop-gas-1-burner-1-flame-ring')).toBe(false)
    expect(findMeshByName(group, 'cabinet-cooktop-gas-1-knob-0').rotation.y).toBeLessThan(0)
  })

  test('induction cooktop emits ceramic surface, heating zones, and touch controls', () => {
    const node = CabinetModuleNode.parse({
      width: COOKTOP_STANDARD_WIDTH,
      carcassHeight: 0.72,
      stack: [
        { id: 'drawer', type: 'drawer', drawerCount: 2 },
        { id: 'cooktop', type: 'cooktop-induction', height: COOKTOP_DEFAULT_HEIGHT },
      ],
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)

    expect(findMeshByName(group, 'cabinet-cooktop-induction-1-surface').userData.slotId).toBe(
      'appliance',
    )
    expect(findMeshByName(group, 'cabinet-cooktop-induction-1-zone-0-ring-0')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-cooktop-induction-1-zone-0-fill')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-cooktop-induction-1-zone-0-ring-2')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-cooktop-induction-1-zone-3-ring-1')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-cooktop-induction-1-touch-control-bar')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-cooktop-induction-1-touch-dot-4')).toBeDefined()
  })

  test('induction cooktop can show active zone glow', () => {
    const node = CabinetModuleNode.parse({
      width: COOKTOP_STANDARD_WIDTH,
      carcassHeight: 0.72,
      stack: [
        { id: 'drawer', type: 'drawer', drawerCount: 2 },
        {
          id: 'cooktop',
          type: 'cooktop-induction',
          height: COOKTOP_DEFAULT_HEIGHT,
          cooktopBurnersOn: true,
        },
      ],
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)
    const fill = findMeshByName(group, 'cabinet-cooktop-induction-1-zone-0-fill')
    const dot = findMeshByName(group, 'cabinet-cooktop-induction-1-touch-dot-0')

    expect(fill.material).toBe(dot.material)
  })

  test('cooktop seats into the countertop instead of floating above it', () => {
    const node = CabinetModuleNode.parse({
      width: COOKTOP_STANDARD_WIDTH,
      carcassHeight: 0.72,
      withCountertop: true,
      countertopThickness: 0.02,
      stack: [
        { id: 'drawer', type: 'drawer', drawerCount: 2 },
        { id: 'cooktop', type: 'cooktop-gas', height: COOKTOP_DEFAULT_HEIGHT },
      ],
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)
    const surface = worldBounds(findMeshByName(group, 'cabinet-cooktop-gas-1-surface'))
    const countertopTop = node.plinthHeight + node.carcassHeight + node.countertopThickness

    expect(surface.min.y).toBeLessThan(countertopTop)
    expect(surface.max.y).toBeGreaterThan(countertopTop)
  })

  test('cooktop does not reserve a blank front row below the countertop', () => {
    const node = CabinetModuleNode.parse({
      width: COOKTOP_STANDARD_WIDTH,
      carcassHeight: 0.72,
      stack: [
        { id: 'drawer', type: 'drawer', drawerCount: 2 },
        { id: 'cooktop', type: 'cooktop-gas', height: COOKTOP_DEFAULT_HEIGHT },
      ],
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)
    const topDrawer = worldBounds(findMeshByNamePattern(group, /^cabinet-drawer-front-[\d.]+-1$/))
    const topBoardY = node.plinthHeight + node.carcassHeight

    expect(topDrawer.max.y).toBeGreaterThan(topBoardY - 0.04)
    expect(hasObjectByName(group, 'cabinet-back-1')).toBe(false)
  })

  test('pull-out pantry emits a narrow sliding rack with basket shelves', () => {
    const node = CabinetModuleNode.parse({
      cabinetType: 'tall',
      width: PULL_OUT_PANTRY_STANDARD_WIDTH,
      carcassHeight: TALL_CABINET_CARCASS_HEIGHT,
      operationState: 1,
      stack: [
        {
          id: 'pullout',
          type: 'pull-out-pantry',
          height: TALL_CABINET_CARCASS_HEIGHT,
          shelfCount: PULL_OUT_PANTRY_DEFAULT_SHELF_COUNT,
        },
      ],
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)

    const slide = findObjectByName(group, 'cabinet-pull-out-pantry-0-slide')
    expect(slide.userData.cabinetPose.type).toBe('translate')
    expect(slide.userData.cabinetPose.axis).toBe('z')
    expect(slide.userData.cabinetPose.distance).toBeGreaterThan(0)
    expect(slide.position.z).toBeCloseTo(slide.userData.cabinetPose.distance)
    expect(findMeshByName(group, 'cabinet-pull-out-pantry-0-front')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-pull-out-pantry-0-handle')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-pull-out-pantry-0-left-front-upright')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-pull-out-pantry-0-basket-0-front-rail')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-pull-out-pantry-0-basket-4-divider-2')).toBeDefined()
  })

  test('pull-out pantry supports tray and glass rack styles', () => {
    const tray = buildCabinetGeometry(
      CabinetModuleNode.parse({
        cabinetType: 'tall',
        width: PULL_OUT_PANTRY_STANDARD_WIDTH,
        carcassHeight: TALL_CABINET_CARCASS_HEIGHT,
        stack: [
          {
            id: 'pullout',
            type: 'pull-out-pantry',
            height: TALL_CABINET_CARCASS_HEIGHT,
            shelfCount: 3,
            pantryRackStyle: 'tray',
          },
        ],
      }),
      undefined,
      'rendered',
      false,
    )
    const glass = buildCabinetGeometry(
      CabinetModuleNode.parse({
        cabinetType: 'tall',
        width: PULL_OUT_PANTRY_STANDARD_WIDTH,
        carcassHeight: TALL_CABINET_CARCASS_HEIGHT,
        stack: [
          {
            id: 'pullout',
            type: 'pull-out-pantry',
            height: TALL_CABINET_CARCASS_HEIGHT,
            shelfCount: 3,
            pantryRackStyle: 'glass',
          },
        ],
      }),
      undefined,
      'rendered',
      false,
    )

    expect(
      findMeshByName(tray, 'cabinet-pull-out-pantry-0-basket-0-tray-front-panel'),
    ).toBeDefined()
    expect(
      findMeshByName(glass, 'cabinet-pull-out-pantry-0-basket-0-glass-front-panel').userData.slotId,
    ).toBe('glass')
  })

  test('single refrigerator emits steel door, shelves, bins, vents, and an opening hinge', () => {
    const node = CabinetModuleNode.parse({
      cabinetType: 'tall',
      width: FRIDGE_COLUMN_WIDTH,
      depth: FRIDGE_STANDARD_DEPTH,
      carcassHeight: FRIDGE_COLUMN_HEIGHT,
      operationState: 1,
      stack: [{ id: 'fridge', type: 'fridge-single', height: FRIDGE_COLUMN_HEIGHT }],
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)

    const panel = findMeshByName(group, 'cabinet-fridge-single-0-door-single-panel')
    expect(panel.userData.slotId).toBe('appliance')
    expect(findMeshByName(group, 'cabinet-fridge-single-0-appliance-side-left')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-fridge-single-0-appliance-toe-grille')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-fridge-single-0-door-single-badge')).toBeDefined()
    expect(
      findMeshByName(group, 'cabinet-fridge-single-0-door-single-water-dispenser'),
    ).toBeDefined()
    expect(
      findMeshByName(group, 'cabinet-fridge-single-0-door-single-blue-drip-tray'),
    ).toBeDefined()
    expect(findMeshByName(group, 'cabinet-fridge-single-0-single-fresh-shelf-1')).toBeDefined()
    expect(
      findMeshByName(group, 'cabinet-fridge-single-0-single-fresh-shelf-1-front-lip'),
    ).toBeDefined()
    expect(findMeshByName(group, 'cabinet-fridge-single-0-single-left-liner-rib-0')).toBeDefined()
    expect(
      findMeshByName(group, 'cabinet-fridge-single-0-single-rear-diffuser-panel'),
    ).toBeDefined()
    expect(
      findMeshByName(group, 'cabinet-fridge-single-0-single-rear-diffuser-channel-0'),
    ).toBeDefined()
    expect(findMeshByName(group, 'cabinet-fridge-single-0-single-crisper-drawer-0')).toBeDefined()
    expect(
      findMeshByName(group, 'cabinet-fridge-single-0-single-crisper-drawer-0-handle'),
    ).toBeDefined()
    expect(
      findMeshByName(group, 'cabinet-fridge-single-0-single-crisper-drawer-0-humidity-slider'),
    ).toBeDefined()
    expect(findMeshByName(group, 'cabinet-fridge-single-0-single-deli-drawer')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-fridge-single-0-single-control-strip')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-fridge-single-0-vent-0')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-fridge-single-0-door-single-door-bin-0')).toBeDefined()
    expect(
      findMeshByName(group, 'cabinet-fridge-single-0-door-single-door-bin-0-retainer'),
    ).toBeDefined()
    expect(
      findMeshByName(group, 'cabinet-fridge-single-0-door-single-door-dairy-cover'),
    ).toBeDefined()
    expect(
      findMeshByName(group, 'cabinet-fridge-single-0-door-single-door-bin-0-retainer').position.z,
    ).toBeLessThan(
      findMeshByName(group, 'cabinet-fridge-single-0-door-single-door-bin-0-base').position.z,
    )
    expect(
      findMeshByName(group, 'cabinet-fridge-single-0-door-single-door-dairy-cover').position.z,
    ).toBeLessThan(
      findMeshByName(group, 'cabinet-fridge-single-0-door-single-door-dairy-box').position.z,
    )
    const topCap = worldBounds(findMeshByName(group, 'cabinet-fridge-single-0-appliance-top-cap'))
    const cavityTop = worldBounds(findMeshByName(group, 'cabinet-fridge-single-0-cavity-top'))
    const cabinetTop = worldBounds(findMeshByName(group, 'cabinet-top'))
    const leftShell = worldBounds(
      findMeshByName(group, 'cabinet-fridge-single-0-appliance-side-left'),
    )
    const rightShell = worldBounds(
      findMeshByName(group, 'cabinet-fridge-single-0-appliance-side-right'),
    )
    const leftCarcass = worldBounds(findMeshByName(group, 'cabinet-side-left'))
    const rightCarcass = worldBounds(findMeshByName(group, 'cabinet-side-right'))
    expect(topCap.max.y).toBeLessThan(cabinetTop.min.y - 0.01)
    expect(leftShell.min.x).toBeGreaterThan(leftCarcass.max.x + 0.01)
    expect(rightShell.max.x).toBeLessThan(rightCarcass.min.x - 0.01)
    expect(leftShell.max.z).toBeLessThan(leftCarcass.max.z - 0.01)
    expect(rightShell.max.z).toBeLessThan(rightCarcass.max.z - 0.01)
    expect(leftShell.intersectsBox(topCap)).toBe(false)
    expect(rightShell.intersectsBox(topCap)).toBe(false)
    expect(cavityTop.max.y).toBeLessThan(topCap.min.y - 0.001)
    const hinge = findObjectByName(group, 'cabinet-fridge-single-0-door-single-hinge')
    expect(hinge.rotation.y).toBeGreaterThan(1.9)
  })

  test('fridge cabinet fills tall-carcass remainder with a drawer front above the fridge', () => {
    const node = CabinetModuleNode.parse({
      cabinetType: 'tall',
      width: FRIDGE_COLUMN_WIDTH,
      depth: FRIDGE_STANDARD_DEPTH,
      carcassHeight: TALL_CABINET_CARCASS_HEIGHT,
      showPlinth: false,
      stack: fridgeCabinetStack('fridge-single'),
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)

    const fridgePanel = worldBounds(
      findMeshByName(group, 'cabinet-fridge-single-0-door-single-panel'),
    )
    const drawerFront = worldBounds(findMeshByNamePrefix(group, 'cabinet-drawer-front-'))
    const cabinetTop = worldBounds(findMeshByName(group, 'cabinet-top'))

    expect(cabinetTop.max.y).toBeCloseTo(TALL_CABINET_CARCASS_HEIGHT)
    expect(fridgePanel.max.y).toBeLessThan(drawerFront.min.y)
    expect(drawerFront.max.y).toBeCloseTo(TALL_CABINET_CARCASS_HEIGHT)
  })

  test('double refrigerator opens opposing side-by-side leaves', () => {
    const node = CabinetModuleNode.parse({
      cabinetType: 'tall',
      width: FRIDGE_WIDE_WIDTH,
      depth: FRIDGE_STANDARD_DEPTH,
      carcassHeight: FRIDGE_COLUMN_HEIGHT,
      operationState: 1,
      stack: [{ id: 'fridge', type: 'fridge-double', height: FRIDGE_COLUMN_HEIGHT }],
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)

    const left = findObjectByName(group, 'cabinet-fridge-double-0-door-left-hinge')
    const right = findObjectByName(group, 'cabinet-fridge-double-0-door-right-hinge')
    expect(findMeshByName(group, 'cabinet-fridge-double-0-left-ice-maker-box')).toBeDefined()
    expect(
      findMeshByName(group, 'cabinet-fridge-double-0-left-freezer-wire-basket-bar-1'),
    ).toBeDefined()
    expect(findMeshByName(group, 'cabinet-fridge-double-0-right-control-strip')).toBeDefined()
    expect(
      findMeshByName(group, 'cabinet-fridge-double-0-door-left-door-wire-bin-0-wire-1'),
    ).toBeDefined()
    expect(findMeshByName(group, 'cabinet-fridge-double-0-door-right-door-dairy-box')).toBeDefined()
    expect(
      findMeshByName(group, 'cabinet-fridge-double-0-door-right-door-bottle-bin'),
    ).toBeDefined()
    expect(
      findMeshByName(group, 'cabinet-fridge-double-0-door-left-door-wire-bin-0-top-rail').position
        .z,
    ).toBeLessThan(
      findMeshByName(group, 'cabinet-fridge-double-0-door-left-door-wire-bin-0-base-rail').position
        .z,
    )
    expect(
      findMeshByName(group, 'cabinet-fridge-double-0-door-right-door-bottle-bin-retainer').position
        .z,
    ).toBeLessThan(
      findMeshByName(group, 'cabinet-fridge-double-0-door-right-door-bottle-bin-base').position.z,
    )
    expect(left.rotation.y).toBeLessThan(-1.9)
    expect(right.rotation.y).toBeGreaterThan(1.9)
  })

  test('top and bottom freezer refrigerators create separate upper and lower doors', () => {
    const topFreezer = CabinetModuleNode.parse({
      cabinetType: 'tall',
      width: FRIDGE_COLUMN_WIDTH,
      depth: FRIDGE_STANDARD_DEPTH,
      carcassHeight: FRIDGE_COLUMN_HEIGHT,
      stack: [{ id: 'fridge', type: 'fridge-top-freezer', height: FRIDGE_COLUMN_HEIGHT }],
    })
    const bottomFreezer = CabinetModuleNode.parse({
      cabinetType: 'tall',
      width: FRIDGE_COLUMN_WIDTH,
      depth: FRIDGE_STANDARD_DEPTH,
      carcassHeight: FRIDGE_COLUMN_HEIGHT,
      stack: [{ id: 'fridge', type: 'fridge-bottom-freezer', height: FRIDGE_COLUMN_HEIGHT }],
    })

    expect(
      findMeshByName(
        buildCabinetGeometry(topFreezer, undefined, 'rendered', false),
        'cabinet-fridge-top-freezer-0-door-freezer-panel',
      ),
    ).toBeDefined()
    const bottomGroup = buildCabinetGeometry(bottomFreezer, undefined, 'rendered', false)
    expect(
      findMeshByName(bottomGroup, 'cabinet-fridge-bottom-freezer-0-door-freezer-panel'),
    ).toBeDefined()
    expect(
      findMeshByName(bottomGroup, 'cabinet-fridge-bottom-freezer-0-freezer-freezer-basket'),
    ).toBeDefined()
    expect(
      findMeshByName(
        bottomGroup,
        'cabinet-fridge-bottom-freezer-0-freezer-freezer-wire-basket-bar-1',
      ),
    ).toBeDefined()
    expect(
      findMeshByName(bottomGroup, 'cabinet-fridge-bottom-freezer-0-horizontal-divider'),
    ).toBeDefined()
  })

  test('top and bottom freezer refrigerator doors use the same hinge direction', () => {
    const topFreezer = buildCabinetGeometry(
      CabinetModuleNode.parse({
        cabinetType: 'tall',
        width: FRIDGE_COLUMN_WIDTH,
        depth: FRIDGE_STANDARD_DEPTH,
        carcassHeight: FRIDGE_COLUMN_HEIGHT,
        operationState: 1,
        stack: [{ id: 'fridge', type: 'fridge-top-freezer', height: FRIDGE_COLUMN_HEIGHT }],
      }),
      undefined,
      'rendered',
      false,
    )
    const bottomFreezer = buildCabinetGeometry(
      CabinetModuleNode.parse({
        cabinetType: 'tall',
        width: FRIDGE_COLUMN_WIDTH,
        depth: FRIDGE_STANDARD_DEPTH,
        carcassHeight: FRIDGE_COLUMN_HEIGHT,
        operationState: 1,
        stack: [{ id: 'fridge', type: 'fridge-bottom-freezer', height: FRIDGE_COLUMN_HEIGHT }],
      }),
      undefined,
      'rendered',
      false,
    )

    expect(
      findObjectByName(topFreezer, 'cabinet-fridge-top-freezer-0-door-freezer-hinge').rotation.y,
    ).toBeGreaterThan(0)
    expect(
      findObjectByName(topFreezer, 'cabinet-fridge-top-freezer-0-door-fresh-hinge').rotation.y,
    ).toBeGreaterThan(0)
    expect(
      findObjectByName(bottomFreezer, 'cabinet-fridge-bottom-freezer-0-door-freezer-hinge').rotation
        .y,
    ).toBeGreaterThan(0)
    expect(
      findObjectByName(bottomFreezer, 'cabinet-fridge-bottom-freezer-0-door-fresh-hinge').rotation
        .y,
    ).toBeGreaterThan(0)
  })
})

describe('buildCabinetGeometry — run countertops', () => {
  test('empty cabinet runs render no fallback cabinet mesh', () => {
    const run = CabinetNode.parse({
      ...cabinetDefinition.defaults(),
      id: 'cabinet_empty-run',
      children: [],
    })

    const group = buildCabinetGeometry(run, geometryContext({ children: [] }), 'rendered', false)

    expect(group.children).toHaveLength(0)
  })

  test('run plinth follows shifted module depth extents instead of growing backward', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_mixed-depth-run',
      showPlinth: true,
      plinthHeight: 0.1,
      toeKickDepth: 0.075,
      boardThickness: 0.018,
    })
    const standardDepth = 0.58
    const fridgeZ = backAnchoredModuleZ(0, standardDepth, FRIDGE_STANDARD_DEPTH)
    const modules = [
      CabinetModuleNode.parse({
        id: 'cabinet-module_tall',
        parentId: run.id,
        cabinetType: 'tall',
        position: [-0.3, 0.1, 0],
        width: 0.6,
        depth: standardDepth,
        carcassHeight: FRIDGE_COLUMN_HEIGHT,
      }),
      CabinetModuleNode.parse({
        id: 'cabinet-module_fridge',
        parentId: run.id,
        cabinetType: 'tall',
        position: [0.38, 0.1, fridgeZ],
        width: FRIDGE_COLUMN_WIDTH,
        depth: FRIDGE_STANDARD_DEPTH,
        carcassHeight: FRIDGE_COLUMN_HEIGHT,
      }),
    ]

    const group = buildCabinetGeometry(
      run,
      geometryContext({ children: modules }),
      'rendered',
      false,
    )
    const plinth = worldBounds(findMeshByName(group, 'cabinet-run-plinth'))

    expect(plinth.min.z).toBeCloseTo(-standardDepth / 2)
    expect(plinth.max.z).toBeCloseTo(fridgeZ + FRIDGE_STANDARD_DEPTH / 2 - run.toeKickDepth)
  })

  test('run countertop follows shifted module depth extents instead of staying centered', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_shifted-depth-countertop',
      withCountertop: true,
      countertopThickness: 0.02,
      countertopOverhang: 0.02,
    })
    const standardDepth = 0.58
    const nextDepth = 0.78
    const shiftedZ = backAnchoredModuleZ(0, standardDepth, nextDepth)
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_base',
      parentId: run.id,
      cabinetType: 'base',
      position: [0, 0.1, shiftedZ],
      width: 0.6,
      depth: nextDepth,
      carcassHeight: 0.72,
    })

    const group = buildCabinetGeometry(
      run,
      geometryContext({ children: [module] }),
      'rendered',
      false,
    )
    const [countertop] = countertopBounds(group)

    expect(countertop).toBeDefined()
    expect(countertop!.minZ).toBeCloseTo(-standardDepth / 2)
    expect(countertop!.maxZ).toBeCloseTo(shiftedZ + nextDepth / 2 + run.countertopOverhang)
  })

  test('island back overhang extends the slab backward and adds a finished back panel', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_island-run',
      withCountertop: true,
      countertopThickness: 0.02,
      countertopOverhang: 0.02,
      countertopBackOverhang: 0.3,
      withFinishedBack: true,
      boardThickness: 0.018,
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_island-base',
      parentId: run.id,
      cabinetType: 'base',
      position: [0, 0.1, 0],
      width: 0.6,
      depth: 0.58,
      carcassHeight: 0.72,
    })

    const group = buildCabinetGeometry(
      run,
      geometryContext({ children: [module] }),
      'rendered',
      false,
    )

    const [countertop] = countertopBounds(group)
    expect(countertop).toBeDefined()
    expect(countertop!.minZ).toBeCloseTo(-0.58 / 2 - run.countertopBackOverhang)
    expect(countertop!.maxZ).toBeCloseTo(0.58 / 2 + run.countertopOverhang)

    const backPanel = worldBounds(findMeshByName(group, 'cabinet-run-back-panel'))
    expect(backPanel.max.z).toBeCloseTo(-0.58 / 2)
    expect(backPanel.min.z).toBeCloseTo(-0.58 / 2 - run.boardThickness)
    expect(backPanel.min.y).toBeCloseTo(0)
    expect(backPanel.max.y).toBeCloseTo(0.1 + 0.72)
  })

  test('bar ledge adds a knee wall and raised slab behind the run', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_bar-run',
      withCountertop: true,
      countertopThickness: 0.02,
      countertopOverhang: 0.02,
      countertopBackOverhang: 0.3,
      barLedge: { height: 1.06, depth: 0.35 },
      boardThickness: 0.018,
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_bar-base',
      parentId: run.id,
      cabinetType: 'base',
      position: [0, 0.1, 0],
      width: 0.6,
      depth: 0.58,
      carcassHeight: 0.72,
    })

    const group = buildCabinetGeometry(
      run,
      geometryContext({ children: [module] }),
      'rendered',
      false,
    )

    // The bar supersedes the seating overhang: the base slab stays at the
    // carcass back edge.
    const slabs = countertopBounds(group)
    expect(slabs).toHaveLength(2)
    const baseSlab = slabs.find(
      (slab) => Math.abs(slab.maxZ - (0.58 / 2 + run.countertopOverhang)) < 1e-6,
    )
    expect(baseSlab).toBeDefined()
    expect(baseSlab!.minZ).toBeCloseTo(-0.58 / 2)

    const support = worldBounds(findMeshByName(group, 'cabinet-run-bar-support'))
    expect(support.max.z).toBeCloseTo(-0.58 / 2)
    expect(support.max.y).toBeCloseTo(1.06 - run.countertopThickness)

    const barSlab = worldBounds(findMeshByName(group, 'cabinet-run-bar-slab'))
    expect(barSlab.max.y).toBeCloseTo(1.06)
    expect(barSlab.max.z).toBeCloseTo(-0.58 / 2)
    expect(barSlab.min.z).toBeCloseTo(-0.58 / 2 - 0.35)
  })

  test('right-edge bar ledge hangs off the run end and keeps the seating overhang', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_side-bar-run',
      withCountertop: true,
      countertopThickness: 0.02,
      countertopOverhang: 0.02,
      countertopBackOverhang: 0.3,
      barLedge: { edge: 'right', height: 1.06, depth: 0.35 },
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_side-bar-base',
      parentId: run.id,
      cabinetType: 'base',
      position: [0, 0.1, 0],
      width: 0.6,
      depth: 0.58,
      carcassHeight: 0.72,
    })

    const group = buildCabinetGeometry(
      run,
      geometryContext({ children: [module] }),
      'rendered',
      false,
    )

    // Side bar leaves the back seating overhang intact.
    const slabs = countertopBounds(group)
    const baseSlab = slabs.find((slab) => Math.abs(slab.minX - (-0.3 - 0.02)) < 1e-6)
    expect(baseSlab).toBeDefined()
    expect(baseSlab!.minZ).toBeCloseTo(-0.58 / 2 - 0.3)
    // No side overhang on the bar edge — slab ends at the carcass.
    expect(baseSlab!.maxX).toBeCloseTo(0.3)

    const support = worldBounds(findMeshByName(group, 'cabinet-run-bar-support'))
    expect(support.min.x).toBeCloseTo(0.3)
    expect(support.max.y).toBeCloseTo(1.06 - run.countertopThickness)

    const barSlab = worldBounds(findMeshByName(group, 'cabinet-run-bar-slab'))
    expect(barSlab.min.x).toBeCloseTo(0.3)
    expect(barSlab.max.x).toBeCloseTo(0.3 + 0.35)
    expect(barSlab.max.y).toBeCloseTo(1.06)
  })

  test('waterfall ends drop slab panels to the floor on exposed run ends', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_waterfall-run',
      withCountertop: true,
      countertopThickness: 0.02,
      countertopOverhang: 0.02,
      withWaterfall: true,
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_waterfall-base',
      parentId: run.id,
      cabinetType: 'base',
      position: [0, 0.1, 0],
      width: 0.6,
      depth: 0.58,
      carcassHeight: 0.72,
    })

    const group = buildCabinetGeometry(
      run,
      geometryContext({ children: [module] }),
      'rendered',
      false,
    )

    const left = worldBounds(findMeshByName(group, 'cabinet-run-waterfall-left'))
    const right = worldBounds(findMeshByName(group, 'cabinet-run-waterfall-right'))
    // Outer faces flush with the slab overhang edges, floor to slab underside.
    expect(left.min.x).toBeCloseTo(-0.3 - run.countertopOverhang)
    expect(right.max.x).toBeCloseTo(0.3 + run.countertopOverhang)
    expect(left.min.y).toBeCloseTo(0)
    expect(left.max.y).toBeCloseTo(0.1 + 0.72)
  })

  test('countertop UVs stay world-scaled when cabinet dimensions change', () => {
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_uv-countertop',
      withCountertop: true,
      countertopThickness: 0.02,
      countertopOverhang: 0.04,
      width: 1.4,
      depth: 0.72,
      carcassHeight: 0.72,
    })

    const group = buildCabinetGeometry(module, undefined, 'rendered', true)
    const countertop = findMeshByName(group, 'cabinet-countertop')
    const span = boxTopUvSpan(countertop)

    expect(span.u).toBeCloseTo(module.width + module.countertopOverhang * 2)
    expect(span.v).toBeCloseTo(module.depth + module.countertopOverhang)
  })

  test('drawer front UVs stay world-scaled when cabinet dimensions change', () => {
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_uv-drawers',
      width: 1.25,
      depth: 0.62,
      carcassHeight: 0.84,
      frontGap: 0.006,
      stack: [{ id: 'drawers', type: 'drawer', drawerCount: 3 }],
    })

    const group = buildCabinetGeometry(module, undefined, 'rendered', true)
    const drawerFront = findMeshByNamePrefix(group, 'cabinet-drawer-front-')
    const span = boxFrontUvSpan(drawerFront)
    const expectedWidth = module.width - 3 * module.frontGap
    const usableHeight = module.carcassHeight - 2 * module.frontGap
    const expectedHeight = (usableHeight - 2 * module.frontGap) / 3

    expect(span.u).toBeCloseTo(expectedWidth)
    expect(span.v).toBeCloseTo(expectedHeight)
  })

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

  test('corner-derived base leg keeps the inner corner countertop edge flush on right turns', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_corner-base-leg-right',
      runTier: 'base',
      withCountertop: true,
      countertopThickness: 0.02,
      countertopOverhang: 0.02,
      metadata: {
        cabinetCornerDerivedRun: {
          role: 'base-leg',
          side: 'right',
          sourceModuleId: 'cabinet-module_source',
          sourceRunId: 'cabinet_source-run',
        },
      },
    })
    const filler = CabinetModuleNode.parse({
      id: 'cabinet-module_corner-filler-right',
      parentId: run.id,
      moduleKind: 'corner-filler',
      openSide: 'right',
      cornerShelf: true,
      position: [0, 0.1, 0],
      width: 0.58,
      depth: 0.58,
      carcassHeight: 0.72,
    })
    const base = CabinetModuleNode.parse({
      id: 'cabinet-module_corner-base-right',
      parentId: run.id,
      position: [0.59, 0.1, 0],
      width: 0.6,
      depth: 0.58,
      carcassHeight: 0.72,
    })

    const group = buildCabinetGeometry(
      run,
      geometryContext({ children: [filler, base] }),
      'rendered',
      false,
    )

    const [countertop] = countertopBounds(group)
    expect(countertop).toBeDefined()
    expect(countertop!.minX).toBeCloseTo(-0.29)
    expect(countertop!.maxX).toBeCloseTo(0.89 + run.countertopOverhang)
  })

  test('corner-derived base leg keeps the inner corner countertop edge flush on left turns', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_corner-base-leg-left',
      runTier: 'base',
      withCountertop: true,
      countertopThickness: 0.02,
      countertopOverhang: 0.02,
      metadata: {
        cabinetCornerDerivedRun: {
          role: 'base-leg',
          side: 'left',
          sourceModuleId: 'cabinet-module_source',
          sourceRunId: 'cabinet_source-run',
        },
      },
    })
    const base = CabinetModuleNode.parse({
      id: 'cabinet-module_corner-base-left',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.6,
      depth: 0.58,
      carcassHeight: 0.72,
    })
    const filler = CabinetModuleNode.parse({
      id: 'cabinet-module_corner-filler-left',
      parentId: run.id,
      moduleKind: 'corner-filler',
      openSide: 'left',
      cornerShelf: true,
      position: [0.59, 0.1, 0],
      width: 0.58,
      depth: 0.58,
      carcassHeight: 0.72,
    })

    const group = buildCabinetGeometry(
      run,
      geometryContext({ children: [base, filler] }),
      'rendered',
      false,
    )

    const [countertop] = countertopBounds(group)
    expect(countertop).toBeDefined()
    expect(countertop!.minX).toBeCloseTo(-0.3 - run.countertopOverhang)
    expect(countertop!.maxX).toBeCloseTo(0.88)
  })

  test('corner-filler top pulls back slightly from its open side to avoid coplanar wall-top overlap', () => {
    const rightOpen = CabinetModuleNode.parse({
      id: 'cabinet-module_corner-filler-top-open-right',
      moduleKind: 'corner-filler',
      openSide: 'right',
      position: [0, 0.1, 0],
      width: 0.58,
      depth: 0.32,
      carcassHeight: 0.72,
      boardThickness: 0.018,
    })
    const leftOpen = CabinetModuleNode.parse({
      id: 'cabinet-module_corner-filler-top-open-left',
      moduleKind: 'corner-filler',
      openSide: 'left',
      position: [0, 0.1, 0],
      width: 0.58,
      depth: 0.32,
      carcassHeight: 0.72,
      boardThickness: 0.018,
    })

    const rightGroup = buildCabinetGeometry(rightOpen, undefined, 'rendered', false)
    const leftGroup = buildCabinetGeometry(leftOpen, undefined, 'rendered', false)

    const rightTop = worldBounds(findMeshByName(rightGroup, 'cabinet-corner-filler-top'))
    const leftTop = worldBounds(findMeshByName(leftGroup, 'cabinet-corner-filler-top'))

    expect(rightTop.max.x).toBeLessThan(0.58 / 2)
    expect(leftTop.min.x).toBeGreaterThan(-0.58 / 2)
  })

  test('generated wall bridge and corner wall fillers do not keep coplanar internal side panels', () => {
    const levelId = 'level_corner-wall-filler-side-gap' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_source-run-wall-filler-side-gap',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      children: [
        'cabinet-module_left-wall-filler-side-gap',
        'cabinet-module_center-wall-filler-side-gap',
        'cabinet-module_right-wall-filler-side-gap',
      ],
    })
    const left = CabinetModuleNode.parse({
      id: 'cabinet-module_left-wall-filler-side-gap',
      parentId: run.id,
      position: [-0.75, 0.1, 0],
      width: 0.6,
      depth: 0.58,
      carcassHeight: 0.72,
    })
    const center = CabinetModuleNode.parse({
      id: 'cabinet-module_center-wall-filler-side-gap',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      children: ['cabinet-module_center-wall-wall-filler-side-gap'],
    })
    const right = CabinetModuleNode.parse({
      id: 'cabinet-module_right-wall-filler-side-gap',
      parentId: run.id,
      position: [0.75, 0.1, 0],
      width: 0.6,
      depth: 0.58,
      carcassHeight: 0.72,
    })
    const centerWall = CabinetModuleNode.parse({
      id: 'cabinet-module_center-wall-wall-filler-side-gap',
      parentId: center.id,
      name: 'Wall Cabinet',
      position: [0, wallBottomHeightForTallAlignment() - center.position[1], -0.13],
      width: 0.9,
      depth: 0.32,
      carcassHeight: 0.72,
    })
    const sceneApi = sceneApiFixture([
      run as AnyNode,
      left as AnyNode,
      center as AnyNode,
      right as AnyNode,
      centerWall as AnyNode,
    ])

    addCornerRun({
      module: right,
      run,
      sceneApi,
      side: 'right',
    })

    const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
    const bridge = Object.values(nodes).find(
      (node): node is CabinetModuleNode =>
        node.type === 'cabinet-module' && node.name === 'Wall Bridge Filler',
    )
    const corner = Object.values(nodes).find(
      (node): node is CabinetModuleNode =>
        node.type === 'cabinet-module' && node.name === 'Corner Wall Filler',
    )

    expect(bridge).toBeTruthy()
    expect(corner).toBeTruthy()

    const bridgePose = resolveCabinetWorldTransform(bridge!, nodes)
    const cornerPose = resolveCabinetWorldTransform(corner!, nodes)

    const bridgeGroup = buildCabinetGeometry(
      bridge!,
      {
        children: [],
        parent: nodes[bridge!.parentId as AnyNodeId] as GeometryContext['parent'],
        resolve: () => undefined as never,
        siblings: [],
      },
      'rendered',
      false,
    )
    bridgeGroup.position.set(...bridgePose.position)
    bridgeGroup.rotation.y = bridgePose.rotation
    bridgeGroup.updateMatrixWorld(true)

    const cornerGroup = buildCabinetGeometry(
      corner!,
      {
        children: [],
        parent: nodes[corner!.parentId as AnyNodeId] as GeometryContext['parent'],
        resolve: () => undefined as never,
        siblings: [],
      },
      'rendered',
      false,
    )
    cornerGroup.position.set(...cornerPose.position)
    cornerGroup.rotation.y = cornerPose.rotation
    cornerGroup.updateMatrixWorld(true)

    const bridgeSide = worldBounds(findMeshByName(bridgeGroup, 'cabinet-corner-filler-side-right'))
    const cornerSide = worldBounds(findMeshByName(cornerGroup, 'cabinet-corner-filler-side-left'))

    expect(bridgeSide.max.x).toBeLessThan(cornerSide.min.x)
  })

  test('generated wall bridge and corner wall filler fronts pull back from the shared corner', () => {
    const levelId = 'level_corner-wall-filler-front-gap' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_source-run-wall-filler-front-gap',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      children: [
        'cabinet-module_left-wall-filler-front-gap',
        'cabinet-module_center-wall-filler-front-gap',
        'cabinet-module_right-wall-filler-front-gap',
      ],
    })
    const left = CabinetModuleNode.parse({
      id: 'cabinet-module_left-wall-filler-front-gap',
      parentId: run.id,
      position: [-0.75, 0.1, 0],
      width: 0.6,
      depth: 0.58,
      carcassHeight: 0.72,
    })
    const center = CabinetModuleNode.parse({
      id: 'cabinet-module_center-wall-filler-front-gap',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      children: ['cabinet-module_center-wall-wall-filler-front-gap'],
    })
    const right = CabinetModuleNode.parse({
      id: 'cabinet-module_right-wall-filler-front-gap',
      parentId: run.id,
      position: [0.75, 0.1, 0],
      width: 0.6,
      depth: 0.58,
      carcassHeight: 0.72,
    })
    const centerWall = CabinetModuleNode.parse({
      id: 'cabinet-module_center-wall-wall-filler-front-gap',
      parentId: center.id,
      name: 'Wall Cabinet',
      position: [0, wallBottomHeightForTallAlignment() - center.position[1], -0.13],
      width: 0.9,
      depth: 0.32,
      carcassHeight: 0.72,
    })
    const sceneApi = sceneApiFixture([
      run as AnyNode,
      left as AnyNode,
      center as AnyNode,
      right as AnyNode,
      centerWall as AnyNode,
    ])

    addCornerRun({
      module: right,
      run,
      sceneApi,
      side: 'right',
    })

    const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
    const bridge = Object.values(nodes).find(
      (node): node is CabinetModuleNode =>
        node.type === 'cabinet-module' && node.name === 'Wall Bridge Filler',
    )
    const corner = Object.values(nodes).find(
      (node): node is CabinetModuleNode =>
        node.type === 'cabinet-module' && node.name === 'Corner Wall Filler',
    )

    expect(bridge).toBeTruthy()
    expect(corner).toBeTruthy()

    const bridgePose = resolveCabinetWorldTransform(bridge!, nodes)
    const cornerPose = resolveCabinetWorldTransform(corner!, nodes)

    const bridgeGroup = buildCabinetGeometry(
      bridge!,
      {
        children: [],
        parent: nodes[bridge!.parentId as AnyNodeId] as GeometryContext['parent'],
        resolve: () => undefined as never,
        siblings: [],
      },
      'rendered',
      false,
    )
    bridgeGroup.position.set(...bridgePose.position)
    bridgeGroup.rotation.y = bridgePose.rotation
    bridgeGroup.updateMatrixWorld(true)

    const cornerGroup = buildCabinetGeometry(
      corner!,
      {
        children: [],
        parent: nodes[corner!.parentId as AnyNodeId] as GeometryContext['parent'],
        resolve: () => undefined as never,
        siblings: [],
      },
      'rendered',
      false,
    )
    cornerGroup.position.set(...cornerPose.position)
    cornerGroup.rotation.y = cornerPose.rotation
    cornerGroup.updateMatrixWorld(true)

    const bridgeFront = worldBounds(findMeshByName(bridgeGroup, 'cabinet-corner-filler-front'))
    const cornerFront = worldBounds(findMeshByName(cornerGroup, 'cabinet-corner-filler-front'))

    expect(bridgeFront.max.x).toBeLessThan(cornerFront.min.x)
    expect(bridgeFront.max.y).toBeLessThanOrEqual(cornerFront.max.y)
  })

  test('source run trims its right countertop overhang when a right L-leg is attached', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_source-run-right-leg',
      runTier: 'base',
      withCountertop: true,
      countertopThickness: 0.02,
      countertopOverhang: 0.02,
      children: ['cabinet-module_source-left', 'cabinet-module_source-right'] as AnyNodeId[],
    })
    const left = CabinetModuleNode.parse({
      id: 'cabinet-module_source-left',
      parentId: run.id,
      position: [-0.3, 0.1, 0],
      width: 0.6,
      depth: 0.58,
      carcassHeight: 0.72,
    })
    const right = CabinetModuleNode.parse({
      id: 'cabinet-module_source-right',
      parentId: run.id,
      position: [0.3, 0.1, 0],
      width: 0.6,
      depth: 0.58,
      carcassHeight: 0.72,
    })
    const rightLeg = CabinetNode.parse({
      id: 'cabinet_child-right-leg',
      parentId: run.id,
      runTier: 'base',
      position: [0.6, 0, 0],
      rotation: -Math.PI / 2,
      metadata: {
        cabinetCornerDerivedRun: {
          role: 'base-leg',
          side: 'right',
          sourceModuleId: right.id,
          sourceRunId: run.id,
        },
      },
    })

    const group = buildCabinetGeometry(
      run,
      geometryContext({ children: [left, right, rightLeg] }),
      'rendered',
      false,
    )

    const [countertop] = countertopBounds(group)
    expect(countertop).toBeDefined()
    expect(countertop!.minX).toBeCloseTo(-0.6 - run.countertopOverhang)
    expect(countertop!.maxX).toBeCloseTo(0.6)
  })

  test('source run trims its left countertop overhang when a left L-leg is attached', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_source-run-left-leg',
      runTier: 'base',
      withCountertop: true,
      countertopThickness: 0.02,
      countertopOverhang: 0.02,
      children: ['cabinet-module_source-left', 'cabinet-module_source-right'] as AnyNodeId[],
    })
    const left = CabinetModuleNode.parse({
      id: 'cabinet-module_source-left',
      parentId: run.id,
      position: [-0.3, 0.1, 0],
      width: 0.6,
      depth: 0.58,
      carcassHeight: 0.72,
    })
    const right = CabinetModuleNode.parse({
      id: 'cabinet-module_source-right',
      parentId: run.id,
      position: [0.3, 0.1, 0],
      width: 0.6,
      depth: 0.58,
      carcassHeight: 0.72,
    })
    const leftLeg = CabinetNode.parse({
      id: 'cabinet_child-left-leg',
      parentId: run.id,
      runTier: 'base',
      position: [-0.6, 0, 0],
      rotation: Math.PI / 2,
      metadata: {
        cabinetCornerDerivedRun: {
          role: 'base-leg',
          side: 'left',
          sourceModuleId: left.id,
          sourceRunId: run.id,
        },
      },
    })

    const group = buildCabinetGeometry(
      run,
      geometryContext({ children: [leftLeg, left, right] }),
      'rendered',
      false,
    )

    const [countertop] = countertopBounds(group)
    expect(countertop).toBeDefined()
    expect(countertop!.minX).toBeCloseTo(-0.6)
    expect(countertop!.maxX).toBeCloseTo(0.6 + run.countertopOverhang)
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

describe('cabinet handles', () => {
  function localPointToWorld(
    node: { position: [number, number, number]; rotation?: number },
    point: readonly [number, number, number],
  ) {
    const rotation = node.rotation ?? 0
    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)
    return [
      node.position[0] + point[0] * cos + point[2] * sin,
      node.position[1] + point[1],
      node.position[2] - point[0] * sin + point[2] * cos,
    ] as const
  }

  function linearHandles() {
    const node = CabinetModuleNode.parse({
      position: [0, 0.1, 0],
      width: 0.6,
      depth: 0.58,
    })
    const handles =
      typeof cabinetModuleDefinition.handles === 'function'
        ? cabinetModuleDefinition.handles(node)
        : (cabinetModuleDefinition.handles ?? [])
    return {
      node,
      handles: handles.filter(
        (handle): handle is LinearResizeHandle<typeof node> => handle.kind === 'linear-resize',
      ),
    }
  }

  function generatedL(side: 'left' | 'right') {
    const run = CabinetNode.parse({
      id: `cabinet_handle-source-${side}`,
      parentId: `level_handle-source-${side}`,
      position: [0, 0, 0],
      depth: 0.58,
      children: [`cabinet-module_handle-source-${side}`],
    })
    const sourceModule = CabinetModuleNode.parse({
      id: `cabinet-module_handle-source-${side}`,
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
    })
    const sceneApi = sceneApiFixture([run as AnyNode, sourceModule as AnyNode])
    const selectedId = addCornerRun({ module: sourceModule, run, sceneApi, side })!
    const selectedModule = sceneApi.get(selectedId) as CabinetModuleNode
    const leg = sceneApi.get(selectedModule.parentId as AnyNodeId) as CabinetNode
    const source = sceneApi.get(run.id as AnyNodeId) as CabinetNode
    const liveSourceModule = sceneApi.get(sourceModule.id as AnyNodeId) as CabinetModuleNode
    const legModule = leg.children
      .map((id) => sceneApi.get(id as AnyNodeId))
      .find((node): node is CabinetModuleNode => node?.type === 'cabinet-module')!
    const handles =
      typeof cabinetDefinition.handles === 'function'
        ? cabinetDefinition.handles(source, sceneApi as never)
        : (cabinetDefinition.handles ?? [])
    const depthHandles = handles.filter(
      (handle): handle is LinearResizeHandle<typeof source> =>
        handle.kind === 'linear-resize' && handle.visible?.(source, sceneApi as never) !== false,
    )
    return {
      depthHandles,
      leg,
      legModule,
      sceneApi,
      selectedModule,
      source,
      sourceModule: liveSourceModule,
    }
  }

  function generatedU(side: 'left' | 'right') {
    const fixture = generatedL(side)
    const thirdSelectedId = addCornerRun({
      module: fixture.selectedModule,
      run: fixture.leg,
      sceneApi: fixture.sceneApi,
      side,
    })!
    const thirdSelectedModule = fixture.sceneApi.get(thirdSelectedId) as CabinetModuleNode
    const thirdRun = fixture.sceneApi.get(thirdSelectedModule.parentId as AnyNodeId) as CabinetNode
    const source = fixture.sceneApi.get(fixture.source.id as AnyNodeId) as CabinetNode
    const buildHandles = cabinetDefinition.handles as (
      node: CabinetNode,
      sceneApi: ReturnType<typeof sceneApiFixture>,
    ) => HandleDescriptor<CabinetNode>[]
    const depthHandles = buildHandles(source, fixture.sceneApi).filter(
      (handle): handle is LinearResizeHandle<CabinetNode> =>
        handle.kind === 'linear-resize' &&
        handle.visible?.(source, fixture.sceneApi as never) !== false,
    )
    return { ...fixture, depthHandles, source, thirdRun }
  }

  test('width arrows resize from the chosen side instead of around center', () => {
    const { node, handles } = linearHandles()
    const leftHandle = handles.find((handle) => handle.axis === 'x' && handle.anchor === 'max')
    const rightHandle = handles.find((handle) => handle.axis === 'x' && handle.anchor === 'min')

    expect(leftHandle).toBeDefined()
    expect(rightHandle).toBeDefined()
    expect(leftHandle!.apply(node, 0.8, null as never).position?.[0]).toBeCloseTo(-0.1)
    expect(rightHandle!.apply(node, 0.8, null as never).position?.[0]).toBeCloseTo(0.1)
  })

  test('depth arrow keeps the back aligned and grows toward the front', () => {
    const { node, handles } = linearHandles()
    const depthHandle = handles.find((handle) => handle.axis === 'z')

    expect(depthHandle).toBeDefined()
    expect(depthHandle!.anchor).toBe('min')
    expect(depthHandle!.apply(node, 0.78, null as never).position?.[2]).toBeCloseTo(0.1)
  })

  test.each([
    ['left', -Math.PI / 2],
    ['right', Math.PI / 2],
  ] as const)('L %s groups expose a depth arrow on both inside fronts', (_side, legRotation) => {
    const sourceModule = CabinetModuleNode.parse({
      id: `cabinet-module_source-${_side}`,
      parentId: `cabinet_source-${_side}`,
      position: [0, 0.1, 0],
      depth: 0.58,
    })
    const legModule = CabinetModuleNode.parse({
      id: `cabinet-module_leg-${_side}`,
      parentId: `cabinet_leg-${_side}`,
      position: [0, 0.1, 0],
      depth: 0.58,
    })
    const leg = CabinetNode.parse({
      id: `cabinet_leg-${_side}`,
      parentId: `cabinet_source-${_side}`,
      position: [legRotation < 0 ? -0.6 : 0.6, 0, 0.3],
      rotation: legRotation,
      depth: 0.58,
      children: [legModule.id],
      metadata: {
        cabinetCornerDerivedRun: {
          role: 'base-leg',
          side: _side,
          turnSide: _side,
          sourceModuleId: sourceModule.id,
          sourceRunId: `cabinet_source-${_side}`,
        },
      },
    })
    const run = {
      ...CabinetNode.parse({
        id: `cabinet_source-${_side}`,
        position: [0, 0, 0],
        depth: 0.58,
        children: [sourceModule.id],
      }),
      children: [sourceModule.id, leg.id],
    } as CabinetNode
    const nodes = Object.fromEntries(
      [run, sourceModule, leg, legModule].map((node) => [node.id as AnyNodeId, node as AnyNode]),
    ) as Record<AnyNodeId, AnyNode>
    const sceneApi = {
      get: (id: AnyNodeId) => nodes[id],
      nodes: () => nodes,
    }
    const handles =
      typeof cabinetDefinition.handles === 'function'
        ? cabinetDefinition.handles(run, sceneApi as never)
        : (cabinetDefinition.handles ?? [])
    const depthHandles = handles.filter(
      (handle): handle is LinearResizeHandle<typeof run> =>
        handle.kind === 'linear-resize' && handle.visible?.(run, sceneApi as never) !== false,
    )

    expect(depthHandles.map((handle) => handle.axis).sort()).toEqual(['x', 'z'])

    const legHandle = depthHandles.find((handle) => handle.axis === 'x')!
    const frontOffset = leg.depth / 2 + 0.18
    expect(legHandle.overrideTarget?.(run, sceneApi as never)).toBe(leg.id)
    expect(legHandle.placement.position(run, sceneApi as never)[0]).toBeCloseTo(
      leg.position[0] + Math.sin(legRotation) * frontOffset,
    )
    expect(legHandle.placement.position(run, sceneApi as never)[2]).toBeCloseTo(
      leg.position[2] + Math.cos(legRotation) * frontOffset,
    )

    const patch = legHandle.apply(run, 0.78, sceneApi as never)
    expect(patch.depth).toBeCloseTo(0.78)
    expect(patch.position).toBeUndefined()

    const originalBack = legModule.position[2] - legModule.depth / 2
    const preview = legHandle.previewOverrides?.(run, 0.78, sceneApi as never) ?? []
    const modulePreview = preview.find(([id]) => id === legModule.id)?.[1]
    expect(modulePreview?.depth).toBeCloseTo(0.78)
    expect(modulePreview?.position?.[2] - modulePreview?.depth / 2).toBeCloseTo(originalBack)
    expect(nodes[legModule.id]?.depth).toBeCloseTo(0.58)
    expect(nodes[legModule.id]?.position[2]).toBeCloseTo(0)
  })

  test('plain grouped runs keep the rotate-only affordance', () => {
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_plain-group',
      parentId: 'cabinet_plain-group',
    })
    const run = CabinetNode.parse({
      id: 'cabinet_plain-group',
      children: [module.id],
    })
    const nodes = { [run.id]: run, [module.id]: module } as Record<AnyNodeId, AnyNode>
    const sceneApi = {
      get: (id: AnyNodeId) => nodes[id],
      nodes: () => nodes,
    }
    const handles =
      typeof cabinetDefinition.handles === 'function'
        ? cabinetDefinition.handles(run, sceneApi as never)
        : (cabinetDefinition.handles ?? [])
    const visibleHandles = handles.filter(
      (handle) =>
        handle.kind !== 'linear-resize' || handle.visible?.(run, sceneApi as never) !== false,
    )

    expect(visibleHandles).toHaveLength(1)
    expect(visibleHandles[0]?.kind).toBe('arc-resize')
  })

  test.each([
    'left',
    'right',
  ] as const)('source depth on an L %s changes only the source leg', (side) => {
    const { depthHandles, leg, sceneApi, source, sourceModule } = generatedL(side)
    const handle = depthHandles.find((candidate) => candidate.axis === 'z')!
    const initialSourcePosition = [...source.position]
    const initialLegPosition = [...leg.position]
    const initialSourceBack = sourceModule.position[2] - sourceModule.depth / 2
    const patch = handle.apply(source, 0.78, sceneApi as never)

    expect(patch.position).toBeUndefined()
    handle.commit?.(source, patch, sceneApi as never)

    expect(sceneApi.get<CabinetNode>(source.id)?.depth).toBeCloseTo(0.78)
    expect(sceneApi.get<CabinetNode>(source.id)?.position).toEqual(initialSourcePosition)
    const resizedSourceModule = sceneApi.get<CabinetModuleNode>(sourceModule.id)!
    expect(resizedSourceModule.position[2] - resizedSourceModule.depth / 2).toBeCloseTo(
      initialSourceBack,
    )
    expect(sceneApi.get<CabinetNode>(leg.id)?.depth).toBeCloseTo(leg.depth)
    expect(sceneApi.get<CabinetNode>(leg.id)?.position).toEqual(initialLegPosition)
  })

  test.each([
    'left',
    'right',
  ] as const)('perpendicular depth on an L %s changes only the derived leg', (side) => {
    const { depthHandles, leg, legModule, sceneApi, source } = generatedL(side)
    const handle = depthHandles.find((candidate) => candidate.axis === 'x')!
    const initialSourcePosition = [...source.position]
    const initialLegPosition = [...leg.position]
    const initialLegBack = legModule.position[2] - legModule.depth / 2
    const patch = handle.apply(source, 0.78, sceneApi as never)

    handle.commit?.(source, patch, sceneApi as never)

    expect(sceneApi.get<CabinetNode>(leg.id)?.depth).toBeCloseTo(0.78)
    expect(sceneApi.get<CabinetNode>(leg.id)?.position).toEqual(initialLegPosition)
    const resizedLegModule = sceneApi.get<CabinetModuleNode>(legModule.id)!
    expect(resizedLegModule.position[2] - resizedLegModule.depth / 2).toBeCloseTo(initialLegBack)
    expect(sceneApi.get<CabinetNode>(source.id)?.depth).toBeCloseTo(source.depth)
    expect(sceneApi.get<CabinetNode>(source.id)?.position).toEqual(initialSourcePosition)
  })

  test.each([
    'left',
    'right',
  ] as const)('chained L %s groups expose one centered depth arrow per run', (side) => {
    const { depthHandles, leg, sceneApi, source, thirdRun } = generatedU(side)
    const runs = [source, leg, thirdRun]
    const sourceWorld = resolveCabinetWorldTransform(
      source,
      sceneApi.nodes() as Record<AnyNodeId, AnyNode>,
    )
    const sourceCos = Math.cos(sourceWorld.rotation)
    const sourceSin = Math.sin(sourceWorld.rotation)
    const targetIds = depthHandles.map(
      (handle) => handle.overrideTarget?.(source, sceneApi as never) ?? source.id,
    )

    expect(new Set(targetIds)).toEqual(new Set(runs.map((run) => run.id)))
    expect(depthHandles).toHaveLength(3)

    for (const run of runs) {
      const modules = run.children
        .map((id) => sceneApi.get(id as AnyNodeId))
        .filter((node): node is CabinetModuleNode => node?.type === 'cabinet-module')
      const centerX =
        (Math.min(...modules.map((module) => module.position[0] - module.width / 2)) +
          Math.max(...modules.map((module) => module.position[0] + module.width / 2))) /
        2
      const frontZ = Math.max(...modules.map((module) => module.position[2] + module.depth / 2))
      const runWorld = resolveCabinetWorldTransform(
        run,
        sceneApi.nodes() as Record<AnyNodeId, AnyNode>,
      )
      const frontWorld = localPointToWorld(runWorld, [centerX, 0, frontZ + 0.18])
      const dx = frontWorld[0] - sourceWorld.position[0]
      const dz = frontWorld[2] - sourceWorld.position[2]
      const expectedX = sourceCos * dx - sourceSin * dz
      const expectedZ = sourceSin * dx + sourceCos * dz
      const handle = depthHandles.find(
        (candidate) =>
          (candidate.overrideTarget?.(source, sceneApi as never) ?? source.id) === run.id,
      )!
      const position = handle.placement.position(source, sceneApi as never)

      expect(position[0]).toBeCloseTo(expectedX)
      expect(position[2]).toBeCloseTo(expectedZ)
    }
  })

  test.each([
    'left',
    'right',
  ] as const)('depth resize on a chained L %s updates the connected corner width', (side) => {
    const { depthHandles, leg, sceneApi, source, thirdRun } = generatedU(side)
    const handle = depthHandles.find(
      (candidate) =>
        (candidate.overrideTarget?.(source, sceneApi as never) ?? source.id) === leg.id,
    )!
    const patch = handle.apply(source, 0.78, sceneApi as never)

    handle.commit?.(source, patch, sceneApi as never)

    const connectedFiller = thirdRun.children
      .map((id) => sceneApi.get(id as AnyNodeId))
      .find(
        (node): node is CabinetModuleNode =>
          node?.type === 'cabinet-module' && node.name === 'Corner Filler',
      )!
    expect(connectedFiller.width).toBeCloseTo(0.78)
  })

  test('run rotation keeps the cabinet bounding-box center fixed', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_offset-run',
      position: [4, 0, 3],
      rotation: Math.PI / 8,
      children: ['cabinet-module_left' as AnyNodeId, 'cabinet-module_right' as AnyNodeId],
    })
    const modules = [
      CabinetModuleNode.parse({
        id: 'cabinet-module_left',
        parentId: run.id,
        position: [0.2, 0.1, 0],
        width: 0.4,
      }),
      CabinetModuleNode.parse({
        id: 'cabinet-module_right',
        parentId: run.id,
        position: [0.7, 0.1, 0.1],
        width: 0.6,
        depth: 0.78,
      }),
    ]
    const nodes = Object.fromEntries(
      [run, ...modules].map((node) => [node.id as AnyNodeId, node as AnyNode]),
    ) as Record<AnyNodeId, AnyNode>
    const sceneApi = {
      nodes: () => nodes,
    }
    const rotateHandle = (
      typeof cabinetDefinition.handles === 'function'
        ? cabinetDefinition.handles(run, sceneApi as never)
        : (cabinetDefinition.handles ?? [])
    ).find((handle) => handle.kind === 'arc-resize' && handle.shape === 'rotate')

    expect(rotateHandle).toBeDefined()
    if (!(rotateHandle && rotateHandle.kind === 'arc-resize')) return

    const center = rotateHandle.rotationCenter!(run, sceneApi as never)
    const before = localPointToWorld(run, center)
    const patch = rotateHandle.apply(run, Math.PI / 4, sceneApi as never)
    const after = localPointToWorld({ ...run, ...patch }, center)

    expect(after[0]).toBeCloseTo(before[0])
    expect(after[1]).toBeCloseTo(before[1])
    expect(after[2]).toBeCloseTo(before[2])
  })
})

describe('buildCabinetGeometry — range hood compartments', () => {
  function hoodModule(type: 'hood-pyramid' | 'hood-curved-glass', hoodHeight: number) {
    return CabinetModuleNode.parse({
      id: 'cabinet-module_hood',
      cabinetType: 'base',
      position: [0, 1.45, 0],
      width: 0.6,
      depth: 0.32,
      carcassHeight: Math.max(0.4, hoodHeight),
      showPlinth: false,
      withCountertop: false,
      stack: [{ id: 'hood', type, height: hoodHeight }],
    })
  }

  test('pyramid hood emits canopy, rim, and duct in the appliance slot with no carcass boxes', () => {
    const node = hoodModule('hood-pyramid', HOOD_PYRAMID_CANOPY_HEIGHT)
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)

    const canopy = findMeshByName(group, 'cabinet-hood-pyramid-0-canopy')
    const duct = findMeshByName(group, 'cabinet-hood-pyramid-0-duct')
    expect(canopy.userData.slotId).toBe('appliance')
    expect(duct.userData.slotId).toBe('appliance')
    expect(findMeshByName(group, 'cabinet-hood-pyramid-0-rim')).toBeDefined()

    expect(findMeshesBySlot(group, 'carcass')).toHaveLength(0)
    expect(() => findMeshByName(group, 'cabinet-side-left')).toThrow()
    expect(() => findMeshByName(group, 'cabinet-top')).toThrow()
  })

  test('pyramid canopy protrudes past the wall cabinet depth', () => {
    const node = hoodModule('hood-pyramid', HOOD_PYRAMID_CANOPY_HEIGHT)
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)

    const canopy = findMeshByName(group, 'cabinet-hood-pyramid-0-canopy')
    const bounds = worldBounds(canopy)
    expect(bounds.max.z).toBeGreaterThan(node.depth / 2)
    expect(bounds.max.z).toBeCloseTo(-node.depth / 2 + HOOD_CANOPY_DEPTH)
  })

  test('duct is centered, sized to the duct cross-section, and reaches the fallback ceiling', () => {
    const node = hoodModule('hood-pyramid', HOOD_PYRAMID_CANOPY_HEIGHT)
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)

    const duct = findMeshByName(group, 'cabinet-hood-pyramid-0-duct')
    const bounds = worldBounds(duct)
    expect(bounds.max.x - bounds.min.x).toBeCloseTo(HOOD_DUCT_SIZE)
    expect((bounds.max.x + bounds.min.x) / 2).toBeCloseTo(0)
    // module base sits at y=1.45 world, so local duct top = 2.5 - 1.45
    expect(bounds.max.y).toBeCloseTo(2.5 - 1.45)
  })

  test('duct reaches the tallest wall height when the parent chain resolves to a level with walls', () => {
    const node = hoodModule('hood-pyramid', HOOD_PYRAMID_CANOPY_HEIGHT)
    const baseModule = CabinetModuleNode.parse({
      id: 'cabinet-module_base',
      parentId: 'cabinet_run' as AnyNodeId,
      cabinetType: 'base',
      position: [0, 0.1, 0],
      width: 0.6,
      carcassHeight: 0.72,
    })
    const run = CabinetNode.parse({
      id: 'cabinet_run',
      parentId: 'level_0' as AnyNodeId,
      position: [0, 0, 0],
      children: ['cabinet-module_base' as AnyNodeId],
    })
    const level = {
      id: 'level_0',
      type: 'level',
      parentId: null,
      children: ['wall_a', 'cabinet_run'],
    } as unknown as AnyNode
    const wall = {
      id: 'wall_a',
      type: 'wall',
      parentId: 'level_0',
      height: 3.0,
    } as unknown as AnyNode
    const nodes = new Map<string, AnyNode>([
      [baseModule.id, baseModule as AnyNode],
      [run.id, run as AnyNode],
      ['level_0', level],
      ['wall_a', wall],
    ])
    const ctx: GeometryContext = {
      children: [],
      parent: baseModule as AnyNode,
      resolve: (id) => nodes.get(id) as never,
      siblings: [],
    }
    const group = buildCabinetGeometry(node, ctx, 'rendered', false)

    const duct = findMeshByName(group, 'cabinet-hood-pyramid-0-duct')
    const bounds = worldBounds(duct)
    // world base = 1.45 (hood) + 0.1 (base module) + 0 (run) = 1.55; ceiling 3.0
    expect(bounds.max.y).toBeCloseTo(3.0 - 1.55)
  })

  test('curved glass hood emits a stainless body and a glass visor', () => {
    const node = hoodModule('hood-curved-glass', HOOD_CURVED_TOTAL_HEIGHT)
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)

    const body = findMeshByName(group, 'cabinet-hood-curved-glass-0-body')
    expect(body.userData.slotId).toBe('appliance')
    const visor = findMeshByName(group, 'cabinet-hood-curved-glass-0-glass-visor')
    expect(visor.userData.slotId).toBe('glass')
    expect(findMeshByName(group, 'cabinet-hood-curved-glass-0-duct')).toBeDefined()
    expect(findMeshesBySlot(group, 'carcass')).toHaveLength(0)

    const visorBounds = worldBounds(visor)
    expect(visorBounds.max.x - visorBounds.min.x).toBeCloseTo(node.width)
    expect(visorBounds.max.y).toBeCloseTo(HOOD_CURVED_TOTAL_HEIGHT)
  })
})

describe('buildCabinetGeometry — sink compartments', () => {
  const sinkStack = [
    { id: 'door', type: 'door' as const, doorType: 'double' as const },
    { id: 'sink', type: 'sink' as const, sinkLayout: 'single' as const },
  ]

  function sinkModule(overrides: Record<string, unknown> = {}) {
    return CabinetModuleNode.parse({
      width: SINK_STANDARD_WIDTH,
      depth: 0.58,
      carcassHeight: 0.72,
      withCountertop: true,
      countertopThickness: 0.02,
      stack: sinkStack,
      ...overrides,
    })
  }

  test('sink module emits basin walls, drain, and faucet', () => {
    const group = buildCabinetGeometry(sinkModule(), undefined, 'rendered', false)

    expect(findMeshByName(group, 'cabinet-sink-1-0-basin-bottom')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-sink-1-0-basin-left')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-sink-1-0-basin-front')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-sink-1-0-drain')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-sink-1-faucet-base')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-sink-1-faucet-gooseneck')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-sink-1-faucet-handle-barrel')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-sink-1-faucet-handle-cap')).toBeDefined()
    expect(findMeshByName(group, 'cabinet-sink-1-faucet-handle-pin')).toBeDefined()
  })

  test('sink appliance paint persists onto faucet and basin after rebuild', () => {
    const ctx: GeometryContext = {
      ...geometryContext({ children: [] }),
      materials: {
        mat_sink: {
          id: 'mat_sink',
          name: 'Painted sink',
          material: {
            properties: {
              color: '#ff3366',
              roughness: 0.4,
              metalness: 0.1,
            },
          },
        },
      } as GeometryContext['materials'],
    }
    const group = buildCabinetGeometry(
      sinkModule({ slots: { appliance: 'scene:mat_sink' } }),
      ctx,
      'rendered',
      true,
    )
    const paintedMeshes = [
      findMeshByName(group, 'cabinet-sink-1-0-basin-bottom'),
      findMeshByName(group, 'cabinet-sink-1-0-drain'),
      findMeshByName(group, 'cabinet-sink-1-faucet-base'),
      findMeshByName(group, 'cabinet-sink-1-faucet-handle-barrel'),
    ]

    for (const mesh of paintedMeshes) {
      const material = Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material
      expect(material.color.getHexString()).toBe('ff3366')
    }
  })

  test('sink module keeps a top false front in front of the basin', () => {
    const node = sinkModule()
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)
    const falseFront = findMeshByName(group, 'cabinet-sink-false-front-1')
    const basinFront = findMeshByName(group, 'cabinet-sink-1-0-basin-front')

    const frontBounds = worldBounds(falseFront)
    const basinBounds = worldBounds(basinFront)
    const topY = (node.showPlinth ? node.plinthHeight : 0) + node.carcassHeight

    expect(falseFront.userData.slotId).toBe('front')
    expect(frontBounds.max.y).toBeCloseTo(topY, 2)
    expect(frontBounds.min.y).toBeLessThanOrEqual(basinBounds.min.y + 0.01)
    expect(frontBounds.max.z).toBeGreaterThan(basinBounds.max.z)
  })

  test('faucet handle uses a horizontal mixer barrel with an upright pin lever', () => {
    const group = buildCabinetGeometry(sinkModule(), undefined, 'rendered', false)
    const barrel = findMeshByName(group, 'cabinet-sink-1-faucet-handle-barrel')
    const pin = findMeshByName(group, 'cabinet-sink-1-faucet-handle-pin')
    const cap = findMeshByName(group, 'cabinet-sink-1-faucet-handle-cap')

    const barrelBounds = worldBounds(barrel)
    const pinBounds = worldBounds(pin)
    const capBounds = worldBounds(cap)

    expect(barrel.rotation.z).toBeCloseTo(Math.PI / 2)
    expect(barrelBounds.max.x - barrelBounds.min.x).toBeGreaterThan(
      barrelBounds.max.y - barrelBounds.min.y,
    )
    expect(pinBounds.max.y - pinBounds.min.y).toBeGreaterThan(pinBounds.max.x - pinBounds.min.x)
    expect(pinBounds.min.y).toBeGreaterThan(barrelBounds.min.y)
    expect(capBounds.min.x).toBeGreaterThan(barrelBounds.max.x - 0.012)
  })

  test('double layout emits two basins, single emits one', () => {
    const single = buildCabinetGeometry(sinkModule(), undefined, 'rendered', false)
    expect(() => findMeshByName(single, 'cabinet-sink-1-1-basin-bottom')).toThrow()

    const double = buildCabinetGeometry(
      sinkModule({
        stack: [sinkStack[0], { id: 'sink', type: 'sink', sinkLayout: 'double' }],
      }),
      undefined,
      'rendered',
      false,
    )
    expect(findMeshByName(double, 'cabinet-sink-1-0-basin-bottom')).toBeDefined()
    expect(findMeshByName(double, 'cabinet-sink-1-1-basin-bottom')).toBeDefined()
  })

  test('sink module skips the carcass top panel and the deck under the sink row', () => {
    const group = buildCabinetGeometry(sinkModule(), undefined, 'rendered', false)
    const names: string[] = []
    group.traverse((object) => names.push(object.name))
    expect(names).not.toContain('cabinet-top')
    expect(names).not.toContain('cabinet-deck-0')
  })

  test('module countertop is CSG-cut with a bowl opening', () => {
    const node = sinkModule()
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)
    const countertop = findMeshByName(group, 'cabinet-countertop')

    // A plain box has 24 vertices; the cut slab has the bowl ring baked in.
    const position = countertop.geometry.getAttribute('position') as BufferAttribute
    expect(position.count).toBeGreaterThan(24)

    // No countertop surface remains across the bowl center.
    const topY = (node.showPlinth ? node.plinthHeight : 0) + node.carcassHeight
    const hasSurfaceAtBowlCenter = hasVertex(
      countertop,
      (point) => Math.abs(point.x) < 0.05 && Math.abs(point.z) < 0.05 && point.y > topY - 0.001,
    )
    expect(hasSurfaceAtBowlCenter).toBe(false)
  })

  test('run countertop is cut above a sink module', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_sink-run',
      withCountertop: true,
      countertopThickness: 0.02,
      countertopOverhang: 0.02,
    })
    const modules = [
      CabinetModuleNode.parse({
        id: 'cabinet-module_plain',
        parentId: run.id,
        cabinetType: 'base',
        position: [-0.6, 0.1, 0],
        width: 0.6,
        depth: 0.58,
        carcassHeight: 0.72,
      }),
      CabinetModuleNode.parse({
        id: 'cabinet-module_sink',
        parentId: run.id,
        cabinetType: 'base',
        position: [0.1, 0.1, 0],
        width: SINK_STANDARD_WIDTH,
        depth: 0.58,
        carcassHeight: 0.72,
        stack: sinkStack,
      }),
    ]

    const group = buildCabinetGeometry(
      run,
      geometryContext({ children: modules }),
      'rendered',
      false,
    )
    const countertop = findMeshByName(group, 'cabinet-run-countertop')
    const position = countertop.geometry.getAttribute('position') as BufferAttribute
    expect(position.count).toBeGreaterThan(24)

    const topY = 0.1 + 0.72 + 0.02
    // Open above the sink module center, intact above the plain module.
    expect(
      hasVertex(
        countertop,
        (point) =>
          Math.abs(point.x - 0.1) < 0.05 && Math.abs(point.z) < 0.05 && point.y > topY - 0.001,
      ),
    ).toBe(false)
    const bounds = worldBounds(countertop)
    expect(bounds.min.x).toBeLessThan(-0.85)
    expect(bounds.max.x).toBeGreaterThan(0.45)
  })
})
