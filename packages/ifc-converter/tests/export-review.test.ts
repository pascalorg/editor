import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type AnyNode,
  BuildingNode,
  CeilingNode,
  LevelNode,
  SiteNode,
  SlabNode,
  WallNode,
  ZoneNode,
} from '@pascal-app/core'
import * as WebIFC from 'web-ifc'
import { buildIfcExport, exportSceneToIfc, type IfcMeshPart } from '../src/export'
import { box, node } from './export-scenes'
import { expectWellFormedStep } from './export-step-check'

const wasmPath = `${dirname(fileURLToPath(import.meta.resolve('web-ifc')))}/`
const EPOCH = new Date(Date.UTC(2026, 0, 1))
const api = new WebIFC.IfcAPI()

beforeAll(async () => {
  api.SetWasmPath(wasmPath, true)
  await api.Init()
})
afterAll(() => {})

type Mesh = { vertices: number[][]; triangles: number[][][] }

/** World-space triangles of one element as web-ifc tessellates it (IFC Z-up). */
function elementMesh(modelID: number, expressID: number): Mesh {
  const vertices: number[][] = []
  const triangles: number[][][] = []
  const flat = api.GetFlatMesh(modelID, expressID)
  for (let g = 0; g < flat.geometries.size(); g++) {
    const placed = flat.geometries.get(g)
    const m = placed.flatTransformation
    const geometry = api.GetGeometry(modelID, placed.geometryExpressID)
    const data = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize())
    const index = api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize())
    const local: number[][] = []
    for (let v = 0; v + 5 < data.length; v += 6) {
      const [x, y, z] = [data[v]!, data[v + 1]!, data[v + 2]!]
      // web-ifc meshes are Y-up (X, Z, −Y); map back to IFC (X, Y, Z).
      const wx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!
      const wy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!
      const wz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!
      local.push([wx, -wz, wy])
    }
    vertices.push(...local)
    for (let i = 0; i + 2 < index.length; i += 3) {
      triangles.push([local[index[i]!]!, local[index[i + 1]!]!, local[index[i + 2]!]!])
    }
  }
  return { vertices, triangles }
}

function volume(mesh: Mesh): number {
  let sum = 0
  for (const [a, b, c] of mesh.triangles) {
    sum +=
      a![0]! * (b![1]! * c![2]! - b![2]! * c![1]!) -
      a![1]! * (b![0]! * c![2]! - b![2]! * c![0]!) +
      a![2]! * (b![0]! * c![1]! - b![1]! * c![0]!)
  }
  return Math.abs(sum / 6)
}

function withModel<T>(ifc: string, run: (modelID: number) => T): T {
  const modelID = api.OpenModel(new TextEncoder().encode(ifc))
  try {
    return run(modelID)
  } finally {
    api.CloseModel(modelID)
  }
}

function idsOf(modelID: number, type: number): number[] {
  const vector = api.GetLineIDsWithType(modelID, type)
  return Array.from({ length: vector.size() }, (_, i) => vector.get(i))
}

const levelNodes = (...children: AnyNode[]): Record<string, AnyNode> => {
  const level = LevelNode.parse({ id: 'level_r', height: 3 })
  return Object.fromEntries([
    [level.id, { ...level, children: children.map((child) => child.id) }],
    ...children.map((child) => [child.id, child]),
  ])
}

const square = (size: number): [number, number][] => [
  [0, 0],
  [size, 0],
  [size, size],
  [0, size],
]

describe('cutouts that cross the boundary or overlap', () => {
  // 4 × 4 m with a 1 × 2 m notch across the south edge and two overlapping
  // 1 × 1 m holes (union 1.5 m²): 16 − 2 − 1.5 = 12.5 m².
  const holes: [number, number][][] = [
    [
      [1, -1],
      [2, -1],
      [2, 1],
      [1, 1],
    ],
    [
      [2.5, 2],
      [3.5, 2],
      [3.5, 3],
      [2.5, 3],
    ],
    [
      [3, 2.5],
      [3.5, 2.5],
      [3.5, 3.5],
      [3, 3.5],
    ],
  ]
  const expectedArea = 16 - 1 - 1.25
  const slab = SlabNode.parse({
    id: 'slab_notch',
    parentId: 'level_r',
    polygon: square(4),
    holes,
    elevation: 0.2,
    thickness: 0.2,
  })
  const zone = ZoneNode.parse({
    id: 'zone_notch',
    name: 'Notched',
    parentId: 'level_r',
    polygon: square(4),
    holes,
    ceilingHeight: 2.5,
  })
  const ceiling = CeilingNode.parse({
    id: 'ceiling_notch',
    parentId: 'level_r',
    polygon: square(4),
    holes,
    height: 2.5,
  })
  const ifc = exportSceneToIfc({ nodes: levelNodes(slab, zone, ceiling), timestamp: EPOCH })

  test('emit only enclosed, disjoint voids', () => {
    expectWellFormedStep(ifc)
    withModel(ifc, (modelID) => {
      const [slabId] = idsOf(modelID, WebIFC.IFCSLAB)
      expect(volume(elementMesh(modelID, slabId!))).toBeCloseTo(expectedArea * 0.2, 3)
      const [spaceId] = idsOf(modelID, WebIFC.IFCSPACE)
      expect(volume(elementMesh(modelID, spaceId!))).toBeCloseTo(expectedArea * 2.5, 2)
      const [ceilingId] = idsOf(modelID, WebIFC.IFCCOVERING)
      expect(volume(elementMesh(modelID, ceilingId!))).toBeCloseTo(expectedArea * 0.01, 4)
    })
  })
})

describe('hidden nodes', () => {
  const site = SiteNode.parse({ id: 'site_h', visible: false })
  const building = BuildingNode.parse({ id: 'building_h', parentId: site.id })
  const level = LevelNode.parse({ id: 'level_h', parentId: building.id, height: 3 })
  const hiddenLevel = LevelNode.parse({
    id: 'level_hidden',
    parentId: building.id,
    level: 1,
    height: 3,
    visible: false,
  })
  const wall = WallNode.parse({ id: 'wall_h', parentId: level.id, start: [0, 0], end: [3, 0] })
  const upperWall = WallNode.parse({
    id: 'wall_up',
    parentId: hiddenLevel.id,
    start: [0, 0],
    end: [3, 0],
  })
  const nodes: Record<string, AnyNode> = {
    [site.id]: { ...site, children: [building.id] } as AnyNode,
    [building.id]: { ...building, children: [level.id, hiddenLevel.id] } as AnyNode,
    [level.id]: { ...level, children: [wall.id] } as AnyNode,
    [hiddenLevel.id]: { ...hiddenLevel, children: [upperWall.id] } as AnyNode,
    [wall.id]: wall,
    [upperWall.id]: upperWall,
  }

  test('a hidden site keeps its buildings; a hidden level drops its contents', () => {
    const { ifc, summary } = buildIfcExport({ nodes, onlyVisible: true, timestamp: EPOCH })
    expect(summary.elements.IFCWALL).toBe(1)
    expect(ifc).toContain("'wall_h',.STANDARD.")
    expect(ifc).not.toContain("'wall_up'")
  })
})

describe('stepped wall base', () => {
  // Half the wall stands on a 0.40 m deck, half on a 0.05 m floor.
  const wall = WallNode.parse({
    id: 'wall_step',
    parentId: 'level_r',
    start: [0, 0],
    end: [4, 0],
    thickness: 0.2,
    height: 2.5,
  })
  const deck = SlabNode.parse({
    id: 'slab_deck',
    parentId: 'level_r',
    polygon: [
      [-1, -1],
      [2, -1],
      [2, 1],
      [-1, 1],
    ],
    elevation: 0.4,
    thickness: 0.4,
  })
  const floor = SlabNode.parse({
    id: 'slab_floor',
    parentId: 'level_r',
    polygon: [
      [2, -1],
      [5, -1],
      [5, 1],
      [2, 1],
    ],
    elevation: 0.05,
    thickness: 0.05,
  })
  const ifc = exportSceneToIfc({ nodes: levelNodes(wall, deck, floor), timestamp: EPOCH })

  test('keeps the lower bottom where the support is lower', () => {
    withModel(ifc, (modelID) => {
      const [wallId] = idsOf(modelID, WebIFC.IFCWALL)
      const mesh = elementMesh(modelID, wallId!)
      const bottomWhere = (inside: (x: number) => boolean) =>
        Math.min(...mesh.vertices.filter(([x]) => inside(x!)).map(([, , z]) => z!))
      expect(bottomWhere((x) => x < 1.9)).toBeCloseTo(0.4, 3)
      expect(bottomWhere((x) => x > 2.1)).toBeCloseTo(0.05, 3)
      expect(Math.max(...mesh.vertices.map(([, , z]) => z!))).toBeCloseTo(2.9, 3)
      // 4 m × 0.2 m, 2.5 m tall on the deck half and 2.85 m on the floor half.
      expect(volume(mesh)).toBeCloseTo(2 * 0.2 * 2.5 + 2 * 0.2 * 2.85, 3)
    })
  })
})

describe('slab body', () => {
  const wall = WallNode.parse({
    id: 'wall_edge',
    parentId: 'level_r',
    start: [0, 0],
    end: [4, 0],
    thickness: 0.1,
  })
  const slab = SlabNode.parse({
    id: 'slab_edge',
    parentId: 'level_r',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ],
    elevation: 0.05,
    thickness: 0.05,
  })

  test('uses the rendered outline, which adopts the wall face', () => {
    const ifc = exportSceneToIfc({ nodes: levelNodes(wall, slab), timestamp: EPOCH })
    withModel(ifc, (modelID) => {
      const [slabId] = idsOf(modelID, WebIFC.IFCSLAB)
      const ys = elementMesh(modelID, slabId!).vertices.map(([, y]) => y!)
      // Pascal z = −0.05 (the wall's outer face) is IFC Y = +0.05.
      expect(Math.max(...ys)).toBeCloseTo(0.05, 4)
    })
  })

  test('falls back to the rendered mesh when the body is not a prism', () => {
    // A terrain fill reaching 0.6 m below the slab underside.
    const fill: IfcMeshPart[] = [box([0, -0.6, 0], [4, 0.05, 3])]
    const prism: IfcMeshPart[] = [box([0, 0, 0], [4, 0.05, 3])]
    const nodes = levelNodes(slab)
    const tessellated = exportSceneToIfc({
      nodes,
      meshes: new Map([['slab_edge', fill]]),
      timestamp: EPOCH,
    })
    expect(tessellated).toMatch(/IFCSLAB\([^;]*\.FLOOR\.\);/)
    expect(tessellated).toContain('IFCTRIANGULATEDFACESET(')
    const extruded = exportSceneToIfc({
      nodes,
      meshes: new Map([['slab_edge', prism]]),
      timestamp: EPOCH,
    })
    expect(extruded).not.toContain('IFCTRIANGULATEDFACESET(')
    expect(extruded).toContain('IFCEXTRUDEDAREASOLID(')
  })
})

describe('scaling', () => {
  // Rooms, their ceilings (explicit height, so core's resolver stays O(1)) and
  // roofs whose segments have no mesh: little output per node, so the timing
  // is dominated by the writer's own lookups (room → ceiling, roof → parts).
  function scene(rooms: number): Record<string, AnyNode> {
    const children: AnyNode[] = []
    const segments: AnyNode[] = []
    for (let i = 0; i < rooms; i++) {
      const x = (i % 50) * 5
      const z = Math.floor(i / 50) * 5
      const polygon: [number, number][] = [
        [x, z],
        [x + 4, z],
        [x + 4, z + 4],
        [x, z + 4],
      ]
      children.push(
        ZoneNode.parse({ id: `zone_${i}`, name: `Room ${i}`, parentId: 'level_r', polygon }),
        CeilingNode.parse({
          id: `ceiling_${i}`,
          parentId: 'level_r',
          polygon,
          zoneId: `zone_${i}`,
          height: 2.6,
        }),
        node({ id: `roof_${i}`, type: 'roof', parentId: 'level_r' }),
      )
      for (const suffix of ['a', 'b']) {
        segments.push(
          node({ id: `roof-segment_${i}${suffix}`, type: 'roof-segment', parentId: `roof_${i}` }),
        )
      }
    }
    return { ...levelNodes(...children), ...Object.fromEntries(segments.map((n) => [n.id, n])) }
  }
  const time = (rooms: number) => {
    const nodes = scene(rooms)
    let best = Infinity
    for (let run = 0; run < 3; run++) {
      const started = performance.now()
      buildIfcExport({ nodes, timestamp: EPOCH })
      best = Math.min(best, performance.now() - started)
    }
    return best
  }

  test('grows linearly with the number of rooms', () => {
    time(100)
    const small = time(500)
    const large = time(2000)
    // Per-room scans of every node made 4× the rooms cost ~16×.
    expect(large / small).toBeLessThan(6)
  })
})
