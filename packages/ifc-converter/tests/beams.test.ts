import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AnyNode, type BlockNode, BlockTopology } from '@pascal-app/core'
import * as WebIFC from 'web-ifc'
import { convertIfcToPascal, type PascalSceneGraph } from '../src'

const fixture = new URL('./fixtures/beams.ifc', import.meta.url)
const duplex = new URL(
  '../../../apps/ifc-converter/public/test-ifc-files/01-duplex.ifc',
  import.meta.url,
)
const originalSetWasmPath = WebIFC.IfcAPI.prototype.SetWasmPath
const originalGetLineIDsWithType = WebIFC.IfcAPI.prototype.GetLineIDsWithType

function beams(graph: PascalSceneGraph) {
  return Object.values(graph.nodes).filter(
    (node): node is BlockNode =>
      node.type === 'block' && String(node.metadata.ifcType).startsWith('IFCBEAM'),
  )
}

function bounds(node: BlockNode) {
  const points = node.topology.vertices.map((vertex) =>
    vertex.position.map((value, axis) => value + node.position[axis]!),
  )
  return [
    [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis]!))),
    [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis]!))),
  ]
}

function signedVolume(node: BlockNode) {
  const vertices = new Map(node.topology.vertices.map((vertex) => [vertex.id, vertex.position]))
  return node.topology.faces.reduce((volume, face) => {
    const [a, b, c] = face.vertexIds.map((id) => vertices.get(id)!)
    return (
      volume +
      (a![0] * (b![1] * c![2] - b![2] * c![1]) +
        a![1] * (b![2] * c![0] - b![0] * c![2]) +
        a![2] * (b![0] * c![1] - b![1] * c![0])) /
        6
    )
  }, 0)
}

function expectBounds(node: BlockNode, expected: number[][]) {
  const actual = bounds(node)
  for (let side = 0; side < 2; side++) {
    for (let axis = 0; axis < 3; axis++) {
      expect(actual[side]![axis]).toBeCloseTo(expected[side]![axis]!, 5)
    }
  }
}

function assertAttached(graph: PascalSceneGraph, node: BlockNode) {
  const parent = node.parentId ? graph.nodes[node.parentId] : undefined
  expect(parent?.type).toBe('level')
  expect(node.metadata.levelId).toBe(parent?.id)
  if (parent && 'children' in parent) {
    expect(parent.children.filter((id) => id === node.id)).toHaveLength(1)
  }
  expect(BlockTopology.safeParse(node.topology).success).toBe(true)
  expect(AnyNode.parse(JSON.parse(JSON.stringify(node)))).toEqual(node)
  expect(node.supportSlabId).toBe('ground')
}

describe('IFC beam import', () => {
  const spies: { mockRestore: () => void }[] = []

  beforeEach(() => {
    const wasmPath = `${dirname(fileURLToPath(import.meta.resolve('web-ifc')))}/`
    spies.push(
      spyOn(WebIFC.IfcAPI.prototype, 'SetWasmPath').mockImplementation(function (
        this: WebIFC.IfcAPI,
      ) {
        originalSetWasmPath.call(this, wasmPath, true)
      }),
    )
  })

  afterEach(() => {
    for (const spy of spies.splice(0).reverse()) spy.mockRestore()
  })

  for (const simplify of [false, true]) {
    it(`preserves all eight duplex I-beams with simplify=${simplify}`, async () => {
      const graph = await convertIfcToPascal(await Bun.file(duplex).bytes(), undefined, {
        simplify,
      })
      const imported = beams(graph)
      expect(imported.map((node) => node.metadata.expressID).sort()).toEqual([
        28785, 28839, 28883, 28927, 28971, 29015, 29059, 29103,
      ])
      for (const node of imported) {
        assertAttached(graph, node)
        expect(node.topology.faces.length).toBeGreaterThan(12)
        expect(signedVolume(node)).toBeGreaterThan(0)
      }
      const first = imported.find((node) => node.metadata.expressID === 28785)!
      const level = graph.nodes[first.parentId!]
      const elevation = Number(level?.metadata.elevation)
      expectBounds(first, [
        [4.2985, 2.797 - elevation, -17.4213],
        [4.5015, 3.1 - elevation, -10],
      ])
      expect(first.metadata.globalId).toBe('2OrWItJ6zAwBNp0OUxK_l8')
      expect(first.metadata.material).toBe('Metal - Steel - 345 MPa')
    })
  }

  for (const swapYZ of [true, false]) {
    it(`converts millimeters, nested placements, slopes and storey offsets with swapYZ=${swapYZ}`, async () => {
      const graph = await convertIfcToPascal(await Bun.file(fixture).bytes(), undefined, { swapYZ })
      const imported = beams(graph)
      expect(imported).toHaveLength(2)
      const horizontal = imported.find((node) => node.metadata.expressID === 100)!
      const sloped = imported.find((node) => node.metadata.expressID === 130)!
      const expected = [
        [7.8, 2.35, 21],
        [8.2, 2.65, 25],
      ]
      expectBounds(horizontal, swapYZ ? expected : expected.map(([x, y, z]) => [x!, z!, y!]))
      const halfDepth = 0.15 / Math.SQRT2
      const rise = 4 / Math.SQRT2
      const slopedExpected = [
        [7.8, 2.5 - halfDepth, 23 - halfDepth],
        [8.2, 2.5 + rise + halfDepth, 23 + rise + halfDepth],
      ]
      expectBounds(
        sloped,
        swapYZ ? slopedExpected : slopedExpected.map(([x, y, z]) => [x!, z!, y!]),
      )
      expect(sloped.metadata.ifcType).toBe('IFCBEAMSTANDARDCASE')
      expect(horizontal.name).toBe('Horizontal beam')
      expect(horizontal.metadata.properties).toEqual({ Pset_BeamCommon: { Reference: 'B1' } })
      for (const node of imported) {
        assertAttached(graph, node)
        expect(node.metadata.material).toBe('Steel')
        expect(signedVolume(node)).toBeCloseTo(0.4 * 0.3 * 4, 5)
      }
    })
  }

  it('emits each beam once when type queries return repeated IDs', async () => {
    spies.push(
      spyOn(WebIFC.IfcAPI.prototype, 'GetLineIDsWithType').mockImplementation(function (
        this: WebIFC.IfcAPI,
        modelID,
        type,
        inherited,
      ) {
        const ids = originalGetLineIDsWithType.call(this, modelID, type, inherited)
        if (type !== WebIFC.IFCBEAM && type !== WebIFC.IFCBEAMSTANDARDCASE) return ids
        const repeated = Array.from({ length: ids.size() * 2 }, (_, i) => ids.get(i % ids.size()))
        return {
          size: () => repeated.length,
          get: (i: number) => repeated[i]!,
          [Symbol.iterator]: () => repeated.values(),
        }
      }),
    )
    const graph = await convertIfcToPascal(await Bun.file(fixture).bytes(), undefined, {
      simplify: false,
    })
    expect(beams(graph)).toHaveLength(2)
    for (const node of beams(graph)) assertAttached(graph, node)
  })

  it('preserves all placed parts of a mapped representation', async () => {
    const source = await Bun.file(fixture).text()
    const mapped = source.replace('#92,#97,', '#92,#309,').replace(
      'ENDSEC;\nEND-ISO',
      `
#300=IFCREPRESENTATIONMAP(#6,#96);
#301=IFCCARTESIANPOINT((1000.,0.,0.));
#302=IFCCARTESIANTRANSFORMATIONOPERATOR3D(#4,#5,#301,1.,#3);
#303=IFCMAPPEDITEM(#300,#302);
#304=IFCCARTESIANPOINT((6000.,0.,0.));
#305=IFCCARTESIANTRANSFORMATIONOPERATOR3D(#4,#5,#304,1.,#3);
#306=IFCMAPPEDITEM(#300,#305);
#308=IFCSHAPEREPRESENTATION(#8,'Body','MappedRepresentation',(#303,#306));
#309=IFCPRODUCTDEFINITIONSHAPE($,$,(#308));
ENDSEC;
END-ISO`,
    )
    const graph = await convertIfcToPascal(new TextEncoder().encode(mapped))
    const node = beams(graph).find((candidate) => candidate.metadata.expressID === 100)!
    assertAttached(graph, node)
    expect(node.topology.faces).toHaveLength(24)
    expectBounds(node, [
      [7.8, 2.35, 22],
      [8.2, 2.65, 31],
    ])
    expect(signedVolume(node)).toBeCloseTo(2 * 0.4 * 0.3 * 4, 5)
  })

  it('retains uncontained beams as reachable roots', async () => {
    const source = (await Bun.file(fixture).text()).replace(/^#42=.*\n/m, '')
    const graph = await convertIfcToPascal(new TextEncoder().encode(source))
    const node = beams(graph).find((candidate) => candidate.metadata.expressID === 100)!
    expect(node.parentId).toBeNull()
    expect(graph.rootNodeIds).toContain(node.id)
    expectBounds(node, [
      [7.8, 8.35, 21],
      [8.2, 8.65, 25],
    ])
  })

  it('reports a missing representation and continues importing other beams', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    spies.push(warn)
    const data = (await Bun.file(fixture).text()).replace('#92,#97,', '#92,$,')
    const graph = await convertIfcToPascal(new TextEncoder().encode(data))
    expect(beams(graph).map((node) => node.metadata.expressID)).toEqual([130])
    expect(warn.mock.calls.some(([message]) => String(message).includes('beam #100'))).toBe(true)
  })
})
