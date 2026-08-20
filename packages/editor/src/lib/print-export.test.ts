import { afterEach, describe, expect, test } from 'bun:test'
import { type AnyNode, sceneRegistry } from '@pascal-app/core'
import * as THREE from 'three'
import { prepareSceneForExport } from './glb-export'
import { exportSceneToPrintStl, prepareSceneForPrint } from './print-export'

function binaryStlBounds(buffer: ArrayBuffer): { triangles: number; bounds: THREE.Box3 } {
  const view = new DataView(buffer)
  const triangles = view.getUint32(80, true)
  const bounds = new THREE.Box3()
  const point = new THREE.Vector3()
  let offset = 84

  for (let triangle = 0; triangle < triangles; triangle += 1) {
    offset += 12
    for (let vertex = 0; vertex < 3; vertex += 1) {
      point.set(
        view.getFloat32(offset, true),
        view.getFloat32(offset + 4, true),
        view.getFloat32(offset + 8, true),
      )
      bounds.expandByPoint(point)
      offset += 12
    }
    offset += 2
  }

  return { triangles, bounds }
}

describe('print STL export', () => {
  afterEach(() => {
    sceneRegistry.nodes.clear()
  })

  test('writes millimeter-scaled Z-up geometry centered on the print bed', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 6))
    mesh.position.set(5, 2, -7)

    const { buffer, report } = exportSceneToPrintStl(mesh, { scale: 100 })
    const parsed = binaryStlBounds(buffer)
    const size = parsed.bounds.getSize(new THREE.Vector3())

    expect(parsed.triangles).toBe(12)
    expect(size.x).toBeCloseTo(100, 4)
    expect(size.y).toBeCloseTo(60, 4)
    expect(size.z).toBeCloseTo(40, 4)
    expect(parsed.bounds.min.x).toBeCloseTo(-50, 4)
    expect(parsed.bounds.max.x).toBeCloseTo(50, 4)
    expect(parsed.bounds.min.y).toBeCloseTo(-30, 4)
    expect(parsed.bounds.max.y).toBeCloseTo(30, 4)
    expect(parsed.bounds.min.z).toBeCloseTo(0, 4)
    expect(parsed.bounds.max.z).toBeCloseTo(40, 4)

    expect(report.status).toBe('pass')
    expect(report.bounds?.width).toBeCloseTo(100, 4)
    expect(report.bounds?.depth).toBeCloseTo(60, 4)
    expect(report.bounds?.height).toBeCloseTo(40, 4)
    expect(report.boundaryEdgeCount).toBe(0)
    expect(report.nonManifoldEdgeCount).toBe(0)
    expect(report.volumeMm3).toBeCloseTo(240_000, 4)
  })

  test('reports open, zero-volume surface geometry before download', () => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 3))

    const { report } = prepareSceneForPrint(mesh, { scale: 50 })

    expect(report.status).toBe('warning')
    expect(report.boundaryEdgeCount).toBe(4)
    expect(report.volumeMm3).toBeCloseTo(0)
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['open_boundaries', 'zero_volume', 'compiler_pending']),
    )
  })

  test('omits semantically hidden meshes from the parsed print artifact', () => {
    const root = new THREE.Group()
    const visibleGroup = new THREE.Group()
    const hiddenGroup = new THREE.Group()
    visibleGroup.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)))
    hiddenGroup.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)))
    root.add(visibleGroup, hiddenGroup)

    const visibleId = 'visible-structure'
    const hiddenId = 'hidden-furniture'
    sceneRegistry.nodes.set(visibleId, visibleGroup)
    sceneRegistry.nodes.set(hiddenId, hiddenGroup)
    const nodes = {
      [visibleId]: {
        object: 'node',
        id: visibleId,
        type: 'wall',
        parentId: null,
        visible: true,
      } as unknown as AnyNode,
      [hiddenId]: {
        object: 'node',
        id: hiddenId,
        type: 'item',
        parentId: null,
        visible: false,
      } as unknown as AnyNode,
    }

    const prepared = prepareSceneForExport(root, nodes)
    const print = exportSceneToPrintStl(prepared.scene, { scale: 100 })

    expect(binaryStlBounds(print.buffer).triangles).toBe(12)
    expect(print.report.triangleCount).toBe(12)
  })

  test('rejects an invalid architectural scale', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))

    expect(() => prepareSceneForPrint(mesh, { scale: 0 })).toThrow(
      'Print scale must be a positive finite denominator',
    )
  })
})
