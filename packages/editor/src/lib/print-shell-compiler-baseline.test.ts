import { describe, expect, test } from 'bun:test'
import { type AnyNode, RoofSegmentNode, type RoofType, WallNode } from '@pascal-app/core'
import { generateRoofSegmentGeometry } from '@pascal-app/viewer'
import * as THREE from 'three'
import { prepareSceneForExport } from './glb-export'
import { filterPreparedSceneForPrintContent } from './print-content-scope'
import { exportSceneToPrintStl } from './print-export'
import { createPrintGoldenHouseFixture } from './print-golden-house.test-fixture'
import { compileSemanticPrintShell } from './print-shell-compiler'
import { compilePrintShellBaseline } from './print-shell-compiler-baseline'
import { compileManifoldMeshData } from './print-shell-compiler-manifold-core'
import { compileSemanticPrintShellWithManifold } from './print-shell-compiler-manifold-worker'

const ROOF_TYPES: RoofType[] = ['gable', 'hip', 'shed', 'gambrel', 'mansard', 'flat', 'dutch']

function structuralBox(id: string, x: number): THREE.Group {
  const group = new THREE.Group()
  group.userData = { pascalId: id }
  group.position.x = x
  group.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)))
  return group
}

function rayIntersectionCount(
  root: THREE.Object3D,
  x: number,
  y: number,
  far = Number.POSITIVE_INFINITY,
  startZ = -2,
): number {
  root.updateMatrixWorld(true)
  const raycaster = new THREE.Raycaster(new THREE.Vector3(x, y, startZ), new THREE.Vector3(0, 0, 1))
  raycaster.far = far
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

function indexedNonManifoldEdgeCount(root: THREE.Object3D): number {
  let count = 0
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    const index = mesh.isMesh ? mesh.geometry.getIndex() : null
    if (!index) return
    const edges = new Map<string, number>()
    const add = (a: number, b: number) => {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`
      edges.set(key, (edges.get(key) ?? 0) + 1)
    }
    for (let offset = 0; offset + 2 < index.count; offset += 3) {
      const a = index.getX(offset)
      const b = index.getX(offset + 1)
      const c = index.getX(offset + 2)
      add(a, b)
      add(b, c)
      add(c, a)
    }
    count += Array.from(edges.values()).filter((uses) => uses > 2).length
  })
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

    const print = exportSceneToPrintStl(compiled.scene!, { scale: 100, compiled: true })
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

  test('compares the semantic full-house baseline union with the Manifold candidate', async () => {
    const fixture = createPrintGoldenHouseFixture()

    try {
      const prepared = prepareSceneForExport(fixture.root, fixture.nodes, { onlyVisible: true })
      const structure = filterPreparedSceneForPrintContent(
        prepared.scene,
        fixture.nodes,
        'structure',
      )
      const compiled = compileSemanticPrintShell(structure, fixture.nodes, { wallSolids: true })

      expect(compiled.status).toBe('compiled')
      expect(compiled.inputMeshCount).toBeGreaterThan(10)
      expect(compiled.sourceNodeIds).toEqual(fixture.structuralNodeIds)
      expect(compiled.scene).not.toBeNull()

      const print = exportSceneToPrintStl(compiled.scene!, { scale: 100, compiled: true })
      expect(print.report.status).toBe('blocked')
      expect(print.report.degenerateTriangleCount).toBeGreaterThan(0)
      expect(print.report.boundaryEdgeCount).toBeGreaterThan(0)
      expect(print.report.volumeMm3).toBeGreaterThan(0)

      const candidate = await compileSemanticPrintShellWithManifold(structure, fixture.nodes, {
        runner: compileManifoldMeshData,
      })
      expect(candidate.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual(
        [],
      )
      expect(candidate.backend).toBe('manifold-3d')
      expect(candidate.scene).not.toBeNull()
      expect(indexedNonManifoldEdgeCount(candidate.scene!)).toBe(0)
      expect(rayIntersectionCount(candidate.scene!, 0, 1.05, 0.8)).toBe(0)
      expect(rayIntersectionCount(candidate.scene!, 1.5, 1.05, 0.8)).toBeGreaterThanOrEqual(2)
      expect(rayIntersectionCount(candidate.scene!, 0, 3.9, 1, 1)).toBe(0)
      expect(rayIntersectionCount(candidate.scene!, 1.5, 3.9, 1, 1)).toBeGreaterThanOrEqual(2)

      const candidatePrint = exportSceneToPrintStl(candidate.scene!, {
        scale: 100,
        compiled: true,
        indexedTopology: true,
      })
      expect(
        candidatePrint.report.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'),
      ).toEqual([])
      expect(candidatePrint.report.degenerateTriangleCount).toBe(0)
      expect(candidatePrint.report.boundaryEdgeCount).toBe(0)
      expect(candidatePrint.report.nonManifoldEdgeCount).toBe(0)
      expect(candidatePrint.report.volumeMm3).toBeGreaterThan(0)
    } finally {
      fixture.dispose()
    }
  }, 15_000)

  test('blocks a Manifold worker failure without exporting display geometry', async () => {
    const source = structuralBox('wall_worker-failure', 0)
    const compiled = await compileSemanticPrintShellWithManifold(
      source,
      {},
      {
        runner: async () => {
          throw new Error('Worker unavailable')
        },
      },
    )

    expect(compiled.status).toBe('blocked')
    expect(compiled.scene).toBeNull()
    expect(compiled.sourceNodeIds).toEqual(['wall_worker-failure'])
    expect(compiled.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'manifold_worker_failed',
        message: 'Worker unavailable',
        severity: 'error',
      }),
    )
  })

  test('compiles a plane-bound wall independently of its flat 2D display geometry', async () => {
    const levelId = 'level_print-shell-2d'
    const wall = WallNode.parse({
      id: 'wall_print-shell-2d',
      parentId: levelId,
      start: [0, 0],
      end: [4, 0],
      thickness: 0.2,
    })
    const wallRoot = new THREE.Group()
    wallRoot.userData = { pascalId: wall.id }
    const flatDisplay = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.2))
    flatDisplay.rotation.x = -Math.PI / 2
    wallRoot.add(flatDisplay)
    const source = new THREE.Group()
    source.add(wallRoot)
    const nodes = {
      [levelId]: {
        object: 'node',
        id: levelId,
        type: 'level',
        parentId: null,
        children: [wall.id],
        height: 2.5,
        level: 0,
        visible: true,
      } as unknown as AnyNode,
      [wall.id]: wall,
    }

    const compiled = await compileSemanticPrintShellWithManifold(source, nodes, {
      runner: compileManifoldMeshData,
    })
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([])
    expect(compiled.status).toBe('compiled')
    expect(compiled.scene).not.toBeNull()

    const print = exportSceneToPrintStl(compiled.scene!, {
      scale: 100,
      compiled: true,
      indexedTopology: true,
    })
    expect(print.report.status).toBe('pass')
    expect(print.report.bounds?.height).toBeCloseTo(25, 4)
    expect(print.report.boundaryEdgeCount).toBe(0)
    expect(print.report.nonManifoldEdgeCount).toBe(0)
  })

  test('blocks unsupported semantic wall forms without falling back to display geometry', () => {
    const wall = WallNode.parse({
      id: 'wall_print-shell-curved',
      start: [0, 0],
      end: [4, 0],
      height: 2.5,
      thickness: 0.2,
      curveOffset: 0.5,
    })
    const wallRoot = new THREE.Group()
    wallRoot.userData = { pascalId: wall.id }
    const displayMesh = new THREE.Mesh(new THREE.BoxGeometry(4, 2.5, 0.2))
    displayMesh.position.set(2, 1.25, 0)
    wallRoot.add(displayMesh)
    const source = new THREE.Group()
    source.add(wallRoot)

    const compiled = compileSemanticPrintShell(source, { [wall.id]: wall }, { wallSolids: true })

    expect(compiled.status).toBe('blocked')
    expect(compiled.scene).toBeNull()
    expect(compiled.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'unsupported_wall_print_curve',
        severity: 'error',
        nodeIds: [wall.id],
      }),
    )
  })

  test('blocks the generated display gable roof from print export', () => {
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

  test('blocks unsupported semantic roof cuts without falling back to display geometry', () => {
    const roof = RoofSegmentNode.parse({
      id: 'rseg_print-shell-trimmed',
      roofType: 'gable',
      width: 4,
      depth: 3,
      wallHeight: 0.5,
      pitch: 30,
      wallThickness: 0.15,
      deckThickness: 0.1,
      overhang: 0.3,
      shingleThickness: 0.05,
      trim: { left: 0.25 },
    })
    const roofRoot = new THREE.Group()
    roofRoot.userData = { pascalId: roof.id }
    roofRoot.add(new THREE.Mesh(generateRoofSegmentGeometry(roof)))
    const source = new THREE.Group()
    source.add(roofRoot)

    const compiled = compileSemanticPrintShell(source, { [roof.id]: roof })

    expect(compiled.status).toBe('blocked')
    expect(compiled.scene).toBeNull()
    expect(compiled.sourceNodeIds).toEqual([roof.id])
    expect(compiled.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'unsupported_roof_print_trim',
        severity: 'error',
        nodeIds: [roof.id],
      }),
    )
  })

  test('compiles canonical roof modules into deterministic manifold print shells', () => {
    for (const roofType of ROOF_TYPES) {
      const roof = RoofSegmentNode.parse({
        id: `rseg_print-shell-${roofType}`,
        roofType,
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

      const compiled = compileSemanticPrintShell(source, { [roof.id]: roof })
      expect(compiled.status).toBe('compiled')
      expect(compiled.inputMeshCount).toBe(1)
      expect(compiled.sourceNodeIds).toEqual([roof.id])
      expect(compiled.scene).not.toBeNull()

      const print = exportSceneToPrintStl(compiled.scene!, { scale: 100, compiled: true })
      expect(print.report.status).toBe('pass')
      expect(print.report.degenerateTriangleCount).toBe(0)
      expect(print.report.boundaryEdgeCount).toBe(0)
      expect(print.report.nonManifoldEdgeCount).toBe(0)
      expect(print.report.volumeMm3).toBeGreaterThan(0)
    }

    const roof = RoofSegmentNode.parse({
      id: 'rseg_print-shell-deterministic',
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
    const firstSource = new THREE.Group()
    const firstRoof = new THREE.Group()
    firstRoof.userData = { pascalId: roof.id }
    firstRoof.add(new THREE.Mesh(generateRoofSegmentGeometry(roof)))
    firstSource.add(firstRoof)
    const secondSource = firstSource.clone(true)
    const firstCompiled = compileSemanticPrintShell(firstSource, { [roof.id]: roof })
    const secondCompiled = compileSemanticPrintShell(secondSource, { [roof.id]: roof })
    const firstPrint = exportSceneToPrintStl(firstCompiled.scene!, {
      scale: 100,
      compiled: true,
    })
    const secondPrint = exportSceneToPrintStl(secondCompiled.scene!, {
      scale: 100,
      compiled: true,
    })

    expect(firstPrint.report.bounds?.width).toBeCloseTo(46.6962, 3)
    expect(firstPrint.report.bounds?.depth).toBeCloseTo(37.1962, 3)
    expect(firstPrint.report.bounds?.height).toBeCloseTo(15.3923, 3)
    expect(firstPrint.report.volumeMm3).toBeCloseTo(4_066.52, 1)
    expect(new Uint8Array(firstPrint.buffer)).toEqual(new Uint8Array(secondPrint.buffer))
  })
})
