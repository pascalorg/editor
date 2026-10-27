import { describe, expect, spyOn, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AnyNode, ImportedMeshNode, WallNode, ZoneNode } from '@pascal-app/core'
import * as WebIFC from 'web-ifc'
import {
  type ConversionOptions,
  conversionReportHasIssues,
  convertIfcToPascal,
  convertIfcToPascalWithReport,
  type PascalSceneGraph,
} from '../src'

const fixturesDirectory = fileURLToPath(
  new URL('../../../apps/ifc-converter/public/test-ifc-files/', import.meta.url),
)
const wasmPath = `${dirname(fileURLToPath(import.meta.resolve('web-ifc')))}/`

async function convertFixture(
  name: string,
  transform?: (source: string) => string,
  options?: ConversionOptions,
) {
  const source = await readFile(`${fixturesDirectory}${name}`)
  const data = transform
    ? new TextEncoder().encode(transform(new TextDecoder().decode(source)))
    : source
  return convertIfcToPascal(data, undefined, { simplify: false, wasmPath, ...options })
}

function metadata(node: AnyNode): Record<string, unknown> {
  return (node.metadata ?? {}) as Record<string, unknown>
}

function importedMeshes(scene: PascalSceneGraph): ImportedMeshNode[] {
  return Object.values(scene.nodes).filter(
    (node): node is ImportedMeshNode => node.type === 'imported-mesh',
  )
}

type PlanBounds = { minX: number; maxX: number; minZ: number; maxZ: number }

function importedMeshPlanBounds(meshes: ImportedMeshNode[], secondPlanAxis = 2): PlanBounds {
  const bounds: PlanBounds = {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  }
  for (const mesh of meshes) {
    for (const primitive of mesh.primitives) {
      for (let index = 0; index + 2 < primitive.positions.length; index += 3) {
        bounds.minX = Math.min(bounds.minX, primitive.positions[index]!)
        bounds.maxX = Math.max(bounds.maxX, primitive.positions[index]!)
        bounds.minZ = Math.min(bounds.minZ, primitive.positions[index + secondPlanAxis]!)
        bounds.maxZ = Math.max(bounds.maxZ, primitive.positions[index + secondPlanAxis]!)
      }
    }
  }
  return bounds
}

function wallPlanBounds(scene: PascalSceneGraph): PlanBounds {
  const walls = Object.values(scene.nodes).filter((node): node is WallNode => node.type === 'wall')
  return walls.reduce<PlanBounds>(
    (bounds, wall) => {
      const halfThickness = (wall.thickness ?? 0) / 2
      return {
        minX: Math.min(bounds.minX, wall.start[0] - halfThickness, wall.end[0] - halfThickness),
        maxX: Math.max(bounds.maxX, wall.start[0] + halfThickness, wall.end[0] + halfThickness),
        minZ: Math.min(bounds.minZ, wall.start[1] - halfThickness, wall.end[1] - halfThickness),
        maxZ: Math.max(bounds.maxZ, wall.start[1] + halfThickness, wall.end[1] + halfThickness),
      }
    },
    {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minZ: Number.POSITIVE_INFINITY,
      maxZ: Number.NEGATIVE_INFINITY,
    },
  )
}

let openHouse: Promise<PascalSceneGraph> | undefined
function openHouseScene() {
  openHouse ??= convertFixture('04-ifc-open-house.ifc')
  return openHouse
}

let openHouseWithoutAxisSwap: Promise<PascalSceneGraph> | undefined
function openHouseWithoutAxisSwapScene() {
  openHouseWithoutAxisSwap ??= convertFixture('04-ifc-open-house.ifc', undefined, {
    swapYZ: false,
  })
  return openHouseWithoutAxisSwap
}

let openHouseWithoutStorey: Promise<PascalSceneGraph> | undefined
function openHouseWithoutStoreyScene() {
  openHouseWithoutStorey ??= convertFixture('04-ifc-open-house.ifc', (source) =>
    source.replace('IFCBUILDINGSTOREY(', 'IFCBUILDINGELEMENTPROXY('),
  )
  return openHouseWithoutStorey
}

function reachableNodeIds(scene: PascalSceneGraph): Set<string> {
  const reachable = new Set<string>()
  const visit = (nodeId: string) => {
    if (reachable.has(nodeId)) return
    reachable.add(nodeId)
    const node = scene.nodes[nodeId]
    if (node && 'children' in node) {
      for (const childId of node.children) visit(childId)
    }
  }
  for (const rootNodeId of scene.rootNodeIds) visit(rootNodeId)
  return reachable
}

let duplex: Promise<PascalSceneGraph> | undefined
function duplexScene() {
  duplex ??= convertFixture('01-duplex.ifc')
  return duplex
}

let duplexWithoutAxisSwap: Promise<PascalSceneGraph> | undefined
function duplexWithoutAxisSwapScene() {
  duplexWithoutAxisSwap ??= convertFixture('01-duplex.ifc', undefined, {
    swapYZ: false,
  })
  return duplexWithoutAxisSwap
}

let duplexWithMissingSpaceName: Promise<PascalSceneGraph> | undefined
function duplexWithMissingSpaceNameScene() {
  duplexWithMissingSpaceName ??= convertFixture('01-duplex.ifc', (source) =>
    source.replace(
      /(#157= IFCSPACE\('[^']+',#41,)'A102'/,
      (_match, prefix: string) => `${prefix}$`,
    ),
  )
  return duplexWithMissingSpaceName
}

const longRoomNumber = 'ROOM-NUMBER-THAT-IS-LONGER-THAN-THIRTY-TWO-CHARACTERS'
let duplexWithLongRoomNumber: Promise<PascalSceneGraph> | undefined
function duplexWithLongRoomNumberScene() {
  duplexWithLongRoomNumber ??= convertFixture('01-duplex.ifc', (source) =>
    source.replace(
      /(#157= IFCSPACE\('[^']+',#41,)'A102'/,
      (_match, prefix: string) => `${prefix}'${longRoomNumber}'`,
    ),
  )
  return duplexWithLongRoomNumber
}

describe('IFC imported mesh conversion', () => {
  test('keeps millimetre mesh geometry aligned with native walls', async () => {
    const scene = await openHouseScene()
    const meshBounds = importedMeshPlanBounds(importedMeshes(scene))
    const nativeBounds = wallPlanBounds(scene)

    expect(meshBounds.maxX - meshBounds.minX).toBeGreaterThan(9)
    expect(meshBounds.maxZ - meshBounds.minZ).toBeGreaterThan(5)
    expect(Math.abs(meshBounds.minX - nativeBounds.minX)).toBeLessThan(1)
    expect(Math.abs(meshBounds.maxX - nativeBounds.maxX)).toBeLessThan(1)
    expect(Math.abs(meshBounds.minZ - nativeBounds.minZ)).toBeLessThan(1)
    expect(Math.abs(meshBounds.maxZ - nativeBounds.maxZ)).toBeLessThan(1)
  }, 30_000)

  test('keeps flat meshes aligned when STEP axis swapping is disabled', async () => {
    const scene = await openHouseWithoutAxisSwapScene()
    const meshBounds = importedMeshPlanBounds(importedMeshes(scene), 1)
    const nativeBounds = wallPlanBounds(scene)

    expect(Math.abs(meshBounds.minX - nativeBounds.minX)).toBeLessThan(1)
    expect(Math.abs(meshBounds.maxX - nativeBounds.maxX)).toBeLessThan(1)
    expect(Math.abs(meshBounds.minZ - nativeBounds.minZ)).toBeLessThan(1)
    expect(Math.abs(meshBounds.maxZ - nativeBounds.maxZ)).toBeLessThan(1)
  }, 30_000)

  test('keeps mesh-derived room heights stable when STEP axis swapping is disabled', async () => {
    const [defaultScene, unswappedScene] = await Promise.all([
      duplexScene(),
      duplexWithoutAxisSwapScene(),
    ])
    const defaultZones = Object.values(defaultScene.nodes).filter(
      (node): node is ZoneNode => node.type === 'zone',
    )
    const unswappedZonesByExpressId = new Map(
      Object.values(unswappedScene.nodes)
        .filter((node): node is ZoneNode => node.type === 'zone')
        .map((zone) => [metadata(zone).expressID, zone]),
    )

    expect(defaultZones.length).toBeGreaterThan(0)
    for (const zone of defaultZones) {
      const unswappedZone = unswappedZonesByExpressId.get(metadata(zone).expressID)
      expect(unswappedZone).toBeDefined()
      expect(Math.abs(zone.ceilingHeight - unswappedZone!.ceilingHeight)).toBeLessThan(0.001)
    }
  }, 30_000)

  test('keeps converted nodes reachable when the IFC has no building storey', async () => {
    const scene = await openHouseWithoutStoreyScene()

    expect(Object.values(scene.nodes).filter((node) => node.type === 'level')).toHaveLength(0)
    expect(importedMeshes(scene).length).toBeGreaterThan(0)
    expect(reachableNodeIds(scene).size).toBe(Object.keys(scene.nodes).length)
  }, 30_000)

  test('preserves roof slabs as imported geometry when a mesh is available', async () => {
    const scene = await openHouseScene()
    const roofSlabs = importedMeshes(scene).filter(
      (node) =>
        metadata(node).ifcType === 'IFCSLAB' &&
        String(metadata(node).predefinedType).toUpperCase() === 'ROOF',
    )

    expect(roofSlabs).toHaveLength(2)
  }, 30_000)

  test('rounds serialized positions and normals to the storage precision', async () => {
    const scene = await openHouseScene()
    for (const mesh of importedMeshes(scene)) {
      for (const primitive of mesh.primitives) {
        for (const value of primitive.positions) {
          expect(Math.abs(value * 10_000 - Math.round(value * 10_000))).toBeLessThan(1e-8)
        }
        for (const value of primitive.normals ?? []) {
          expect(Math.abs(value * 1000 - Math.round(value * 1000))).toBeLessThan(1e-8)
        }
      }
    }
  }, 30_000)

  test('preserves stair flight meshes and continues after a space with no Name', async () => {
    const scene = await duplexWithMissingSpaceNameScene()
    const nodes = Object.values(scene.nodes)

    // Wall loops no IfcSpace claims become rooms too; only the spaces are counted.
    expect(
      nodes.filter((node) => node.type === 'zone' && metadata(node).ifcType === 'IFCSPACE'),
    ).toHaveLength(21)
    expect(
      nodes.some((node) => node.type === 'zone' && metadata(node).footprintApproximated === true),
    ).toBe(true)
    expect(nodes.filter((node) => node.type === 'stair')).toHaveLength(0)
    expect(
      nodes.filter(
        (node) => node.type === 'imported-mesh' && metadata(node).ifcType === 'IFCSTAIRFLIGHT',
      ),
    ).toHaveLength(2)
  }, 30_000)

  test('keeps a zone when its IFC room number exceeds the Pascal limit', async () => {
    const scene = await duplexWithLongRoomNumberScene()
    const zones = Object.values(scene.nodes).filter(
      (node): node is ZoneNode => node.type === 'zone' && metadata(node).ifcType === 'IFCSPACE',
    )
    const changedZone = zones.find((zone) => metadata(zone).expressID === 157)

    expect(zones).toHaveLength(21)
    expect(changedZone).toBeDefined()
    expect(changedZone!.roomNumber).toBe('')
    expect(metadata(changedZone!).ifcName).toBe(longRoomNumber)
  }, 30_000)
})

describe('IFC geometry with an unreadable number', () => {
  // 1.E400 overflows to Infinity, so the element's placement and its flat-mesh matrix stop being
  // finite. One such value used to fail the whole file with "Could not build imported mesh node
  // at primitives.0.positions.0".
  async function convertWithOverflow(point: string, overflowed: string) {
    const source = new TextDecoder().decode(
      await readFile(`${fixturesDirectory}04-ifc-open-house.ifc`),
    )
    expect(source).toContain(point)
    return convertIfcToPascalWithReport(
      new TextEncoder().encode(source.replace(point, overflowed)),
      undefined,
      { simplify: false, wasmPath },
    )
  }

  function nodesFor(scene: PascalSceneGraph, expressID: number) {
    return Object.values(scene.nodes).filter((node) => metadata(node).expressID === expressID)
  }

  test('converts, leaves the plate out and reports it', async () => {
    const { scene, report } = await convertWithOverflow(
      '#2584=IFCCARTESIANPOINT((930.,45.,90.));',
      '#2584=IFCCARTESIANPOINT((1.E400,45.,90.));',
    )
    expect(conversionReportHasIssues(report)).toBe(true)
    expect(report.skippedGeometry.transforms).toBeGreaterThan(0)
    const meshes = importedMeshes(scene)
    expect(meshes.length).toBeGreaterThan(0)
    for (const mesh of meshes)
      for (const primitive of mesh.primitives)
        expect(primitive.positions.every(Number.isFinite)).toBe(true)
    expect(nodesFor(scene, 2587)).toEqual([])
  }, 60_000)

  test('an unreadable roof is left out, not rebuilt as a floor slab', async () => {
    const { scene, report } = await convertWithOverflow(
      '#174=IFCCARTESIANPOINT((0.,-400.,2700.));',
      '#174=IFCCARTESIANPOINT((1.E400,-400.,2700.));',
    )
    expect(report.skippedGeometry.elements).toBeGreaterThan(0)
    expect(nodesFor(scene, 189)).toEqual([])
    expect(nodesFor(scene, 190).length).toBeGreaterThan(0)
  }, 60_000)

  test('a storey whose placement is unreadable keeps its explicit Elevation', async () => {
    const { scene, report } = await convertWithOverflow(
      "#39=IFCRELAGGREGATES('30qDZxPF51V9OcLHYaYYkO',#5,$,$,#31,(#38));",
      [
        "#39=IFCRELAGGREGATES('30qDZxPF51V9OcLHYaYYkO',#5,$,$,#31,(#38,#9003));",
        '#9000=IFCCARTESIANPOINT((0.,0.,1.E400));',
        '#9001=IFCAXIS2PLACEMENT3D(#9000,$,$);',
        '#9002=IFCLOCALPLACEMENT(#30,#9001);',
        "#9003=IFCBUILDINGSTOREY('0OverflowStorey0000001',#5,'Upper',$,$,#9002,$,$,.ELEMENT.,3000.);",
      ].join('\n'),
    )
    expect(report.replaced.levelElevations).toBe(1)
    const [ground, upper] = [38, 9003].map((expressID) => nodesFor(scene, expressID)[0])
    // 3000 mm, not 0: the storeys stay apart and the ground floor keeps its 3 m height.
    expect(metadata(upper!).elevation).toBeCloseTo(3)
    expect((ground as { height?: number }).height).toBeCloseTo(3)
  }, 60_000)

  test('a vertex whose normal is NaN keeps its triangles, its normal recomputed', async () => {
    const source = await readFile(`${fixturesDirectory}04-ifc-open-house.ifc`)
    const convert = () =>
      convertIfcToPascalWithReport(source, undefined, { simplify: false, wasmPath })
    const triangles = (scene: PascalSceneGraph) =>
      importedMeshes(scene).map((mesh) => [
        metadata(mesh).expressID,
        mesh.primitives.reduce((sum, primitive) => sum + primitive.indices.length / 3, 0),
      ])
    const clean = await convert()

    // web-ifc hands back a NaN normal for some degenerate faces; give every vertex one.
    const read = WebIFC.IfcAPI.prototype.GetVertexArray
    const spy = spyOn(WebIFC.IfcAPI.prototype, 'GetVertexArray').mockImplementation(function (
      this: WebIFC.IfcAPI,
      ...args: Parameters<typeof read>
    ) {
      const vertices = Float32Array.from(read.apply(this, args))
      for (let normal = 3; normal < vertices.length; normal += 6) vertices[normal] = Number.NaN
      return vertices
    })
    let broken: Awaited<ReturnType<typeof convert>>
    try {
      broken = await convert()
    } finally {
      spy.mockRestore()
    }

    expect(broken.report.skippedGeometry.vertices).toBe(0)
    expect(conversionReportHasIssues(broken.report)).toBe(false)
    expect(clean.report.replaced.normals).toBe(0)
    const kept = importedMeshes(broken.scene).reduce(
      (sum, mesh) => sum + mesh.primitives.reduce((n, p) => n + p.positions.length / 3, 0),
      0,
    )
    expect(kept).toBeGreaterThan(0)
    expect(broken.report.replaced.normals).toBeGreaterThanOrEqual(kept)
    // Flat faces: the area-weighted normal is the face's own, as web-ifc gave it.
    const normalsOf = (scene: PascalSceneGraph) =>
      importedMeshes(scene).map((mesh) => mesh.primitives.map((p) => p.normals))
    expect(normalsOf(broken.scene)).toEqual(normalsOf(clean.scene))
    expect(triangles(broken.scene)).toEqual(triangles(clean.scene))
    for (const mesh of importedMeshes(broken.scene))
      for (const { normals } of mesh.primitives) {
        expect(normals.every(Number.isFinite)).toBe(true)
        for (let n = 0; n < normals.length; n += 3)
          expect(Math.hypot(normals[n]!, normals[n + 1]!, normals[n + 2]!)).toBeLessThanOrEqual(
            1.001,
          )
      }
  }, 60_000)

  test('a NaN normal among faces with no area becomes the unit fallback, not zero', async () => {
    const source = await readFile(`${fixturesDirectory}04-ifc-open-house.ifc`)
    // Every vertex at one point (finite, so kept) and every normal NaN: no face has an area.
    const read = WebIFC.IfcAPI.prototype.GetVertexArray
    const spy = spyOn(WebIFC.IfcAPI.prototype, 'GetVertexArray').mockImplementation(function (
      this: WebIFC.IfcAPI,
      ...args: Parameters<typeof read>
    ) {
      const vertices = Float32Array.from(read.apply(this, args))
      for (let v = 0; v + 5 < vertices.length; v += 6) {
        vertices[v] = 1
        vertices[v + 1] = 1
        vertices[v + 2] = 1
        vertices[v + 3] = Number.NaN
      }
      return vertices
    })
    let collapsed: Awaited<ReturnType<typeof convertIfcToPascalWithReport>>
    try {
      collapsed = await convertIfcToPascalWithReport(source, undefined, {
        simplify: false,
        wasmPath,
      })
    } finally {
      spy.mockRestore()
    }
    const normals = importedMeshes(collapsed.scene).flatMap((mesh) =>
      mesh.primitives.flatMap((p) => p.normals),
    )
    expect(normals.length).toBeGreaterThan(0)
    for (let n = 0; n < normals.length; n += 3)
      expect([normals[n], normals[n + 1], normals[n + 2]]).toEqual([0, 0, 1])
    expect(collapsed.report.replaced.normals).toBeGreaterThanOrEqual(normals.length / 3)
  }, 60_000)

  test('a clean file reports nothing', async () => {
    const source = await readFile(`${fixturesDirectory}04-ifc-open-house.ifc`)
    const { report } = await convertIfcToPascalWithReport(source, undefined, {
      simplify: false,
      wasmPath,
    })
    expect(conversionReportHasIssues(report)).toBe(false)
  }, 60_000)
})
