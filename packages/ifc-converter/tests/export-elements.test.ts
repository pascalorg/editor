import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type AnyNode,
  ColumnNode,
  type ImportedMeshNode,
  LevelNode,
  resolveStairWinder,
  StairNode,
  StairSegmentNode,
  type WallNode,
  WallNode as WallSchema,
} from '@pascal-app/core'
import * as WebIFC from 'web-ifc'
import { convertIfcToPascal } from '../src'
import { buildIfcExport, ifcGuidFromSeed, isIfcGuid } from '../src/export'
import { groupedElementsScene } from './export-scenes'
import { expectWellFormedStep } from './export-step-check'

const wasmPath = `${dirname(fileURLToPath(import.meta.resolve('web-ifc')))}/`
const EPOCH = new Date(Date.UTC(2026, 0, 1))
const MM = 3
const api = new WebIFC.IfcAPI()
const quietLog = console.log

beforeAll(async () => {
  api.SetWasmPath(wasmPath, true)
  await api.Init()
  console.log = () => {}
})
afterAll(() => {
  console.log = quietLog
})

function idsOf(modelID: number, type: number): number[] {
  const vector = api.GetLineIDsWithType(modelID, type)
  return Array.from({ length: vector.size() }, (_, i) => vector.get(i))
}

function withModel<T>(ifc: string, run: (modelID: number) => T): T {
  const modelID = api.OpenModel(new TextEncoder().encode(ifc))
  try {
    return run(modelID)
  } finally {
    api.CloseModel(modelID)
  }
}

function worldBounds(mesh: ImportedMeshNode) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const primitive of mesh.primitives) {
    for (let i = 0; i < primitive.positions.length; i += 3) {
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis]!, primitive.positions[i + axis]!)
        max[axis] = Math.max(max[axis]!, primitive.positions[i + axis]!)
      }
    }
  }
  return { min, max }
}

describe('GlobalIds', () => {
  test('are deterministic, valid and distinct per seed', () => {
    const a = ifcGuidFromSeed('wall_abc')
    expect(a).toBe(ifcGuidFromSeed('wall_abc'))
    expect(isIfcGuid(a)).toBe(true)
    expect(ifcGuidFromSeed('wall_abd')).not.toBe(a)
  })

  test('reuse an imported GUID once, then fall back to the node id', () => {
    const imported = '2O2Fr$t4X7Zf8NOew3FLOH'
    const level = LevelNode.parse({ id: 'level_g', height: 3 })
    const wall = (id: string) =>
      WallSchema.parse({
        id,
        parentId: level.id,
        start: [0, 0],
        end: [2, 0],
        metadata: { globalId: imported },
      })
    const { ifc } = buildIfcExport({
      nodes: { [level.id]: level, wall_a: wall('wall_a'), wall_b: wall('wall_b') },
      timestamp: EPOCH,
    })
    const guids = [...ifc.matchAll(/IFCWALL\('([^']+)'/g)].map((match) => match[1])
    expect(guids).toEqual([imported, ifcGuidFromSeed('wall_b')])
  })
})

describe('Tessellated and grouped elements', () => {
  const { nodes, meshes, wall, curved } = groupedElementsScene()
  const { ifc, summary } = buildIfcExport({
    nodes,
    meshes,
    onlyVisible: true,
    excludedNodeTypes: ['fence'],
    timestamp: EPOCH,
  })

  test('maps kinds to IFC classes and reports what it skipped', () => {
    expectWellFormedStep(ifc)
    expect(summary.elements).toEqual({
      IFCWALL: 2,
      // Two roof parts, the zero-thickness slab and the pool, from their meshes.
      IFCSLAB: 4,
      IFCSPACE: 2,
      IFCROOF: 1,
      IFCSTAIRFLIGHT: 1,
      IFCSTAIR: 1,
      IFCFURNISHINGELEMENT: 1,
      IFCGEOGRAPHICELEMENT: 1,
    })
    expect(summary.skipped).toEqual([
      { nodeId: 'slab_flat_bare', type: 'slab', reason: 'degenerate' },
      { nodeId: 'item_bare', type: 'item', reason: 'no-geometry' },
    ])
    expect(ifc).toMatch(/IFCGEOGRAPHICELEMENT\('[^']+',#\d+,'Oak',\$,'Vegetation',/)
  })

  test('aggregates roof and stair parts and groups unit spaces', () => {
    withModel(ifc, (modelID) => {
      const aggregates = idsOf(modelID, WebIFC.IFCRELAGGREGATES).map((id) =>
        api.GetLine(modelID, id),
      )
      const partsOf = (type: number) => {
        const [container] = idsOf(modelID, type)
        const rel = aggregates.find((candidate) => candidate.RelatingObject.value === container)
        return rel?.RelatedObjects.map((ref: { value: number }) =>
          api.GetLineType(modelID, ref.value),
        )
      }
      expect(partsOf(WebIFC.IFCROOF)).toEqual([WebIFC.IFCSLAB, WebIFC.IFCSLAB])
      expect(partsOf(WebIFC.IFCSTAIR)).toEqual([WebIFC.IFCSTAIRFLIGHT])
      const roofSlabs = idsOf(modelID, WebIFC.IFCSLAB).map(
        (id) => api.GetLine(modelID, id).PredefinedType.value,
      )
      expect(roofSlabs.sort()).toEqual(['FLOOR', 'FLOOR', 'ROOF', 'ROOF'])

      const [zone] = idsOf(modelID, WebIFC.IFCZONE)
      expect(api.GetLine(modelID, zone!).Name.value).toBe('Flat A')
      const [group] = idsOf(modelID, WebIFC.IFCRELASSIGNSTOGROUP)
      expect(api.GetLine(modelID, group!).RelatedObjects).toHaveLength(2)
    })
  })

  test('re-imports in the same world position through the rotated building', async () => {
    const scene = await convertIfcToPascal(new TextEncoder().encode(ifc), undefined, {
      simplify: false,
      wasmPath,
    })
    const nodesOf = <T extends AnyNode>(type: T['type']) =>
      Object.values(scene.nodes).filter((candidate): candidate is T => candidate.type === type)

    // Building yaw +90° maps local (x, z) to world (x·cos + z·sin, −x·sin + z·cos) + position.
    const toWorld = ([x, z]: readonly number[]) => [10 + z!, 5 - x!]
    const walls = nodesOf<WallNode>('wall')
    const straight = walls.find((candidate) => Math.abs((candidate.height ?? 0) - 2.5) < 1e-6)
    expect(straight).toBeDefined()
    for (const [actual, expected] of [
      [straight!.start, toWorld(wall.start)],
      [straight!.end, toWorld(wall.end)],
    ]) {
      expect(actual[0]).toBeCloseTo(expected[0]!, MM)
      expect(actual[1]).toBeCloseTo(expected[1]!, MM)
    }
    expect(straight!.thickness).toBeCloseTo(0.2, MM)
    expect(straight!.height!).toBeCloseTo(2.5, MM)

    const arc = walls.find((candidate) => candidate !== straight)
    expect(arc).toBeDefined()
    expect(arc!.start[0]).toBeCloseTo(toWorld(curved.start)[0]!, MM)
    expect(arc!.end[1]).toBeCloseTo(toWorld(curved.end)[1]!, MM)

    const sofa = nodesOf<ImportedMeshNode>('imported-mesh').find((mesh) => mesh.name === 'Sofa')
    expect(sofa).toBeDefined()
    const bounds = worldBounds(sofa!)
    expect(bounds.min[0]!).toBeCloseTo(12, MM)
    expect(bounds.max[0]!).toBeCloseTo(14, MM)
    // Level-local height on the upper storey.
    expect(bounds.min[1]!).toBeCloseTo(0, MM)
    expect(bounds.max[1]!).toBeCloseTo(0.8, MM)
    expect(bounds.min[2]!).toBeCloseTo(6, MM)
    expect(bounds.max[2]!).toBeCloseTo(7, MM)
    expect(scene.nodes[sofa!.parentId!]?.type).toBe('level')
  })
})

test('a scripted column persists its source and exports artifact triangles as IfcColumn', () => {
  const level = LevelNode.parse({ id: 'level_script_column' })
  const column = ColumnNode.parse({
    id: 'column_script',
    parentId: level.id,
    baseStyle: 'none',
    capitalStyle: 'none',
    source: {
      kind: 'script',
      language: 'three',
      script: 'a'.repeat(64),
      artifact: 'b'.repeat(64),
      params: { height: 3 },
      manifest: { bounds: { min: [-0.3, 0, -0.3], max: [0.3, 3, 0.3] }, triangles: 1 },
    },
  })
  const persisted = ColumnNode.parse(JSON.parse(JSON.stringify(column)))
  expect(persisted.source).toEqual(column.source)
  const nodes = { [level.id]: level, [column.id]: persisted }
  const { ifc } = buildIfcExport({
    nodes,
    meshes: new Map([
      [
        column.id,
        [
          {
            positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 3, 0]),
            indices: new Uint32Array([0, 1, 2]),
          },
        ],
      ],
    ]),
    timestamp: EPOCH,
  })
  const types = [...expectWellFormedStep(ifc).values()].map((entity) => entity.type)
  expect(types).toContain('IFCCOLUMN')
  expect(types).toContain('IFCTRIANGULATEDFACESET')
  expect(types).not.toContain('IFCCIRCLEPROFILEDEF')
  expect(buildIfcExport({ nodes, timestamp: EPOCH }).summary.skipped).toContainEqual({
    nodeId: column.id,
    type: 'column',
    reason: 'no-geometry',
  })
})

test('stair assemblies classify flights, landings and guards and publish measured flight properties', () => {
  const level = LevelNode.parse({ id: 'level_stair', height: 3 })
  const flight = StairSegmentNode.parse({
    id: 'sseg_flight',
    metadata: { globalId: '2O2Fr$t4X7Zf8NOew3FLOH' },
    parentId: 'stair_semantic',
    height: 3,
    length: 4.5,
    stepCount: 18,
  })
  const landing = StairSegmentNode.parse({
    id: 'sseg_landing',
    parentId: 'stair_semantic',
    segmentType: 'landing',
  })
  const stair = StairNode.parse({
    id: 'stair_semantic',
    parentId: level.id,
    children: [flight.id, landing.id],
    totalRise: 3,
  })
  const triangle = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] }
  const nodes = { [level.id]: level, [stair.id]: stair, [flight.id]: flight, [landing.id]: landing }
  const result = buildIfcExport({
    nodes,
    meshes: new Map([
      [flight.id, [triangle]],
      [landing.id, [triangle]],
      [
        stair.id,
        [
          { ...triangle, role: 'railing' },
          { ...triangle, role: 'handrail' },
        ],
      ],
    ]),
    timestamp: EPOCH,
  })
  expect(result.summary.elements.IFCSTAIR).toBe(1)
  expect(result.summary.elements.IFCSTAIRFLIGHT).toBe(1)
  expect(result.summary.elements.IFCSLAB).toBe(1)
  expect(result.summary.elements.IFCRAILING).toBe(2)
  withModel(result.ifc, (modelID) => {
    expect(api.GetLine(modelID, idsOf(modelID, WebIFC.IFCSLAB)[0]!).PredefinedType.value).toBe(
      'LANDING',
    )
    const pset = idsOf(modelID, WebIFC.IFCPROPERTYSET)
      .map((id) => api.GetLine(modelID, id))
      .find((entry) => entry.Name.value === 'Pset_StairFlightCommon')
    const props = Object.fromEntries(
      pset.HasProperties.map((ref: { value: number }) => {
        const property = api.GetLine(modelID, ref.value)
        return [property.Name.value, property.NominalValue.value]
      }),
    )
    expect(props.NumberOfRiser).toBe(18)
    expect(props.NumberOfTreads).toBe(18)
    expect(props.RiserHeight).toBeCloseTo(1 / 6)
    expect(props.TreadLength).toBeCloseTo(0.25)
    expect(props.Headroom).toBeUndefined()
    const relation = idsOf(modelID, WebIFC.IFCRELAGGREGATES)
      .map((id) => api.GetLine(modelID, id))
      .find((entry) => entry.RelatingObject.value === idsOf(modelID, WebIFC.IFCSTAIR)[0])
    expect(relation.RelatedObjects).toHaveLength(4)
    const guids = [
      WebIFC.IFCSTAIR,
      WebIFC.IFCSTAIRFLIGHT,
      WebIFC.IFCSLAB,
      WebIFC.IFCRAILING,
    ].flatMap((type) => idsOf(modelID, type).map((id) => api.GetLine(modelID, id).GlobalId.value))
    expect(new Set(guids).size).toBe(5)
    expect(api.GetLine(modelID, idsOf(modelID, WebIFC.IFCSTAIRFLIGHT)[0]!).GlobalId.value).toBe(
      '2O2Fr$t4X7Zf8NOew3FLOH',
    )
    expect(
      idsOf(modelID, WebIFC.IFCRAILING)
        .map((id) => api.GetLine(modelID, id).PredefinedType.value)
        .sort(),
    ).toEqual(['GUARDRAIL', 'HANDRAIL'])
  })
})

test('winder export carries actual walking-line going and winding classifications', () => {
  const level = LevelNode.parse({ height: 3 })
  const stair = StairNode.parse({ parentId: level.id, totalRise: 3 })
  const flight = StairSegmentNode.parse({
    parentId: stair.id,
    height: 3,
    length: 99,
    stepCount: 4,
    width: 1,
    winder: { turn: 'left', innerGap: 0.2, walkingLineOffset: 0.45, division: 'equal-going' },
  })
  stair.children = [flight.id]
  const layout = resolveStairWinder(flight)!
  const result = buildIfcExport({
    nodes: { [level.id]: level, [stair.id]: stair, [flight.id]: flight },
    meshes: new Map([
      [flight.id, [{ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] }]],
    ]),
    timestamp: EPOCH,
  })
  withModel(result.ifc, (modelID) => {
    expect(api.GetLine(modelID, idsOf(modelID, WebIFC.IFCSTAIR)[0]!).PredefinedType.value).toBe(
      'QUARTER_WINDING_STAIR',
    )
    expect(
      api.GetLine(modelID, idsOf(modelID, WebIFC.IFCSTAIRFLIGHT)[0]!).PredefinedType.value,
    ).toBe('WINDER')
    const pset = idsOf(modelID, WebIFC.IFCPROPERTYSET)
      .map((id) => api.GetLine(modelID, id))
      .find((entry) => entry.Name.value === 'Pset_StairFlightCommon')
    const props = Object.fromEntries(
      pset.HasProperties.map((ref: { value: number }) => {
        const property = api.GetLine(modelID, ref.value)
        return [property.Name.value, property.NominalValue.value]
      }),
    )
    expect(props.WalkingLineOffset).toBe(0.45)
    expect(props.TreadLength).toBeCloseTo(layout.going)
    expect(props.TreadLengthAtInnerSide).toBeCloseTo(layout.narrowEndGoing)
  })
})
