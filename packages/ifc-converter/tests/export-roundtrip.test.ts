import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type AnyNode,
  type Collection,
  type ColumnNode,
  type DoorNode,
  getLevelElevations,
  ItemNode,
  type SlabNode,
  type WallNode,
  type WindowNode,
  type ZoneNode,
} from '@pascal-app/core'
import * as WebIFC from 'web-ifc'
import { convertIfcToPascal, type PascalSceneGraph } from '../src'
import { buildIfcExport, exportSceneToIfc, type IfcMeshPart } from '../src/export'
import { columnScene, roomWithOpenings, twoLevelScene, wallsOn } from './export-scenes'
import { expectWellFormedStep } from './export-step-check'

const wasmPath = `${dirname(fileURLToPath(import.meta.resolve('web-ifc')))}/`
const sampleHouse = fileURLToPath(
  new URL('../../../apps/ifc-converter/public/test-ifc-files/10-sample-house.ifc', import.meta.url),
)
const MM = 3 // toBeCloseTo digits: |a - b| < 0.5e-3
const EPOCH = new Date(Date.UTC(2026, 0, 1))

test('collections round-trip names, templates and product membership including multipart objects', async () => {
  const nodes = roomWithOpenings()
  const item = ItemNode.parse({
    id: 'item_lantern',
    name: 'Lantern',
    parentId: 'level_ground',
    asset: {
      id: 'lantern',
      category: 'lighting',
      name: 'Lantern',
      thumbnail: '',
      src: `artifact://${'b'.repeat(64)}`,
    },
    source: {
      kind: 'script',
      language: 'three',
      script: 'a'.repeat(64),
      artifact: 'b'.repeat(64),
      params: {},
      manifest: { bounds: { min: [0, 0, 0], max: [1, 1, 1] }, triangles: 2 },
    },
  })
  nodes[item.id] = item
  const collections: Record<string, Collection> = {
    collection_lights: {
      id: 'collection_lights',
      name: 'Lighting — entrée',
      template: 'lights',
      color: '#f5b83d',
      nodeIds: [item.id, 'item_missing'],
    },
    collection_openings: {
      id: 'collection_openings',
      name: 'South openings',
      template: 'windows',
      nodeIds: ['window_south', 'door_front'],
    },
    collection_custom: {
      id: 'collection_custom',
      name: 'Review together',
      nodeIds: [item.id, 'door_front'],
    },
    collection_empty: {
      id: 'collection_empty',
      name: 'No exported members',
      nodeIds: ['item_missing'],
    },
  }
  const meshes = new Map<string, IfcMeshPart[]>([
    [
      item.id,
      [{ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] }, { positions: [0, 0, 1, 1, 0, 1, 0, 1, 1] }],
    ],
  ])
  const ifc = exportSceneToIfc({ nodes, collections, meshes, timestamp: EPOCH })
  expectWellFormedStep(ifc)
  const modelID = openModel(ifc)
  try {
    expect(idsOf(modelID, WebIFC.IFCGROUP)).toHaveLength(4)
    const rels = idsOf(modelID, WebIFC.IFCRELASSIGNSTOGROUP).map((id) => api.GetLine(modelID, id))
    expect(rels).toHaveLength(3)
    const lighting = rels.find(
      (rel) => api.GetLine(modelID, rel.RelatingGroup.value).Name.value === 'Lighting — entrée',
    )
    expect(lighting.RelatedObjects).toHaveLength(1)
    const product = lighting.RelatedObjects[0].value
    expect(api.GetLine(modelID, product).Tag.value).toBe(item.id)
    expect(triangleCount(modelID, product)).toBe(2)
  } finally {
    api.CloseModel(modelID)
  }
  const scene = await reimport(ifc)
  const importedItem = Object.values(scene.nodes).find((node) => node.name === 'Lantern')!
  expect(importedItem).toBeDefined()
  expect(scene.collections).toEqual({
    collection_lights: { ...collections.collection_lights, nodeIds: [importedItem.id] },
    collection_openings: collections.collection_openings,
    collection_custom: {
      ...collections.collection_custom,
      nodeIds: [importedItem.id, 'door_front'],
    },
  })
  const systemScene = await reimport(ifc.replaceAll('=IFCGROUP(', '=IFCSYSTEM('))
  expect(
    Object.values(systemScene.collections ?? {})
      .map((collection) => collection.name)
      .sort(),
  ).toEqual(
    Object.values(scene.collections ?? {})
      .map((collection) => collection.name)
      .sort(),
  )
})

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

function openModel(text: string) {
  return api.OpenModel(new TextEncoder().encode(text))
}

function idsOf(modelID: number, type: number): number[] {
  const vector = api.GetLineIDsWithType(modelID, type)
  return Array.from({ length: vector.size() }, (_, i) => vector.get(i))
}

function containerOf(modelID: number): Map<number, number> {
  const map = new Map<number, number>()
  for (const relId of idsOf(modelID, WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE)) {
    const rel = api.GetLine(modelID, relId)
    for (const element of rel.RelatedElements) map.set(element.value, rel.RelatingStructure.value)
  }
  for (const relId of idsOf(modelID, WebIFC.IFCRELAGGREGATES)) {
    const rel = api.GetLine(modelID, relId)
    for (const part of rel.RelatedObjects) map.set(part.value, rel.RelatingObject.value)
  }
  return map
}

function triangleCount(modelID: number, expressID: number): number {
  const mesh = api.GetFlatMesh(modelID, expressID)
  let triangles = 0
  for (let i = 0; i < mesh.geometries.size(); i++) {
    const geometry = api.GetGeometry(modelID, mesh.geometries.get(i).geometryExpressID)
    triangles += geometry.GetIndexDataSize() / 3
  }
  return triangles
}

async function reimport(text: string): Promise<PascalSceneGraph> {
  return convertIfcToPascal(new TextEncoder().encode(text), undefined, {
    simplify: false,
    wasmPath,
  })
}

function nodesOf<T extends AnyNode>(scene: { nodes: Record<string, AnyNode> }, type: T['type']) {
  return Object.values(scene.nodes).filter((node): node is T => node.type === type)
}

function slabThickness(slab: SlabNode): number | undefined {
  return (
    (slab as { thickness?: number }).thickness ??
    ((slab.metadata as Record<string, unknown> | undefined)?.thickness as number | undefined)
  )
}

function sameSegment(a: WallNode, b: WallNode) {
  const d = (p: readonly number[], q: readonly number[]) => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!)
  return d(a.start, b.start) < 1e-3 && d(a.end, b.end) < 1e-3
}

describe('IFC export — room with a door and a window', () => {
  const nodes = roomWithOpenings()
  const { ifc, summary } = buildIfcExport({ nodes, projectName: 'Room test', timestamp: EPOCH })

  test('is a well-formed IFC4 file with valid references and unique GlobalIds', () => {
    expectWellFormedStep(ifc)
    expect(summary.elements).toEqual({
      IFCWALL: 4,
      IFCDOOR: 1,
      IFCWINDOW: 1,
      IFCSLAB: 1,
      IFCSPACE: 1,
      IFCCOVERING: 1,
    })
    expect(summary.skipped).toEqual([])
  })

  test('is deterministic for the same scene and time', () => {
    expect(exportSceneToIfc({ nodes, projectName: 'Room test', timestamp: EPOCH })).toBe(ifc)
  })

  test('web-ifc reads the spatial tree, voids, fills and geometry', () => {
    const modelID = openModel(ifc)
    try {
      expect(api.GetModelSchema(modelID)).toBe('IFC4')
      const count = (type: number) => idsOf(modelID, type).length
      expect(count(WebIFC.IFCPROJECT)).toBe(1)
      expect(count(WebIFC.IFCSITE)).toBe(1)
      expect(count(WebIFC.IFCBUILDING)).toBe(1)
      expect(count(WebIFC.IFCBUILDINGSTOREY)).toBe(1)
      expect(count(WebIFC.IFCWALL)).toBe(4)
      expect(count(WebIFC.IFCOPENINGELEMENT)).toBe(2)
      expect(count(WebIFC.IFCRELVOIDSELEMENT)).toBe(2)
      expect(count(WebIFC.IFCRELFILLSELEMENT)).toBe(2)
      expect(count(WebIFC.IFCSPACE)).toBe(1)

      const storey = idsOf(modelID, WebIFC.IFCBUILDINGSTOREY)[0]!
      const parents = containerOf(modelID)
      for (const type of [
        WebIFC.IFCWALL,
        WebIFC.IFCDOOR,
        WebIFC.IFCWINDOW,
        WebIFC.IFCSLAB,
        WebIFC.IFCCOVERING,
        WebIFC.IFCSPACE,
      ]) {
        for (const id of idsOf(modelID, type)) expect(parents.get(id)).toBe(storey)
      }
      for (const id of idsOf(modelID, WebIFC.IFCOPENINGELEMENT)) {
        expect(parents.has(id)).toBe(false)
      }

      // Every element tessellates, and the host wall carries its openings.
      for (const type of [WebIFC.IFCWALL, WebIFC.IFCDOOR, WebIFC.IFCWINDOW, WebIFC.IFCSLAB]) {
        for (const id of idsOf(modelID, type)) expect(triangleCount(modelID, id)).toBeGreaterThan(0)
      }
      const wallTriangles = idsOf(modelID, WebIFC.IFCWALL).map((id) => triangleCount(modelID, id))
      expect(Math.max(...wallTriangles)).toBeGreaterThan(Math.min(...wallTriangles))

      const door = api.GetLine(modelID, idsOf(modelID, WebIFC.IFCDOOR)[0]!)
      expect(door.OperationType.value).toBe('SINGLE_SWING_RIGHT')
      expect(door.OverallWidth.value).toBeCloseTo(0.9, MM)
      expect(door.OverallHeight.value).toBeCloseTo(2.1, MM)
      expect(door.Tag.value).toBe('door_front')
    } finally {
      api.CloseModel(modelID)
    }
  })

  test('re-imports with the same walls, openings, slab and room', async () => {
    const scene = await reimport(ifc)
    const originals = wallsOn(nodes, 'level_ground')
    const walls = nodesOf<WallNode>(scene, 'wall')
    expect(walls).toHaveLength(4)
    for (const original of originals) {
      const wall = walls.find((candidate) => sameSegment(candidate, original))
      expect(wall).toBeDefined()
      expect(wall!.thickness).toBeCloseTo(original.thickness ?? 0.1, MM)
      // Plane-bound wall on the 5 cm floor plate of a 2.8 m storey.
      expect(wall!.height!).toBeCloseTo(2.75, MM)
    }

    const [door] = nodesOf<DoorNode>(scene, 'door')
    expect(door).toBeDefined()
    expect(door!.position[0]).toBeCloseTo(1.5, MM)
    expect(door!.position[1]).toBeCloseTo(1.05, MM)
    expect(door!.width).toBeCloseTo(0.9, MM)
    expect(door!.height).toBeCloseTo(2.1, MM)
    expect(door!.hingesSide).toBe('right')
    const [window] = nodesOf<WindowNode>(scene, 'window')
    expect(window).toBeDefined()
    expect(window!.position[0]).toBeCloseTo(3.5, MM)
    expect(window!.position[1]).toBeCloseTo(1.5, MM)
    expect(window!.width).toBeCloseTo(1.2, MM)
    expect(window!.height).toBeCloseTo(1.2, MM)
    const host = walls.find((wall) => wall.children.includes(door!.id as never))
    expect(host?.children).toContain(window!.id)

    const [slab] = nodesOf<SlabNode>(scene, 'slab')
    expect(slab).toBeDefined()
    expect(slab!.elevation).toBeCloseTo(0.05, MM)
    expect(slabThickness(slab!)).toBeCloseTo(0.05, MM)

    const [space] = nodesOf<ZoneNode>(scene, 'zone')
    expect(space?.name).toBe('Living room')
    expect(space?.roomNumber).toBe('R01')
    const properties = (space?.metadata as { properties?: Record<string, Record<string, unknown>> })
      ?.properties
    expect(properties?.Pascal?.NodeType).toBe('zone')
  })
})

describe('IFC export — two storeys with plates and ceilings', () => {
  const nodes = twoLevelScene()
  const { ifc, summary } = buildIfcExport({ nodes, timestamp: EPOCH })

  test('exports one storey per level at the stacked elevation', () => {
    expectWellFormedStep(ifc)
    expect(summary.elements.IFCBUILDINGSTOREY).toBeUndefined()
    expect(summary.elements.IFCWALL).toBe(8)
    expect(summary.elements.IFCSLAB).toBe(2)
    expect(summary.elements.IFCCOVERING).toBe(2)
    expect(summary.elements.IFCSPACE).toBe(2)
    const modelID = openModel(ifc)
    try {
      const storeys = idsOf(modelID, WebIFC.IFCBUILDINGSTOREY).map((id) => api.GetLine(modelID, id))
      expect(storeys.map((storey) => storey.Name.value)).toEqual(['Ground', 'Upper'])
      expect(storeys.map((storey) => storey.Elevation.value)).toEqual([0, 2.8])
      expect(idsOf(modelID, WebIFC.IFCRELCOVERSSPACES)).toHaveLength(2)
      const slabTypes = idsOf(modelID, WebIFC.IFCSLAB).map(
        (id) => api.GetLine(modelID, id).PredefinedType.value,
      )
      expect(slabTypes.sort()).toEqual(['BASESLAB', 'FLOOR'])
    } finally {
      api.CloseModel(modelID)
    }
  })

  test('re-imports storey heights, slab tops and space names', async () => {
    const scene = await reimport(ifc)
    const levels = nodesOf(scene, 'level').sort((a, b) => a.level - b.level)
    expect(levels.map((level) => level.name)).toEqual(['Ground', 'Upper'])
    const reElevations = getLevelElevations(scene.nodes)
    expect(reElevations.get(levels[0]!.id)!.baseY).toBeCloseTo(0, MM)
    expect(reElevations.get(levels[1]!.id)!.baseY).toBeCloseTo(2.8, MM)
    expect(levels[0]!.height!).toBeCloseTo(2.8, MM)
    // The top storey has no storey above it to measure against, so its height
    // travels as a standard base quantity.
    const topQuantities = (
      levels[1]!.metadata as { properties?: Record<string, Record<string, unknown>> }
    ).properties?.Qto_BuildingStoreyBaseQuantities
    expect(topQuantities?.GrossHeight as number).toBeCloseTo(3.1, MM)

    const originalSlabs = nodesOf<SlabNode>({ nodes }, 'slab')
    const slabs = nodesOf<SlabNode>(scene, 'slab')
    expect(slabs).toHaveLength(originalSlabs.length)
    for (const original of originalSlabs) {
      const originalLevel = nodes[original.parentId!]!
      const slab = slabs.find(
        (candidate) => scene.nodes[candidate.parentId!]?.name === originalLevel.name,
      )
      expect(slab).toBeDefined()
      expect(slab!.elevation).toBeCloseTo(original.elevation, MM)
      expect(slabThickness(slab!)).toBeCloseTo(original.thickness, MM)
    }

    const spaces = nodesOf<ZoneNode>(scene, 'zone')
    expect(spaces.map((space) => space.name).sort()).toEqual(['Bedroom', 'Kitchen'])
    expect(spaces.find((space) => space.name === 'Bedroom')?.roomNumber).toBe('B1')

    for (const levelId of ['level_l0', 'level_l1']) {
      for (const original of wallsOn(nodes, levelId)) {
        const wall = nodesOf<WallNode>(scene, 'wall').find((candidate) =>
          sameSegment(candidate, original),
        )
        expect(wall).toBeDefined()
      }
    }
  })
})

describe('IFC export — columns', () => {
  const nodes = columnScene()
  const ifc = exportSceneToIfc({ nodes, timestamp: EPOCH })

  test('exports parametric IfcColumn extrusions', () => {
    const entities = expectWellFormedStep(ifc)
    const types = [...entities.values()].map((entity) => entity.type)
    expect(types.filter((type) => type === 'IFCCOLUMN')).toHaveLength(2)
    expect(types).toContain('IFCRECTANGLEPROFILEDEF')
    expect(types).toContain('IFCCIRCLEPROFILEDEF')
  })

  test('re-imports position, section and height', async () => {
    const scene = await reimport(ifc)
    const columns = nodesOf<ColumnNode>(scene, 'column')
    expect(columns).toHaveLength(2)
    const rect = columns.find((column) => column.name === 'Rect column')!
    expect(rect.crossSection).toBe('rectangular')
    expect(rect.position[0]).toBeCloseTo(2, MM)
    expect(rect.position[1]).toBeCloseTo(0, MM)
    expect(rect.position[2]).toBeCloseTo(1, MM)
    expect(rect.width).toBeCloseTo(0.3, MM)
    expect(rect.depth).toBeCloseTo(0.5, MM)
    expect(rect.height).toBeCloseTo(2.7, MM)
    const round = columns.find((column) => column.name === 'Round column')!
    expect(round.crossSection).toBe('round')
    expect(round.position[0]).toBeCloseTo(-1.5, MM)
    expect(round.position[2]).toBeCloseTo(3, MM)
    expect(round.radius).toBeCloseTo(0.2, MM)
    expect(round.height).toBeCloseTo(3, MM)
  })
})

describe('IFC export — sample house round trip', () => {
  let first: PascalSceneGraph
  let second: PascalSceneGraph
  let ifc: string

  beforeAll(async () => {
    first = await convertIfcToPascal(await readFile(sampleHouse), undefined, {
      simplify: false,
      wasmPath,
    })
    ifc = exportSceneToIfc({ nodes: first.nodes, projectName: 'Sample house', timestamp: EPOCH })
    second = await reimport(ifc)
  })

  test('the export is well formed', () => {
    expectWellFormedStep(ifc)
  })

  test('keeps wall, slab, opening and space counts', () => {
    for (const type of ['level', 'wall', 'slab', 'door', 'window', 'zone'] as const) {
      expect({ type, count: nodesOf(second, type).length }).toEqual({
        type,
        count: nodesOf(first, type).length,
      })
    }
    expect(nodesOf(second, 'imported-mesh').length).toBe(nodesOf(first, 'imported-mesh').length)
  })

  test('keeps wall and slab geometry within 1 mm', () => {
    const walls = nodesOf<WallNode>(second, 'wall')
    for (const original of nodesOf<WallNode>(first, 'wall')) {
      const wall = walls.find((candidate) => sameSegment(candidate, original))
      expect(wall).toBeDefined()
      expect(wall!.thickness).toBeCloseTo(original.thickness!, MM)
      expect(wall!.height!).toBeCloseTo(original.height!, MM)
    }
    const slabs = nodesOf<SlabNode>(second, 'slab')
    for (const original of nodesOf<SlabNode>(first, 'slab')) {
      const slab = slabs.find((candidate) => candidate.name === original.name)
      expect(slab).toBeDefined()
      expect(slab!.elevation).toBeCloseTo(original.elevation, MM)
      expect(slabThickness(slab!)).toBeCloseTo(slabThickness(original)!, MM)
      expect(slab!.polygon.length).toBe(original.polygon.length)
    }
    const spaces = nodesOf<ZoneNode>(second, 'zone')
    for (const original of nodesOf<ZoneNode>(first, 'zone')) {
      const space = spaces.find((candidate) => candidate.name === original.name)
      expect(space).toBeDefined()
      expect(space!.roomNumber).toBe(original.roomNumber)
    }
  })

  test('re-export reuses the original GlobalIds', () => {
    const original = new Set(
      Object.values(first.nodes).flatMap((node) => {
        const guid = (node.metadata as Record<string, unknown> | undefined)?.globalId
        return typeof guid === 'string' ? [guid] : []
      }),
    )
    const secondGuids = Object.values(second.nodes).flatMap((node) => {
      const guid = (node.metadata as Record<string, unknown> | undefined)?.globalId
      return typeof guid === 'string' ? [guid] : []
    })
    const reused = secondGuids.filter((guid) => original.has(guid))
    expect(reused.length).toBeGreaterThan(secondGuids.length * 0.9)
  })
})
