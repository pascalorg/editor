import { describe, expect, test } from 'bun:test'
import { XMLParser } from 'fast-xml-parser'
import { strFromU8, unzipSync } from 'fflate'
import * as THREE from 'three'
import { prepareSceneForExport } from './glb-export'
import { exportSceneLevelsForPrint } from './level-print-export'
import { filterPreparedSceneForPrintContent } from './print-content-scope'
import {
  createPrintGoldenHouseFixture,
  PRINT_GOLDEN_HOUSE_IDS,
} from './print-golden-house.test-fixture'
import { compileManifoldMeshData } from './print-shell-compiler-manifold-core'
import { compileSemanticPrintShellWithManifold } from './print-shell-compiler-manifold-worker'

function identityIds(root: THREE.Object3D): string[] {
  const ids: string[] = []
  root.traverse((object) => {
    if (typeof object.userData.pascalId === 'string') ids.push(object.userData.pascalId)
  })
  return ids.sort()
}

function objectByIdentity(root: THREE.Object3D, id: string): THREE.Object3D {
  let match: THREE.Object3D | null = null
  root.traverse((object) => {
    if (object.userData.pascalId === id) match = object
  })
  if (!match) throw new Error(`Missing prepared object ${id}`)
  return match
}

function rayIntersectionCount(
  root: THREE.Object3D,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  far: number,
): number {
  root.updateMatrixWorld(true)
  const raycaster = new THREE.Raycaster(origin, direction.normalize(), 0, far)
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

function asArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value]
}

function packageObjectSizes(data: Uint8Array): Array<{ name: string; size: THREE.Vector3 }> {
  const files = unzipSync(data)
  const xml = strFromU8(files['3D/3dmodel.model']!)
  const model = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' }).parse(xml).model
  const objects = asArray<Record<string, unknown>>(model.resources.object)
  const items = asArray<Record<string, string>>(model.build.item)
  return objects.map((object, index) => {
    const mesh = object.mesh as { vertices: { vertex: Record<string, string>[] } }
    const vertices = asArray(mesh.vertices.vertex)
    const transformValue = items[index]?.transform
    if (!transformValue) throw new Error(`Missing build transform for ${String(object.name)}`)
    const transform = transformValue.split(' ').map(Number)
    const translation = new THREE.Vector3(transform[9]!, transform[10]!, transform[11]!)
    const bounds = new THREE.Box3()
    for (const vertex of vertices) {
      bounds.expandByPoint(
        new THREE.Vector3(Number(vertex.x), Number(vertex.y), Number(vertex.z)).add(translation),
      )
    }
    return { name: String(object.name), size: bounds.getSize(new THREE.Vector3()) }
  })
}

const compileGoldenShell = (
  source: THREE.Object3D,
  nodes: Parameters<typeof exportSceneLevelsForPrint>[1],
) => compileSemanticPrintShellWithManifold(source, nodes, { runner: compileManifoldMeshData })

describe('print golden house', () => {
  test('consolidates hidden-ancestor visibility and structure-only scope', () => {
    const fixture = createPrintGoldenHouseFixture()
    try {
      const prepared = prepareSceneForExport(fixture.root, fixture.nodes, { onlyVisible: true })
      const preparedIds = identityIds(prepared.scene)
      expect(preparedIds).toContain(PRINT_GOLDEN_HOUSE_IDS.visibleFurniture)
      expect(preparedIds).not.toContain(PRINT_GOLDEN_HOUSE_IDS.hiddenFurnitureParent)
      expect(preparedIds).not.toContain(PRINT_GOLDEN_HOUSE_IDS.hiddenFurnitureChild)

      const structure = filterPreparedSceneForPrintContent(
        prepared.scene,
        fixture.nodes,
        'structure',
      )
      const structureIds = identityIds(structure)
      expect(structureIds).not.toContain(PRINT_GOLDEN_HOUSE_IDS.visibleFurniture)
      expect(structureIds).toEqual(
        expect.arrayContaining([
          PRINT_GOLDEN_HOUSE_IDS.groundLevel,
          PRINT_GOLDEN_HOUSE_IDS.upperLevel,
          ...fixture.structuralNodeIds,
        ]),
      )
    } finally {
      fixture.dispose()
    }
  })

  test('preserves door and window voids in the final Manifold level shells', async () => {
    const fixture = createPrintGoldenHouseFixture()
    try {
      const prepared = prepareSceneForExport(fixture.root, fixture.nodes, { onlyVisible: true })
      const structure = filterPreparedSceneForPrintContent(
        prepared.scene,
        fixture.nodes,
        'structure',
      )
      const ground = await compileGoldenShell(
        objectByIdentity(structure, PRINT_GOLDEN_HOUSE_IDS.groundLevel),
        fixture.nodes,
      )
      const upper = await compileGoldenShell(
        objectByIdentity(structure, PRINT_GOLDEN_HOUSE_IDS.upperLevel),
        fixture.nodes,
      )

      expect(ground.status).toBe('compiled')
      expect(upper.status).toBe('compiled')
      expect(ground.sourceNodeIds).toEqual(fixture.groundStructuralNodeIds)
      expect(upper.sourceNodeIds).toEqual(fixture.upperStructuralNodeIds)
      expect(
        rayIntersectionCount(
          ground.scene!,
          new THREE.Vector3(0, 1.05, -2),
          new THREE.Vector3(0, 0, 1),
          0.8,
        ),
      ).toBe(0)
      expect(
        rayIntersectionCount(
          ground.scene!,
          new THREE.Vector3(1.5, 1.05, -2),
          new THREE.Vector3(0, 0, 1),
          0.8,
        ),
      ).toBeGreaterThanOrEqual(2)
      expect(
        rayIntersectionCount(
          upper.scene!,
          new THREE.Vector3(0, 3.9, 1),
          new THREE.Vector3(0, 0, 1),
          1,
        ),
      ).toBe(0)
      expect(
        rayIntersectionCount(
          upper.scene!,
          new THREE.Vector3(1.5, 3.9, 1),
          new THREE.Vector3(0, 0, 1),
          1,
        ),
      ).toBeGreaterThanOrEqual(2)
    } finally {
      fixture.dispose()
    }
  }, 15_000)

  test('emits deterministic two-level 3MF parts and plinth from the same semantic house', async () => {
    const fixture = createPrintGoldenHouseFixture()
    try {
      const prepared = prepareSceneForExport(fixture.root, fixture.nodes, { onlyVisible: true })
      const structure = filterPreparedSceneForPrintContent(
        prepared.scene,
        fixture.nodes,
        'structure',
      )
      const options = {
        scale: 100,
        format: '3mf' as const,
        plinth: { marginMm: 2, thicknessMm: 3 },
        compileShells: true,
        compileShell: compileGoldenShell,
      }
      const first = await exportSceneLevelsForPrint(structure, fixture.nodes, options)
      const second = await exportSceneLevelsForPrint(structure, fixture.nodes, {
        ...options,
        minimumFeatureMm: 1.8,
      })

      expect(first.report.status).toBe('pass')
      expect(first.report.parts.map((part) => part.objectName)).toEqual([
        '00 Plinth',
        '01 Ground',
        '02 Upper',
      ])
      expect(first.report.parts.map((part) => part.sourceBaseMeters)).toEqual([null, 0, 2.5])
      expect(first.report.parts.map((part) => part.report.minimumFeatureThicknessMm)).toEqual([
        3, 2, 1.5,
      ])
      for (const part of first.report.parts) {
        expect(part.report.status).toBe('pass')
        expect(part.report.degenerateTriangleCount).toBe(0)
        expect(part.report.boundaryEdgeCount).toBe(0)
        expect(part.report.nonManifoldEdgeCount).toBe(0)
        expect(part.report.volumeMm3).toBeGreaterThan(0)
        expect(part.report.bounds?.min.z).toBeCloseTo(0, 5)
      }
      expect(first.report.parts[1]?.report.diagnostics).toContainEqual(
        expect.objectContaining({ nodeIds: fixture.groundStructuralNodeIds }),
      )
      expect(first.report.parts[2]?.report.diagnostics).toContainEqual(
        expect.objectContaining({ nodeIds: fixture.upperStructuralNodeIds }),
      )
      expect(second.report.status).toBe('blocked')
      expect(second.report.parts.map((part) => part.report.status)).toEqual([
        'pass',
        'pass',
        'blocked',
      ])
      expect(second.report.parts[2]?.report.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'feature_below_target',
          nodeIds: [PRINT_GOLDEN_HOUSE_IDS.roof],
        }),
      )

      const objects = packageObjectSizes(first.data)
      expect(objects.map((object) => object.name)).toEqual(['00 Plinth', '01 Ground', '02 Upper'])
      expect(objects[0]?.size.x).toBeCloseTo(46, 4)
      expect(objects[0]?.size.y).toBeCloseTo(36, 4)
      expect(objects[0]?.size.z).toBeCloseTo(3, 4)
      expect(objects[1]?.size.x).toBeCloseTo(42, 4)
      expect(objects[1]?.size.y).toBeCloseTo(32, 4)
      expect(objects[1]?.size.z).toBeCloseTo(25, 4)
      expect(objects[2]?.size.x).toBeCloseTo(46.6962, 3)
      expect(objects[2]?.size.y).toBeCloseTo(37.1962, 3)
      expect(objects[2]?.size.z).toBeCloseTo(40.3923, 3)
      expect(first.data).toEqual(second.data)
    } finally {
      fixture.dispose()
    }
  }, 30_000)
})
