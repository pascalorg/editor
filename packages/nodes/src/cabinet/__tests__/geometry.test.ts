import { describe, expect, test } from 'bun:test'
import type { GeometryContext } from '@pascal-app/core'
import type { BufferAttribute, Mesh, Object3D } from 'three'
import { buildCabinetGeometry } from '../geometry'
import { CabinetModuleNode, CabinetNode } from '../schema'

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
      { children: modules } as GeometryContext,
      'rendered',
      false,
    )
    const countertops = findMeshesBySlot(group, 'countertop')
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

    expect(countertops.length).toBe(2)
    expect(countertops[0]!.maxX).toBeCloseTo(0)
    expect(countertops[1]!.minX).toBeCloseTo(0.6)
  })
})
