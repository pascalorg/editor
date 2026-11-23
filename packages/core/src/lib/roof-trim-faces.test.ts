import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  getDutchRakeBoardTops,
  getRoofFasciaBoardFaces,
  RoofNode,
  RoofSegmentNode,
  type RoofShapeFaceVertex,
  type RoofShapeRatios,
  wearsRoofFascia,
} from '../index'

type Vertex = RoofShapeFaceVertex
type Box = { min: Vertex; max: Vertex }

function segment(patch: Record<string, unknown> = {}): RoofSegmentNode {
  return RoofSegmentNode.parse({
    id: 'rseg_fascia',
    roofType: 'flat',
    width: 8,
    depth: 6,
    wallHeight: 2,
    pitch: 0,
    wallThickness: 0.2,
    overhang: 0.5,
    deckThickness: 0.2,
    shingleThickness: 0.02,
    fascia: true,
    fasciaHeight: 0.3,
    fasciaDepth: 0.03,
    ...patch,
  })
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

function cross(a: Vertex, b: Vertex, c: Vertex): Vertex {
  return {
    x: (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y),
    y: (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z),
    z: (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
  }
}

function signedVolume(faces: Vertex[][]): number {
  let volume = 0
  for (const face of faces) {
    const a = face[0]!
    for (let index = 1; index + 1 < face.length; index++) {
      const b = face[index]!
      const c = face[index + 1]!
      volume +=
        (a.x * (b.y * c.z - b.z * c.y) +
          a.y * (b.z * c.x - b.x * c.z) +
          a.z * (b.x * c.y - b.y * c.x)) /
        6
    }
  }
  return volume
}

function expectVertex(vertices: Vertex[], expected: Vertex): void {
  expect(
    vertices.some(
      (point) =>
        Math.hypot(point.x - expected.x, point.y - expected.y, point.z - expected.z) < 1e-9,
    ),
  ).toBe(true)
}

function expectBoxes(faces: Vertex[][], boxes: Box[]): void {
  const axes = ['x', 'y', 'z'] as const
  for (const face of faces) {
    expect(face.length).toBeGreaterThanOrEqual(3)
    // Allow different face ordering/tessellation, but every face must belong to a box wall.
    const box = boxes.find(
      ({ min, max }) =>
        face.every((point) =>
          axes.every((axis) => point[axis] >= min[axis] - 1e-9 && point[axis] <= max[axis] + 1e-9),
        ) &&
        axes.some((axis) =>
          [min[axis], max[axis]].some((plane) =>
            face.every((point) => Math.abs(point[axis] - plane) < 1e-9),
          ),
        ),
    )
    expect(box).toBeDefined()
    const normal = cross(face[0]!, face[1]!, face[2]!)
    const center = face.reduce(
      (sum, point) => ({
        x: sum.x + point.x / face.length,
        y: sum.y + point.y / face.length,
        z: sum.z + point.z / face.length,
      }),
      { x: 0, y: 0, z: 0 },
    )
    const outward = axes.reduce(
      (sum, axis) => sum + normal[axis] * (center[axis] - (box!.min[axis] + box!.max[axis]) / 2),
      0,
    )
    expect(outward).toBeGreaterThan(0)
  }
  const expectedVolume = boxes.reduce(
    (sum, { min, max }) => sum + (max.x - min.x) * (max.y - min.y) * (max.z - min.z),
    0,
  )
  expect(signedVolume(faces)).toBeCloseTo(expectedVolume, 9)
  for (const { min, max } of boxes) {
    for (const x of [min.x, max.x]) {
      for (const y of [min.y, max.y]) {
        for (const z of [min.z, max.z]) expectVertex(faces.flat(), { x, y, z })
      }
    }
  }
}

// Geometry is independently specified as boxes, sloped sections and four planar strips.
// The existing native renderer fixes the .002 embed, .0001 butt gap and .0002 Dutch seat.
// No expected face is obtained from the new geometry helpers or their numeric outputs.
describe('fascia eligibility', () => {
  test('requires explicit fascia and keeps lean-to trim separate', () => {
    expect(wearsRoofFascia(segment({ fascia: undefined }))).toBe(false)
    expect(wearsRoofFascia(segment({ fascia: false }))).toBe(false)
    expect(wearsRoofFascia(segment({ roofType: 'shed' }))).toBe(true)
    for (const leanTo of [
      { shedSideInfillSpan: 2 },
      { shedSideInfillMinX: -1 },
      { shedSideInfillMaxX: 1 },
      { shedFootprintPieces: [] },
      { shedOpenEndSides: [] },
    ]) {
      expect(wearsRoofFascia(segment({ roofType: 'shed', ...leanTo }))).toBe(false)
    }
    // Policy and supported geometry forms are separate contracts.
    expect(wearsRoofFascia(segment({ roofType: 'dutch' }))).toBe(true)
  })

  test('suppresses composite shed fascia using actual segment children when nodes are available', () => {
    const shed = segment({ roofType: 'shed' })
    const other = segment({ id: 'rseg_other' })
    const childRoof = RoofNode.parse({ id: 'roof_child' })
    const roof = RoofNode.parse({ id: 'roof_parent', children: [shed.id, other.id, childRoof.id] })
    const nodes: Record<string, AnyNode> = {
      [shed.id]: shed,
      [other.id]: other,
      [childRoof.id]: childRoof,
    }
    expect(wearsRoofFascia(shed, roof, nodes)).toBe(false)
    const single = { ...roof, children: [shed.id, childRoof.id] }
    expect(wearsRoofFascia(shed, single, nodes)).toBe(true)
    expect(wearsRoofFascia(shed, single)).toBe(false)
    expect(wearsRoofFascia(segment({ roofType: 'gable' }), roof, nodes)).toBe(true)
  })
})

describe('native fascia board faces', () => {
  test('flat coping boards retain exact embed, butt gap, membrane rise, volume and outward faces', () => {
    const node = freeze(
      segment({
        fascia: false,
        position: [30, 8, 50],
        rotation: 1,
        trim: { left: 1, front: 2 },
      }),
    )
    const faces = getRoofFasciaBoardFaces(node)
    // 8x6 walls + .1 half-wall + .5 overhang; board .03 thick, .3 high.
    // Geometry is untrimmed/local and independent of the eligibility policy.
    expectBoxes(faces, [
      { min: { x: -4.63, y: 1.92, z: 3.598 }, max: { x: 4.63, y: 2.22, z: 3.63 } },
      { min: { x: -4.63, y: 1.92, z: -3.63 }, max: { x: 4.63, y: 2.22, z: -3.598 } },
      { min: { x: 4.598, y: 1.92, z: -3.5979 }, max: { x: 4.63, y: 2.22, z: 3.5979 } },
      { min: { x: -4.63, y: 1.92, z: -3.5979 }, max: { x: -4.598, y: 2.22, z: 3.5979 } },
    ])
  })

  test('hip boards stay level on all four eaves rather than generating gable rakes', () => {
    const faces = getRoofFasciaBoardFaces(
      segment({
        roofType: 'hip',
        pitch: (Math.atan(0.5) * 180) / Math.PI,
        overhang: 0,
      }),
    )
    const top = 1.95 + 0.1 * Math.sqrt(5)
    expectBoxes(faces, [
      { min: { x: -4.13, y: top - 0.3, z: 3.098 }, max: { x: 4.13, y: top, z: 3.13 } },
      { min: { x: -4.13, y: top - 0.3, z: -3.13 }, max: { x: 4.13, y: top, z: -3.098 } },
      { min: { x: 4.098, y: top - 0.3, z: -3.0979 }, max: { x: 4.13, y: top, z: 3.0979 } },
      { min: { x: -4.13, y: top - 0.3, z: -3.0979 }, max: { x: -4.098, y: top, z: 3.0979 } },
    ])
  })

  test('gable rakes follow the slope and their own overhang, with the ridge butt gap retained', () => {
    const points = getRoofFasciaBoardFaces(
      segment({
        roofType: 'gable',
        pitch: (Math.atan(0.5) * 180) / Math.PI,
        overhang: 0,
        gableOverhang: 0.7,
      }),
    ).flat()
    const top = 1.95 + 0.1 * Math.sqrt(5)
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        expectVertex(points, { x: sx * 4.83, y: top, z: sz * 3.13 })
        expectVertex(points, { x: sx * 4.798, y: top + 0.00105, z: sz * 3.0979 })
        expectVertex(points, { x: sx * 4.83, y: 3.49995 + 0.1 * Math.sqrt(5), z: sz * 0.0001 })
      }
    }
    expect(Math.max(...points.map((point) => point.y))).toBeCloseTo(3.49995 + 0.1 * Math.sqrt(5), 9)
    expect(Math.max(...points.map((point) => point.x))).toBeCloseTo(4.83, 9)
  })

  test('square-cut fascia stays perpendicular to the slope, including its embedded back', () => {
    const points = getRoofFasciaBoardFaces(
      segment({
        roofType: 'gable',
        pitch: (Math.atan(0.5) * 180) / Math.PI,
        overhang: 0,
        gableOverhang: 0.7,
        eaveCut: 'square',
      }),
    ).flat()
    const cos = 2 / Math.sqrt(5)
    const sin = 1 / Math.sqrt(5)
    const top = 1.95 + 0.1 * Math.sqrt(5)
    for (const side of [-1, 1]) {
      expectVertex(points, { x: 4.83, y: top + 0.002 * sin, z: side * (3.1 - 0.002 * cos) })
      expectVertex(points, { x: 4.83, y: top - 0.03 * sin, z: side * (3.1 + 0.03 * cos) })
      expectVertex(points, {
        x: 4.83,
        y: top - 0.3 * cos - 0.03 * sin,
        z: side * (3.1 - 0.3 * sin + 0.03 * cos),
      })
    }
  })

  test('stock plumb boards and boxed eaves retain their different lower edges', () => {
    const base = segment({
      roofType: 'gable',
      pitch: (Math.atan(0.5) * 180) / Math.PI,
      overhang: 0,
      fasciaHeight: undefined,
    })
    const plumb = getRoofFasciaBoardFaces(base).flat()
    // The unboxed .2 m deck takes a whole 1x10 (actual 9.25 inches).
    expect(Math.min(...plumb.map((point) => point.y))).toBeCloseTo(
      1.95 + 0.1 * Math.sqrt(5) - 9.25 * 0.0254,
      9,
    )
    const boxed = getRoofFasciaBoardFaces({ ...base, eaveCut: 'plumb-level' }).flat()
    // .0889 m level cut at 1:2 pitch, then .01905 m board drop: 2-.05+.04445-.01905.
    expect(Math.min(...boxed.map((point) => point.y))).toBeCloseTo(1.9754, 9)
  })

  test('shed high-edge boards can be omitted without losing the two rakes or low eave', () => {
    const node = segment({
      roofType: 'shed',
      pitch: (Math.atan(0.5) * 180) / Math.PI,
      overhang: 0,
      gableOverhang: 0.7,
    })
    const on = getRoofFasciaBoardFaces(node).flat()
    const off = getRoofFasciaBoardFaces({ ...node, fasciaHighEdge: false }).flat()
    expectVertex(on, { x: 4.83, y: 5.05 + 0.1 * Math.sqrt(5), z: -3.13 })
    expect(off.some((point) => point.z < -3.1)).toBe(false)
    expectVertex(off, { x: 4.83, y: 1.95 + 0.1 * Math.sqrt(5), z: 3.13 })
    expectVertex(off, { x: 4.798, y: 5.04895 + 0.1 * Math.sqrt(5), z: -3.0979 })
  })

  test('does not fabricate fascia solids for unsupported forms', () => {
    for (const roofType of ['gambrel', 'mansard', 'dutch', 'barrel', 'conical']) {
      expect(getRoofFasciaBoardFaces(segment({ roofType }))).toEqual([])
    }
  })
})

const ratios: RoofShapeRatios = {
  gambrelLowerWidthRatio: 0.5,
  mansardSteepWidthRatio: 0.15,
  dutchHipWidthRatio: 0.25,
  dutchHipHeightRatio: 0.5,
  dutchWaistLengthRatio: 1,
  dutchGabletRake: 0.5,
}
const dutch = { w: 10, d: 6, wh: 2, rh: 4, dutchI: 1, shapeRatios: ratios, thickness: 0.2 }

function expectDutchTops(faces: Vertex[][], transpose: boolean, reach: number): void {
  expect(faces).toHaveLength(4)
  const offset = 0.0002 / Math.sqrt(2)
  const expected: Vertex[] = []
  for (const end of [-1, 1]) {
    for (const slope of [-1, 1]) {
      for (const x of [end * 4, end * (4 + reach)]) {
        for (const [y, z] of [
          [6 + offset, slope * offset],
          [4 + offset, slope * (2 + offset)],
        ]) {
          expected.push(transpose ? { x: z!, y: y!, z: x } : { x, y: y!, z: z! })
        }
      }
    }
  }
  const actual = faces.flat()
  for (const point of expected) expectVertex(actual, point)
  for (const point of actual) expectVertex(expected, point)
  let area = 0
  for (const face of faces) {
    for (let index = 1; index + 1 < face.length; index++) {
      const normal = cross(face[0]!, face[index]!, face[index + 1]!)
      expect(normal.y).toBeGreaterThan(0)
      area += Math.hypot(normal.x, normal.y, normal.z) / 2
    }
  }
  expect(area).toBeCloseTo(4 * reach * Math.sqrt(8), 9)
}

describe('Dutch rake board top surfaces', () => {
  test('four width-axis strips seat above the actual shingle module along unit normals', () => {
    expectDutchTops(getDutchRakeBoardTops(freeze(dutch)), false, 0.5)
  })

  test('depth-axis roofs transpose the geometry, not its upward winding', () => {
    expectDutchTops(getDutchRakeBoardTops({ ...dutch, w: 6, d: 10 }), true, 0.5)
  })

  test('clips excessive rake reach before the outer hip edge and keeps thickness below the top', () => {
    const input = { ...dutch, shapeRatios: { ...ratios, dutchGabletRake: 10 } }
    expectDutchTops(getDutchRakeBoardTops(input), false, 0.98)
    expectDutchTops(getDutchRakeBoardTops({ ...dutch, thickness: 0.8 }), false, 0.5)
  })

  test('omits missing, collapsed or zero-thickness boards at the renderer thresholds', () => {
    for (const patch of [
      { thickness: 0.0001 },
      { dutchI: 0.001 },
      { rh: 0.001 },
      { shapeRatios: { ...ratios, dutchGabletRake: 0.001 } },
      { shapeRatios: { ...ratios, dutchHipHeightRatio: 1 } },
      { shapeRatios: { ...ratios, dutchWaistLengthRatio: 0 } },
    ]) {
      expect(getDutchRakeBoardTops({ ...dutch, ...patch })).toEqual([])
    }
  })
})
