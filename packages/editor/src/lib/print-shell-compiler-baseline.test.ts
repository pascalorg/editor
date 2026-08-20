import { describe, expect, test } from 'bun:test'
import {
  calculateLevelMiters,
  DoorNode,
  RoofSegmentNode,
  SlabNode,
  type SlabPolygonContext,
  sceneRegistry,
  WallNode,
} from '@pascal-app/core'
import {
  generateExtrudedWall,
  generateRoofSegmentGeometry,
  generateSlabGeometry,
} from '@pascal-app/viewer'
import * as THREE from 'three'
import { exportSceneToPrintStl } from './print-export'
import { compilePrintShellBaseline } from './print-shell-compiler-baseline'

const EMPTY_SLAB_CONTEXT: SlabPolygonContext = { walls: [], siblingSlabs: [] }

function structuralBox(id: string, x: number): THREE.Group {
  const group = new THREE.Group()
  group.userData = { pascalId: id }
  group.position.x = x
  group.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)))
  return group
}

function rayIntersectionCount(root: THREE.Object3D, x: number, y: number): number {
  root.updateMatrixWorld(true)
  const raycaster = new THREE.Raycaster(new THREE.Vector3(x, y, -2), new THREE.Vector3(0, 0, 1))
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

describe('print shell compiler baseline', () => {
  test('unions overlapping world-space structural meshes into a closed shell', () => {
    const source = new THREE.Group()
    source.add(structuralBox('wall_left', -0.5), structuralBox('wall_right', 0.5))

    const compiled = compilePrintShellBaseline(source)

    expect(compiled.status).toBe('compiled')
    expect(compiled.inputMeshCount).toBe(2)
    expect(compiled.sourceNodeIds).toEqual(['wall_left', 'wall_right'])
    expect(compiled.scene).not.toBeNull()

    const print = exportSceneToPrintStl(compiled.scene!, { scale: 100 })
    expect(print.report.status).toBe('pass')
    expect(print.report.bounds?.width).toBeCloseTo(30, 4)
    expect(print.report.bounds?.depth).toBeCloseTo(20, 4)
    expect(print.report.bounds?.height).toBeCloseTo(20, 4)
    expect(print.report.boundaryEdgeCount).toBe(0)
    expect(print.report.nonManifoldEdgeCount).toBe(0)
    expect(print.report.volumeMm3).toBeCloseTo(12_000, 1)
  })

  test('blocks a structural mesh without Pascal provenance', () => {
    const source = new THREE.Group()
    source.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)))

    const compiled = compilePrintShellBaseline(source)

    expect(compiled.status).toBe('blocked')
    expect(compiled.scene).toBeNull()
    expect(compiled.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'missing_node_provenance', severity: 'error' }),
    )
  })

  test('compiles a generated wall opening and slab into one printable shell', () => {
    const wall = WallNode.parse({
      id: 'wall_print-shell-fixture',
      start: [0, 0],
      end: [4, 0],
      height: 2.5,
      thickness: 0.2,
    })
    const door = DoorNode.parse({
      id: 'door_print-shell-fixture',
      wallId: wall.id,
      position: [2, 1.05, 0],
      width: 0.9,
      height: 2.1,
    })
    const slab = SlabNode.parse({
      id: 'slab_print-shell-fixture',
      elevation: 0,
      thickness: 0.2,
      polygon: [
        [-0.5, -1.5],
        [4.5, -1.5],
        [4.5, 1.5],
        [-0.5, 1.5],
      ],
    })
    const wallRoot = new THREE.Group()
    wallRoot.userData = { pascalId: wall.id }
    const slabRoot = new THREE.Group()
    slabRoot.userData = { pascalId: slab.id }
    const registeredWall = new THREE.Group()
    sceneRegistry.nodes.set(wall.id, registeredWall)

    try {
      wallRoot.add(new THREE.Mesh(generateExtrudedWall(wall, [door], calculateLevelMiters([wall]))))
      slabRoot.add(new THREE.Mesh(generateSlabGeometry(slab, EMPTY_SLAB_CONTEXT)))
      const source = new THREE.Group()
      source.add(wallRoot, slabRoot)

      const compiled = compilePrintShellBaseline(source)

      expect(compiled.status).toBe('compiled')
      expect(compiled.inputMeshCount).toBe(2)
      expect(compiled.sourceNodeIds).toEqual([slab.id, wall.id].sort())
      expect(compiled.scene).not.toBeNull()
      expect(rayIntersectionCount(compiled.scene!, door.position[0], 1)).toBe(0)
      expect(rayIntersectionCount(compiled.scene!, 0.5, 1)).toBeGreaterThanOrEqual(2)

      const print = exportSceneToPrintStl(compiled.scene!, { scale: 100 })
      expect(print.report.status).toBe('pass')
      expect(print.report.bounds?.width).toBeCloseTo(50, 4)
      expect(print.report.bounds?.depth).toBeCloseTo(30, 4)
      expect(print.report.bounds?.height).toBeCloseTo(27, 4)
      expect(print.report.boundaryEdgeCount).toBe(0)
      expect(print.report.nonManifoldEdgeCount).toBe(0)
      expect(print.report.volumeMm3).toBeCloseTo(4_622, 0)
    } finally {
      sceneRegistry.nodes.delete(wall.id)
      registeredWall.clear()
    }
  })

  test('blocks the generated gable roof until a printable solid source exists', () => {
    const roof = RoofSegmentNode.parse({
      id: 'rseg_print-shell-fixture',
      roofType: 'gable',
      width: 4,
      depth: 3,
      wallHeight: 0.5,
      pitch: 30,
      wallThickness: 0.15,
      deckThickness: 0.1,
      overhang: 0.3,
      shingleThickness: 0.05,
    })
    const roofRoot = new THREE.Group()
    roofRoot.userData = { pascalId: roof.id }
    roofRoot.add(new THREE.Mesh(generateRoofSegmentGeometry(roof)))
    const source = new THREE.Group()
    source.add(roofRoot)

    const first = compilePrintShellBaseline(source)
    const second = compilePrintShellBaseline(source)

    expect(first.status).toBe('compiled')
    expect(first.inputMeshCount).toBe(1)
    expect(first.sourceNodeIds).toEqual([roof.id])
    expect(first.scene).not.toBeNull()
    expect(second.status).toBe('compiled')
    expect(second.scene).not.toBeNull()

    const firstPrint = exportSceneToPrintStl(first.scene!, { scale: 100 })
    const secondPrint = exportSceneToPrintStl(second.scene!, { scale: 100 })
    expect(firstPrint.report.status).toBe('blocked')
    expect(firstPrint.report.degenerateTriangleCount).toBeGreaterThan(0)
    expect(firstPrint.report.boundaryEdgeCount).toBeGreaterThan(0)
    expect(firstPrint.report.nonManifoldEdgeCount).toBeGreaterThan(0)
    expect(firstPrint.report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['degenerate_triangles', 'open_boundaries', 'non_manifold_edges']),
    )
    expect(firstPrint.report.volumeMm3).toBeGreaterThan(0)
    expect(new Uint8Array(firstPrint.buffer)).toEqual(new Uint8Array(secondPrint.buffer))
  })
})
