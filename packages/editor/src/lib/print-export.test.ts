import { afterEach, describe, expect, test } from 'bun:test'
import { type AnyNode, sceneRegistry } from '@pascal-app/core'
import * as THREE from 'three'
import { prepareSceneForExport } from './glb-export'
import {
  exportSceneToPrintStl,
  mergePrintExportDiagnostics,
  prepareSceneForPrint,
} from './print-export'

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

function reverseWinding(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const index = geometry.getIndex()
  if (!index) throw new Error('Expected indexed geometry')
  const reversed: number[] = []
  for (let offset = 0; offset + 2 < index.count; offset += 3) {
    reversed.push(index.getX(offset), index.getX(offset + 2), index.getX(offset + 1))
  }
  geometry.setIndex(reversed)
  return geometry
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
    expect(report.connectedComponentCount).toBe(1)
    expect(report.solidComponentCount).toBe(1)
    expect(report.invertedWinding).toBe(false)
    expect(report.volumeMm3).toBeCloseTo(240_000, 4)
  })

  test('blocks open, zero-volume surface geometry before download', () => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 3))

    const { report } = prepareSceneForPrint(mesh, { scale: 50 })

    expect(report.status).toBe('blocked')
    expect(report.boundaryEdgeCount).toBe(4)
    expect(report.volumeMm3).toBeCloseTo(0)
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['open_boundaries', 'zero_volume', 'compiler_pending']),
    )
    expect(
      report.diagnostics
        .filter(
          (diagnostic) =>
            diagnostic.code === 'open_boundaries' || diagnostic.code === 'zero_volume',
        )
        .map((diagnostic) => diagnostic.severity),
    ).toEqual(['error', 'error'])
  })

  test('blocks degenerate triangles', () => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 2, 0, 0], 3),
    )

    const { report } = prepareSceneForPrint(new THREE.Mesh(geometry), { scale: 100 })

    expect(report.status).toBe('blocked')
    expect(report.degenerateTriangleCount).toBe(1)
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'degenerate_triangles', severity: 'error' }),
    )
  })

  test('blocks an edge shared by more than two triangles', () => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        3,
      ),
    )

    const { report } = prepareSceneForPrint(new THREE.Mesh(geometry), { scale: 100 })

    expect(report.status).toBe('blocked')
    expect(report.nonManifoldEdgeCount).toBe(1)
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'non_manifold_edges', severity: 'error' }),
    )
  })

  test('does not conflate distinct closed edges inside the boundary matching tolerance', () => {
    const source = new THREE.Group()
    const first = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
    const second = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
    second.position.x = 1.000002
    source.add(first, second)

    const { report } = prepareSceneForPrint(source, { scale: 100 })

    expect(report.status).toBe('warning')
    expect(report.boundaryEdgeCount).toBe(0)
    expect(report.nonManifoldEdgeCount).toBe(0)
    expect(report.connectedComponentCount).toBe(2)
    expect(report.solidComponentCount).toBe(2)
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'disconnected_solids', severity: 'warning' }),
    )
  })

  test('blocks disconnected solids in a compiled printable part', () => {
    const source = new THREE.Group()
    const first = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
    const second = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
    second.position.x = 2
    source.add(first, second)

    const { report } = prepareSceneForPrint(source, { scale: 100, compiled: true })

    expect(report.status).toBe('blocked')
    expect(report.connectedComponentCount).toBe(2)
    expect(report.solidComponentCount).toBe(2)
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'disconnected_solids', severity: 'error' }),
    )
  })

  test('allows an inward shell to represent a sealed cavity without calling it a second solid', () => {
    const source = new THREE.Group()
    source.add(
      new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)),
      new THREE.Mesh(reverseWinding(new THREE.BoxGeometry(1, 1, 1))),
    )

    const { report } = prepareSceneForPrint(source, { scale: 100, compiled: true })

    expect(report.status).toBe('warning')
    expect(report.connectedComponentCount).toBe(2)
    expect(report.solidComponentCount).toBe(1)
    expect(report.invertedWinding).toBe(false)
    expect(report.volumeMm3).toBeCloseTo(7_000, 4)
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'inward_surface_components', severity: 'warning' }),
    )
  })

  test('blocks a globally inside-out closed surface', () => {
    const mesh = new THREE.Mesh(reverseWinding(new THREE.BoxGeometry(1, 1, 1)))

    const { report } = prepareSceneForPrint(mesh, { scale: 100, compiled: true })

    expect(report.status).toBe('blocked')
    expect(report.connectedComponentCount).toBe(1)
    expect(report.solidComponentCount).toBe(0)
    expect(report.invertedWinding).toBe(true)
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'inverted_winding', severity: 'error' }),
    )
  })

  test('uses authoritative indexed incidence for a compiled mesh', () => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1], 3),
    )
    geometry.setIndex([0, 1, 2, 1, 0, 3, 0, 1, 4])

    const { report } = prepareSceneForPrint(new THREE.Mesh(geometry), {
      scale: 100,
      indexedTopology: true,
    })

    expect(report.status).toBe('blocked')
    expect(report.nonManifoldEdgeCount).toBe(1)
  })

  test('merges located compiler diagnostics into a compiled preflight report', () => {
    const { report } = prepareSceneForPrint(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)), {
      scale: 100,
      compiled: true,
    })
    const merged = mergePrintExportDiagnostics(report, [
      {
        severity: 'error',
        code: 'unsupported_roof_print_trim',
        message: 'The roof trim has no manifold fixture.',
        nodeIds: ['rseg_print-trimmed'],
      },
    ])

    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toContain('compiler_limits')
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'compiler_pending',
    )
    expect(merged.status).toBe('blocked')
    expect(merged.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'unsupported_roof_print_trim',
        nodeIds: ['rseg_print-trimmed'],
      }),
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
