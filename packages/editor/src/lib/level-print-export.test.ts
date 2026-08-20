import { afterEach, describe, expect, test } from 'bun:test'
import { type AnyNode, registerNode, sceneRegistry } from '@pascal-app/core'
import { unzipSync } from 'fflate'
import * as THREE from 'three'
import { prepareSceneForExport } from './glb-export'
import { exportSceneLevelsToPrintStl } from './level-print-export'
import { filterPreparedSceneForPrintContent } from './print-content-scope'

function registerFixtureKind(category: 'structure' | 'furnish'): string {
  const kind = `print-level-${category}-${crypto.randomUUID()}`
  registerNode({
    kind,
    schemaVersion: 1,
    category,
    defaults: () => ({}),
    capabilities: {},
  } as never)
  return kind
}

function binaryStlBounds(buffer: Uint8Array): { triangles: number; size: THREE.Vector3 } {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
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

  return { triangles, size: bounds.getSize(new THREE.Vector3()) }
}

function twoLevelFixture() {
  const root = new THREE.Group()
  const building = new THREE.Group()
  const ground = new THREE.Group()
  const upper = new THREE.Group()
  const groundStructure = new THREE.Group()
  const upperStructure = new THREE.Group()
  groundStructure.add(new THREE.Mesh(new THREE.BoxGeometry(10, 3, 8)))
  upperStructure.add(new THREE.Mesh(new THREE.BoxGeometry(8, 2, 6)))
  ground.add(groundStructure)
  upper.add(upperStructure)
  ground.position.y = 1.5
  upper.position.y = 4
  root.add(building)
  building.add(ground, upper)

  const structureKind = registerFixtureKind('structure')
  sceneRegistry.nodes.set('building_main', building)
  sceneRegistry.nodes.set('level_ground', ground)
  sceneRegistry.nodes.set('level_upper', upper)
  sceneRegistry.nodes.set('structure_ground', groundStructure)
  sceneRegistry.nodes.set('structure_upper', upperStructure)

  const nodes: Record<string, AnyNode> = {
    building_main: {
      object: 'node',
      id: 'building_main',
      type: 'building',
      parentId: null,
      children: ['level_ground', 'level_upper'],
    } as unknown as AnyNode,
    level_ground: {
      object: 'node',
      id: 'level_ground',
      type: 'level',
      name: 'Ground',
      level: 0,
      parentId: 'building_main',
      children: ['structure_ground'],
      visible: true,
    } as unknown as AnyNode,
    level_upper: {
      object: 'node',
      id: 'level_upper',
      type: 'level',
      name: 'Upper',
      level: 1,
      parentId: 'building_main',
      children: ['structure_upper'],
      visible: true,
    } as unknown as AnyNode,
    structure_ground: {
      object: 'node',
      id: 'structure_ground',
      type: structureKind,
      parentId: 'level_ground',
      visible: true,
    } as unknown as AnyNode,
    structure_upper: {
      object: 'node',
      id: 'structure_upper',
      type: structureKind,
      parentId: 'level_upper',
      visible: true,
    } as unknown as AnyNode,
  }

  return { root, building, ground, upper, nodes }
}

describe('per-level print STL export', () => {
  afterEach(() => {
    sceneRegistry.nodes.clear()
  })

  test('packages one bed-normalized, scale-correct STL per visible level', () => {
    const fixture = twoLevelFixture()
    const prepared = prepareSceneForExport(fixture.root, fixture.nodes)

    const bundle = exportSceneLevelsToPrintStl(prepared.scene, fixture.nodes, { scale: 100 })
    const files = unzipSync(bundle.archive)
    const ground = binaryStlBounds(files['01_ground.stl']!)
    const upper = binaryStlBounds(files['02_upper.stl']!)

    expect(Object.keys(files)).toEqual(['01_ground.stl', '02_upper.stl'])
    expect(bundle.report.status).toBe('pass')
    expect(bundle.report.partCount).toBe(2)
    expect(bundle.report.parts.map((part) => part.kind)).toEqual(['level', 'level'])
    expect(ground.triangles).toBe(12)
    expect(ground.size.x).toBeCloseTo(100, 4)
    expect(ground.size.y).toBeCloseTo(80, 4)
    expect(ground.size.z).toBeCloseTo(30, 4)
    expect(upper.triangles).toBe(12)
    expect(upper.size.x).toBeCloseTo(80, 4)
    expect(upper.size.y).toBeCloseTo(60, 4)
    expect(upper.size.z).toBeCloseTo(20, 4)
  })

  test('omits and blocks an unsplit stair that spans two levels', () => {
    const fixture = twoLevelFixture()
    const stair = new THREE.Group()
    stair.add(new THREE.Mesh(new THREE.BoxGeometry(1, 3, 2)))
    fixture.ground.add(stair)
    sceneRegistry.nodes.set('stair_main', stair)
    fixture.nodes.stair_main = {
      object: 'node',
      id: 'stair_main',
      type: 'stair',
      parentId: 'level_ground',
      fromLevelId: 'level_ground',
      toLevelId: 'level_upper',
      children: [],
      visible: true,
    } as unknown as AnyNode

    const prepared = prepareSceneForExport(fixture.root, fixture.nodes)
    const bundle = exportSceneLevelsToPrintStl(prepared.scene, fixture.nodes, { scale: 100 })

    expect(bundle.report.status).toBe('blocked')
    expect(bundle.report.excludedNodeIds).toEqual(['stair_main'])
    expect(bundle.report.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'unsplit_spanning_node',
    )
    expect(bundle.report.parts.map((part) => part.report.triangleCount)).toEqual([12, 12])
  })

  test('does not create a part for a semantically hidden level', () => {
    const fixture = twoLevelFixture()
    fixture.nodes.level_upper = {
      ...fixture.nodes.level_upper!,
      visible: false,
    } as AnyNode

    const prepared = prepareSceneForExport(fixture.root, fixture.nodes)
    const bundle = exportSceneLevelsToPrintStl(prepared.scene, fixture.nodes, { scale: 100 })
    const files = unzipSync(bundle.archive)

    expect(Object.keys(files)).toEqual(['01_ground.stl'])
    expect(bundle.report.parts.map((part) => part.levelId)).toEqual(['level_ground'])
  })

  test('applies structure scope before partitioning level files', () => {
    const fixture = twoLevelFixture()
    const furniture = new THREE.Group()
    furniture.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)))
    fixture.ground.add(furniture)
    sceneRegistry.nodes.set('chair_ground', furniture)
    fixture.nodes.chair_ground = {
      object: 'node',
      id: 'chair_ground',
      type: registerFixtureKind('furnish'),
      parentId: 'level_ground',
      visible: true,
    } as unknown as AnyNode

    const prepared = prepareSceneForExport(fixture.root, fixture.nodes)
    const structure = filterPreparedSceneForPrintContent(prepared.scene, fixture.nodes, 'structure')
    const bundle = exportSceneLevelsToPrintStl(structure, fixture.nodes, { scale: 100 })

    expect(bundle.report.parts.map((part) => part.report.triangleCount)).toEqual([12, 12])
    expect(bundle.report.status).toBe('pass')
  })

  test('produces deterministic archive bytes for the same level parts', () => {
    const fixture = twoLevelFixture()
    const prepared = prepareSceneForExport(fixture.root, fixture.nodes)

    const first = exportSceneLevelsToPrintStl(prepared.scene, fixture.nodes, { scale: 50 })
    const second = exportSceneLevelsToPrintStl(prepared.scene, fixture.nodes, { scale: 50 })

    expect(first.archive).toEqual(second.archive)
  })

  test('prepends an optional physical-size plinth derived from the lowest level bounds', () => {
    const fixture = twoLevelFixture()
    const prepared = prepareSceneForExport(fixture.root, fixture.nodes)

    const bundle = exportSceneLevelsToPrintStl(prepared.scene, fixture.nodes, {
      scale: 100,
      plinth: { marginMm: 2, thicknessMm: 3 },
    })
    const repeated = exportSceneLevelsToPrintStl(prepared.scene, fixture.nodes, {
      scale: 100,
      plinth: { marginMm: 2, thicknessMm: 3 },
    })
    const files = unzipSync(bundle.archive)
    const plinth = binaryStlBounds(files['00_plinth.stl']!)

    expect(Object.keys(files)).toEqual(['00_plinth.stl', '01_ground.stl', '02_upper.stl'])
    expect(bundle.report.parts.map((part) => part.kind)).toEqual(['plinth', 'level', 'level'])
    expect(bundle.report.parts[0]?.levelId).toBe('level_ground')
    expect(plinth.triangles).toBe(12)
    expect(plinth.size.x).toBeCloseTo(104, 4)
    expect(plinth.size.y).toBeCloseTo(84, 4)
    expect(plinth.size.z).toBeCloseTo(3, 4)
    expect(bundle.archive).toEqual(repeated.archive)
  })
})
