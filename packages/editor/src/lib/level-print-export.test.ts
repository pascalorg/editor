import { afterEach, describe, expect, test } from 'bun:test'
import { type AnyNode, RoofSegmentNode, registerNode, sceneRegistry } from '@pascal-app/core'
import { generateRoofSegmentGeometry } from '@pascal-app/viewer'
import { XMLParser } from 'fast-xml-parser'
import { strFromU8, unzipSync } from 'fflate'
import * as THREE from 'three'
import { prepareSceneForExport } from './glb-export'
import { exportSceneLevelsForPrint } from './level-print-export'
import { filterPreparedSceneForPrintContent } from './print-content-scope'
import { compileSemanticPrintShell } from './print-shell-compiler'

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

function binaryStlBounds(buffer: Uint8Array): {
  triangles: number
  min: THREE.Vector3
  max: THREE.Vector3
  size: THREE.Vector3
} {
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

  return {
    triangles,
    min: bounds.min.clone(),
    max: bounds.max.clone(),
    size: bounds.getSize(new THREE.Vector3()),
  }
}

function asArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value]
}

function twoLevelFixture() {
  const root = new THREE.Group()
  const building = new THREE.Group()
  const ground = new THREE.Group()
  const upper = new THREE.Group()
  const groundStructure = new THREE.Group()
  const upperStructure = new THREE.Group()
  const groundSolid = new THREE.Mesh(new THREE.BoxGeometry(10, 3, 8))
  const upperSolid = new THREE.Mesh(new THREE.BoxGeometry(8, 2, 6))
  groundSolid.position.y = 1.5
  upperSolid.position.y = 1
  groundStructure.add(groundSolid)
  upperStructure.add(upperSolid)
  ground.add(groundStructure)
  upper.add(upperStructure)
  upper.position.y = 3
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
      height: 3,
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
      height: 2,
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

  return { root, building, ground, upper, groundStructure, upperStructure, nodes }
}

describe('per-level print STL export', () => {
  afterEach(() => {
    sceneRegistry.nodes.clear()
  })

  test('packages one bed-normalized, scale-correct STL per visible level', async () => {
    const fixture = twoLevelFixture()
    const prepared = prepareSceneForExport(fixture.root, fixture.nodes)

    const bundle = await exportSceneLevelsForPrint(prepared.scene, fixture.nodes, { scale: 100 })
    const files = unzipSync(bundle.data)
    const ground = binaryStlBounds(files['01_ground.stl']!)
    const upper = binaryStlBounds(files['02_upper.stl']!)

    expect(Object.keys(files)).toEqual(['01_ground.stl', '02_upper.stl'])
    expect(bundle.report.status).toBe('pass')
    expect(bundle.report.partCount).toBe(2)
    expect(bundle.report.parts.map((part) => part.kind)).toEqual(['level', 'level'])
    expect(bundle.report.parts.map((part) => part.sourceBaseMeters)).toEqual([0, 3])
    expect(ground.triangles).toBe(12)
    expect(ground.min.z).toBeCloseTo(0, 6)
    expect(ground.size.x).toBeCloseTo(100, 4)
    expect(ground.size.y).toBeCloseTo(80, 4)
    expect(ground.size.z).toBeCloseTo(30, 4)
    expect(upper.triangles).toBe(12)
    expect(upper.min.z).toBeCloseTo(0, 6)
    expect(upper.size.x).toBeCloseTo(80, 4)
    expect(upper.size.y).toBeCloseTo(60, 4)
    expect(upper.size.z).toBeCloseTo(20, 4)
  })

  test('blocks geometry that crosses or floats above its stored level base', async () => {
    const fixture = twoLevelFixture()
    fixture.groundStructure.position.y = -0.25
    fixture.upperStructure.position.y = 0.5
    const prepared = prepareSceneForExport(fixture.root, fixture.nodes)

    const bundle = await exportSceneLevelsForPrint(prepared.scene, fixture.nodes, { scale: 100 })
    const [ground, upper] = bundle.report.parts

    expect(bundle.report.status).toBe('blocked')
    expect(ground?.sourceBaseMeters).toBe(0)
    expect(ground?.report.bounds?.min.z).toBeCloseTo(-2.5, 5)
    expect(ground?.report.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'level_geometry_below_base',
        nodeIds: ['level_ground'],
      }),
    )
    expect(upper?.sourceBaseMeters).toBe(3)
    expect(upper?.report.bounds?.min.z).toBeCloseTo(5, 5)
    expect(upper?.report.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'level_geometry_detached_from_base',
        nodeIds: ['level_upper'],
      }),
    )
  })

  test('orders a basement first and honors additive stored base elevation', async () => {
    const fixture = twoLevelFixture()
    fixture.nodes.level_ground = {
      ...fixture.nodes.level_ground!,
      name: 'Basement',
      level: -1,
      baseElevation: -0.4,
    } as AnyNode
    fixture.nodes.level_upper = {
      ...fixture.nodes.level_upper!,
      name: 'Ground',
      level: 0,
    } as AnyNode
    fixture.ground.position.y = -0.4
    fixture.upper.position.y = 2.6
    const prepared = prepareSceneForExport(fixture.root, fixture.nodes)

    const bundle = await exportSceneLevelsForPrint(prepared.scene, fixture.nodes, { scale: 100 })
    const files = unzipSync(bundle.data)

    expect(Object.keys(files)).toEqual(['01_basement.stl', '02_ground.stl'])
    expect(bundle.report.parts.map((part) => part.levelId)).toEqual(['level_ground', 'level_upper'])
    expect(bundle.report.parts.map((part) => part.sourceBaseMeters)).toEqual([-0.4, 2.6])
    expect(binaryStlBounds(files['01_basement.stl']!).min.z).toBeCloseTo(0, 6)
    expect(binaryStlBounds(files['02_ground.stl']!).min.z).toBeCloseTo(0, 6)
  })

  test('omits and blocks an unsplit stair that spans two levels', async () => {
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
    const bundle = await exportSceneLevelsForPrint(prepared.scene, fixture.nodes, { scale: 100 })

    expect(bundle.report.status).toBe('blocked')
    expect(bundle.report.excludedNodeIds).toEqual(['stair_main'])
    expect(bundle.report.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'unsplit_spanning_node',
    )
    expect(bundle.report.parts.map((part) => part.report.triangleCount)).toEqual([12, 12])
  })

  test('does not create a part for a semantically hidden level', async () => {
    const fixture = twoLevelFixture()
    fixture.nodes.level_upper = {
      ...fixture.nodes.level_upper!,
      visible: false,
    } as AnyNode

    const prepared = prepareSceneForExport(fixture.root, fixture.nodes)
    const bundle = await exportSceneLevelsForPrint(prepared.scene, fixture.nodes, { scale: 100 })
    const files = unzipSync(bundle.data)

    expect(Object.keys(files)).toEqual(['01_ground.stl'])
    expect(bundle.report.parts.map((part) => part.levelId)).toEqual(['level_ground'])
  })

  test('applies structure scope before partitioning level files', async () => {
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
    const bundle = await exportSceneLevelsForPrint(structure, fixture.nodes, { scale: 100 })

    expect(bundle.report.parts.map((part) => part.report.triangleCount)).toEqual([12, 12])
    expect(bundle.report.status).toBe('pass')
  })

  test('uses the asynchronous shell compiler before exporting a level part', async () => {
    const root = new THREE.Group()
    const building = new THREE.Group()
    building.userData = { pascalId: 'building_roof-print' }
    const level = new THREE.Group()
    level.userData = { pascalId: 'level_roof-print' }
    const roof = RoofSegmentNode.parse({
      id: 'rseg_level-print',
      parentId: 'level_roof-print',
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
    root.add(building)
    building.add(level)
    level.add(roofRoot)

    const nodes: Record<string, AnyNode> = {
      'building_roof-print': {
        object: 'node',
        id: 'building_roof-print',
        type: 'building',
        parentId: null,
        children: ['level_roof-print'],
      } as unknown as AnyNode,
      'level_roof-print': {
        object: 'node',
        id: 'level_roof-print',
        type: 'level',
        name: 'Roof',
        level: 0,
        parentId: 'building_roof-print',
        children: [roof.id],
        visible: true,
      } as unknown as AnyNode,
      [roof.id]: roof,
    }

    let compileCalls = 0
    const raw = await exportSceneLevelsForPrint(root, nodes, { scale: 100 })
    const compiled = await exportSceneLevelsForPrint(root, nodes, {
      scale: 100,
      compileShells: true,
      compileShell: async (source, compilerNodes) => {
        compileCalls += 1
        return compileSemanticPrintShell(source, compilerNodes)
      },
    })
    const part = compiled.report.parts[0]!

    expect(raw.report.parts[0]?.report.status).toBe('blocked')
    expect(compileCalls).toBe(1)
    expect(compiled.report.status).toBe('pass')
    expect(part.report.status).toBe('pass')
    expect(part.report.bounds?.width).toBeCloseTo(46.6962, 3)
    expect(part.report.bounds?.depth).toBeCloseTo(37.1962, 3)
    expect(part.report.bounds?.height).toBeCloseTo(15.3923, 3)
    expect(part.report.boundaryEdgeCount).toBe(0)
    expect(part.report.nonManifoldEdgeCount).toBe(0)
    expect(part.report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['baseline_compiler', 'compiler_limits']),
    )
    expect(part.report.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'compiler_pending',
    )
  })

  test('produces deterministic archive bytes for the same level parts', async () => {
    const fixture = twoLevelFixture()
    const prepared = prepareSceneForExport(fixture.root, fixture.nodes)

    const first = await exportSceneLevelsForPrint(prepared.scene, fixture.nodes, { scale: 50 })
    const second = await exportSceneLevelsForPrint(prepared.scene, fixture.nodes, { scale: 50 })

    expect(first.data).toEqual(second.data)
  })

  test('prepends an optional physical-size plinth derived from the lowest level bounds', async () => {
    const fixture = twoLevelFixture()
    const prepared = prepareSceneForExport(fixture.root, fixture.nodes)

    const bundle = await exportSceneLevelsForPrint(prepared.scene, fixture.nodes, {
      scale: 100,
      plinth: { marginMm: 2, thicknessMm: 3 },
    })
    const repeated = await exportSceneLevelsForPrint(prepared.scene, fixture.nodes, {
      scale: 100,
      plinth: { marginMm: 2, thicknessMm: 3 },
    })
    const files = unzipSync(bundle.data)
    const plinth = binaryStlBounds(files['00_plinth.stl']!)

    expect(Object.keys(files)).toEqual(['00_plinth.stl', '01_ground.stl', '02_upper.stl'])
    expect(bundle.report.parts.map((part) => part.kind)).toEqual(['plinth', 'level', 'level'])
    expect(bundle.report.parts[0]?.levelId).toBe('level_ground')
    expect(plinth.triangles).toBe(12)
    expect(plinth.size.x).toBeCloseTo(104, 4)
    expect(plinth.size.y).toBeCloseTo(84, 4)
    expect(plinth.size.z).toBeCloseTo(3, 4)
    expect(bundle.data).toEqual(repeated.data)
  })

  test('packages named parts in one non-overlapping millimeter-unit 3MF plate mesh', async () => {
    const fixture = twoLevelFixture()
    fixture.nodes.level_ground = {
      ...fixture.nodes.level_ground!,
      name: 'Ground & Entry',
    } as AnyNode
    const prepared = prepareSceneForExport(fixture.root, fixture.nodes)
    const options = {
      scale: 100,
      format: '3mf' as const,
      plinth: { marginMm: 2, thicknessMm: 3 },
    }

    const bundle = await exportSceneLevelsForPrint(prepared.scene, fixture.nodes, options)
    const repeated = await exportSceneLevelsForPrint(prepared.scene, fixture.nodes, options)
    const files = unzipSync(bundle.data)
    const xml = strFromU8(files['3D/3dmodel.model']!)
    const model = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' }).parse(
      xml,
    ).model
    const object = asArray<Record<string, unknown>>(model.resources.object)[0]!
    const items = asArray<Record<string, string>>(model.build.item)
    const metadata = asArray<Record<string, string>>(model.metadata)
    const partManifest = JSON.parse(
      metadata.find((entry) => entry.name === 'Pascal.PartManifest')!['#text']!,
    ) as Array<{
      name: string
      vertexStart: number
      vertexCount: number
      triangleStart: number
      triangleCount: number
    }>
    const mesh = object.mesh as {
      vertices: { vertex: Record<string, string> | Record<string, string>[] }
      triangles: { triangle: Record<string, string> | Record<string, string>[] }
    }
    const vertices = asArray(mesh.vertices.vertex)
    const triangles = asArray(mesh.triangles.triangle)

    expect(Object.keys(files)).toEqual(['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model'])
    expect(model.unit).toBe('millimeter')
    expect(object.name).toBe('Pascal level parts')
    expect(partManifest.map((part) => part.name)).toEqual([
      '00 Plinth',
      '01 Ground & Entry',
      '02 Upper',
    ])
    expect(items.map((item) => item.objectid)).toEqual(['1'])
    expect(bundle.report.format).toBe('3mf')
    expect(bundle.report.parts.map((part) => part.filename)).toEqual([null, null, null])
    expect(bundle.report.parts.map((part) => part.objectName)).toEqual([
      '00 Plinth',
      '01 Ground & Entry',
      '02 Upper',
    ])

    const expectedSizes = [
      [104, 84, 3],
      [100, 80, 30],
      [80, 60, 20],
    ]
    let previousMaxX = Number.NEGATIVE_INFINITY
    for (const [index, part] of partManifest.entries()) {
      const bounds = new THREE.Box3()
      for (const vertex of vertices.slice(part.vertexStart, part.vertexStart + part.vertexCount)) {
        bounds.expandByPoint(
          new THREE.Vector3(Number(vertex.x), Number(vertex.y), Number(vertex.z)),
        )
      }
      const size = bounds.getSize(new THREE.Vector3())

      expect(part.triangleCount).toBe(12)
      expect(
        triangles.slice(part.triangleStart, part.triangleStart + part.triangleCount),
      ).toHaveLength(12)
      expect(size.x).toBeCloseTo(expectedSizes[index]![0]!, 5)
      expect(size.y).toBeCloseTo(expectedSizes[index]![1]!, 5)
      expect(size.z).toBeCloseTo(expectedSizes[index]![2]!, 5)
      expect(bounds.min.z).toBeCloseTo(0, 9)
      if (index > 0) expect(bounds.min.x - previousMaxX).toBeCloseTo(5, 5)
      previousMaxX = bounds.max.x
    }
    expect(items[0]?.transform).toBeUndefined()
    expect(bundle.data).toEqual(repeated.data)
  })
})
