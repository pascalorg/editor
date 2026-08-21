import { describe, expect, test } from 'bun:test'
import { DoorNode, WallNode, WindowNode } from '@pascal-app/core'
import * as THREE from 'three'
import { buildPrintableWallSolids } from './print-wall-solids'

function rayIntersectionCount(root: THREE.Object3D, x: number, y: number): number {
  root.updateMatrixWorld(true)
  const raycaster = new THREE.Raycaster(new THREE.Vector3(x, y, -1), new THREE.Vector3(0, 0, 1))
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  let count = 0
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    const originalMaterial = mesh.material
    mesh.material = material
    count += raycaster.intersectObject(mesh, false).length
    mesh.material = originalMaterial
  })
  material.dispose()
  return count
}

function expectClosedBoxMeshes(root: THREE.Group) {
  for (const object of root.children) {
    const mesh = object as THREE.Mesh
    expect(mesh.isMesh).toBe(true)
    const index = mesh.geometry.getIndex()
    expect(index).not.toBeNull()
    const edges = new Map<string, number>()
    const add = (a: number, b: number) => {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`
      edges.set(key, (edges.get(key) ?? 0) + 1)
    }
    for (let offset = 0; offset + 2 < index!.count; offset += 3) {
      const a = index!.getX(offset)
      const b = index!.getX(offset + 1)
      const c = index!.getX(offset + 2)
      add(a, b)
      add(b, c)
      add(c, a)
    }
    expect(Array.from(edges.values()).every((uses) => uses === 2)).toBe(true)
  }
}

function dispose(root: THREE.Group) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (mesh.isMesh) mesh.geometry.dispose()
  })
}

describe('buildPrintableWallSolids', () => {
  test('builds deterministic closed solids around rectangular door and window voids', () => {
    const door = DoorNode.parse({
      id: 'door_print-wall',
      wallId: 'wall_print-openings',
      position: [1.5, 1.05, 0],
      width: 0.9,
      height: 2.1,
    })
    const window = WindowNode.parse({
      id: 'window_print-wall',
      wallId: 'wall_print-openings',
      position: [4.5, 1.4, 0],
      width: 1.2,
      height: 1.0,
    })
    const wall = WallNode.parse({
      id: 'wall_print-openings',
      start: [0, 0],
      end: [6, 0],
      height: 2.5,
      thickness: 0.2,
      children: [door.id, window.id],
    })
    const nodes = { [door.id]: door, [window.id]: window }
    const first = buildPrintableWallSolids(wall, { effectiveHeight: 2.5 }, nodes)
    const second = buildPrintableWallSolids(wall, { effectiveHeight: 2.5 }, nodes)

    expect(first.status).toBe('ready')
    expect(second.status).toBe('ready')
    expect(first.object).not.toBeNull()
    expect(second.object).not.toBeNull()
    expect(first.object!.userData.pascalId).toBe(wall.id)
    expectClosedBoxMeshes(first.object!)

    const bounds = new THREE.Box3().setFromObject(first.object!)
    expect(bounds.min.x).toBeCloseTo(0, 6)
    expect(bounds.min.y).toBeCloseTo(0, 6)
    expect(bounds.min.z).toBeCloseTo(-0.1, 6)
    expect(bounds.max.x).toBeCloseTo(6, 6)
    expect(bounds.max.y).toBeCloseTo(2.5, 6)
    expect(bounds.max.z).toBeCloseTo(0.1, 6)
    expect(rayIntersectionCount(first.object!, 1.5, 1)).toBe(0)
    expect(rayIntersectionCount(first.object!, 4.5, 1.4)).toBe(0)
    expect(rayIntersectionCount(first.object!, 3, 1)).toBeGreaterThanOrEqual(2)

    expect(first.object!.children.map((child) => child.position.toArray())).toEqual(
      second.object!.children.map((child) => child.position.toArray()),
    )
    expect(
      first.object!.children.map((child) =>
        Array.from((child as THREE.Mesh).geometry.getAttribute('position').array),
      ),
    ).toEqual(
      second.object!.children.map((child) =>
        Array.from((child as THREE.Mesh).geometry.getAttribute('position').array),
      ),
    )

    const hiddenOpenings = buildPrintableWallSolids(
      wall,
      { effectiveHeight: 2.5, includedNodeIds: new Set() },
      nodes,
    )
    expect(hiddenOpenings.status).toBe('ready')
    expect(rayIntersectionCount(hiddenOpenings.object!, 1.5, 1)).toBeGreaterThanOrEqual(2)

    dispose(first.object!)
    dispose(second.object!)
    dispose(hiddenOpenings.object!)
  })

  test('preserves the authored wall-local transform', () => {
    const wall = WallNode.parse({
      id: 'wall_print-transform',
      start: [1, 2],
      end: [1, 6],
      thickness: 0.2,
    })
    const result = buildPrintableWallSolids(wall, { effectiveHeight: 3 })

    expect(result.status).toBe('ready')
    expect(result.object?.position.toArray()).toEqual([1, 0, 2])
    expect(result.object?.rotation.y).toBeCloseTo(-Math.PI / 2)
    dispose(result.object!)
  })

  test('blocks unsupported wall forms and invalid opening contracts', () => {
    const shaped = DoorNode.parse({
      id: 'door_print-wall-arch',
      wallId: 'wall_print-blocked',
      position: [2, 1.05, 0],
      openingShape: 'arch',
    })
    const wall = WallNode.parse({
      id: 'wall_print-blocked',
      start: [0, 0],
      end: [4, 0],
      children: [shaped.id],
    })
    const curved = buildPrintableWallSolids(
      { ...wall, curveOffset: 0.5 },
      { effectiveHeight: 2.5 },
      { [shaped.id]: shaped },
    )
    const terrain = buildPrintableWallSolids(
      { ...wall, children: [], fillToTerrain: true },
      { effectiveHeight: 2.5 },
    )
    const shapedResult = buildPrintableWallSolids(
      wall,
      { effectiveHeight: 2.5 },
      { [shaped.id]: shaped },
    )
    const unresolved = buildPrintableWallSolids(wall, { effectiveHeight: 2.5 }, {})

    expect(curved).toEqual(
      expect.objectContaining({
        status: 'blocked',
        diagnostics: [expect.objectContaining({ code: 'unsupported_wall_print_curve' })],
      }),
    )
    expect(terrain).toEqual(
      expect.objectContaining({
        status: 'blocked',
        diagnostics: [expect.objectContaining({ code: 'unsupported_wall_print_terrain' })],
      }),
    )
    expect(shapedResult).toEqual(
      expect.objectContaining({
        status: 'blocked',
        diagnostics: [expect.objectContaining({ code: 'unsupported_wall_print_opening_shape' })],
      }),
    )
    expect(unresolved).toEqual(
      expect.objectContaining({
        status: 'blocked',
        diagnostics: [expect.objectContaining({ code: 'unresolved_wall_print_child' })],
      }),
    )
  })
})
