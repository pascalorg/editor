// @ts-expect-error - bun:test is provided by the Bun runtime; viewer does not include Bun globals.
import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  buildRoofSegmentCoveringTriangles,
  buildRoofSegmentShellTriangles,
  getRoofShingleModules,
  RoofNode,
  RoofSegmentNode,
  type RoofSurfaceTriangle,
} from '@pascal-app/core'
import * as THREE from 'three'
import { generateRoofSegmentGeometry } from './roof-system'

type Point = [number, number]
const pitch = (Math.atan(0.5) * 180) / Math.PI
const roof = RoofNode.parse({ id: 'roof_physical', position: [20, 7, -30], rotation: 0.7 })

function segment(patch: Record<string, unknown> = {}): RoofSegmentNode {
  return RoofSegmentNode.parse({
    id: 'rseg_physical',
    parentId: roof.id,
    roofType: 'gable',
    width: 8,
    depth: 6,
    wallHeight: 2,
    pitch,
    wallThickness: 0.2,
    overhang: 0.4,
    deckThickness: 0.18,
    shingleThickness: 0.04,
    fascia: false,
    wallShell: 'omit',
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

function at(triangles: readonly RoofSurfaceTriangle[], [x, z]: Point) {
  const ray = new THREE.Ray(new THREE.Vector3(x, 1000, z), new THREE.Vector3(0, -1, 0))
  const hits = triangles.flatMap((triangle) => {
    const [a, b, c] = triangle.vertices.map((point) => new THREE.Vector3(...point))
    const point = ray.intersectTriangle(a!, b!, c!, false, new THREE.Vector3())
    return point ? [{ y: point.y, normal: new THREE.Vector3(...triangle.normal) }] : []
  })
  return hits.sort((a, b) => b.y - a.y)[0]
}

function expectHeight(triangles: readonly RoofSurfaceTriangle[], point: Point, y: number): void {
  const hit = at(triangles, point)
  expect(hit).toBeDefined()
  expect(hit!.y).toBeCloseTo(y, 8)
}

function validateTriangles(triangles: readonly RoofSurfaceTriangle[]): void {
  for (const { vertices, normal } of triangles) {
    expect(vertices).toHaveLength(3)
    expect(vertices.flat().every(Number.isFinite)).toBe(true)
    const [a, b, c] = vertices.map((point) => new THREE.Vector3(...point))
    const geometric = b!.clone().sub(a!).cross(c!.clone().sub(a!))
    expect(geometric.length()).toBeGreaterThan(1e-12)
    geometric.normalize()
    expect(geometric.y).toBeGreaterThan(0)
    expect(Math.hypot(...normal)).toBeCloseTo(1, 9)
    normal.forEach((value, axis) => {
      expect(value).toBeCloseTo(geometric.getComponent(axis), 8)
    })
  }
}

function float32HalfUlp(value: number): number {
  // Round-to-nearest Float32 uncertainty; include zero and subnormal coordinates.
  return 2 ** Math.max(-150, Math.floor(Math.log2(Math.abs(value))) - 24)
}

function isNativeUpwardFace(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): boolean {
  const ux = b.x - a.x
  const uz = b.z - a.z
  const vx = c.x - a.x
  const vz = c.z - a.z
  const eux = float32HalfUlp(b.x) + float32HalfUlp(a.x)
  const euz = float32HalfUlp(b.z) + float32HalfUlp(a.z)
  const evx = float32HalfUlp(c.x) + float32HalfUlp(a.x)
  const evz = float32HalfUlp(c.z) + float32HalfUlp(a.z)
  // cross.y = uz*vx - ux*vz. Expand both products with coordinate-error intervals;
  // retaining the error products makes this an absolute bound, not a first-order estimate.
  const quantizationError =
    Math.abs(uz) * evx +
    Math.abs(vx) * euz +
    euz * evx +
    Math.abs(ux) * evz +
    Math.abs(vz) * eux +
    eux * evz
  const arithmeticError = 8 * Number.EPSILON * (Math.abs(uz * vx) + Math.abs(ux * vz))
  // A thin vertical CSG cap can have a larger normalized Y error than a broad one.
  // Require provably positive projected area, without an area or angle cutoff.
  return uz * vx - ux * vz > quantizationError + arithmeticError
}

// Renderer triangles, not the new core helpers, establish the physical covering oracle.
// Probe both meshes' face interiors so an omitted facet is not hidden by candidate-only sampling.
// Independent module and analytical shell anchors below guard the recipe shared with the renderer.
function expectNativeCovering(
  node: RoofSegmentNode,
  extraNodes: AnyNode[] = [],
  probes: Point[] = [],
): void {
  const nodes = Object.fromEntries([roof, node, ...extraNodes].map((entry) => [entry.id, entry]))
  const before = structuredClone({ node, nodes })
  const covering = buildRoofSegmentCoveringTriangles(roof, freeze(node), freeze(nodes))
  expect(covering.length).toBeGreaterThan(0)
  validateTriangles(covering)
  expect({ node, nodes }).toEqual(before)
  const geometry = generateRoofSegmentGeometry(node, nodes)
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.updateMatrixWorld(true)
  try {
    const position = geometry.getAttribute('position')
    const index = geometry.getIndex()
    const count = index?.count ?? position.count
    const samples = probes.map((point) => ({ point, source: 'analytic probe' }))
    for (let offset = 0; offset < count; offset += 3) {
      const vertices = [0, 1, 2].map((i) =>
        new THREE.Vector3().fromBufferAttribute(
          position,
          index ? index.getX(offset + i) : offset + i,
        ),
      )
      const [a, b, c] = vertices
      if (!isNativeUpwardFace(a!, b!, c!)) continue
      samples.push({
        point: [(a!.x + b!.x + c!.x) / 3, (a!.z + b!.z + c!.z) / 3],
        source: `native triangle ${offset / 3} centroid`,
      })
      samples.push({
        point: [0.2 * a!.x + 0.6 * b!.x + 0.2 * c!.x, 0.2 * a!.z + 0.6 * b!.z + 0.2 * c!.z],
        source: `native triangle ${offset / 3} interior`,
      })
    }
    for (const {
      vertices: [a, b, c],
    } of covering) {
      samples.push({
        point: [(a[0] + b[0] + c[0]) / 3, (a[2] + b[2] + c[2]) / 3],
        source: 'candidate centroid',
      })
      samples.push({
        point: [0.6 * a[0] + 0.2 * b[0] + 0.2 * c[0], 0.6 * a[2] + 0.2 * b[2] + 0.2 * c[2]],
        source: 'candidate interior',
      })
    }
    expect(samples.length).toBeGreaterThan(3)
    for (const {
      point: [x, z],
      source,
    } of samples) {
      const raycaster = new THREE.Raycaster(
        new THREE.Vector3(x, 1000, z),
        new THREE.Vector3(0, -1, 0),
      )
      const actual = raycaster.intersectObject(mesh, false)[0]
      const physical = at(covering, [x, z])
      const context = JSON.stringify({
        roofType: node.roofType,
        roofSystem: node.roofSystem ?? 'standard',
        point: [x, z],
        source,
        trim: node.trim,
        native: actual
          ? {
              point: actual.point.toArray(),
              normal: actual.face?.normal.toArray(),
              material: actual.face?.materialIndex,
              face: actual.faceIndex,
              vertices: actual.face
                ? [actual.face.a, actual.face.b, actual.face.c].map((vertex) =>
                    new THREE.Vector3().fromBufferAttribute(position, vertex).toArray(),
                  )
                : null,
            }
          : null,
        candidate: physical ? { y: physical.y, normal: physical.normal.toArray() } : null,
      })
      expect(physical !== undefined, context).toBe(actual !== undefined)
      if (!actual || !physical) continue
      // Native BufferGeometry uses Float32 and CSG; this is a metre-space comparison, not a pixel mask.
      expect(Math.abs(physical.y - actual.point.y), context).toBeLessThan(0.0001)
      const normal = actual.face!.normal.clone()
      if (normal.y < 0) normal.negate()
      // At an exact ridge either adjacent plane is a valid hit; compare normals only off shared edges.
      const barycentric = THREE.Triangle.getBarycoord(
        actual.point,
        new THREE.Vector3().fromBufferAttribute(position, actual.face!.a),
        new THREE.Vector3().fromBufferAttribute(position, actual.face!.b),
        new THREE.Vector3().fromBufferAttribute(position, actual.face!.c),
        new THREE.Vector3(),
      )
      if (barycentric && Math.min(barycentric.x, barycentric.y, barycentric.z) > 1e-4) {
        expect(physical.normal.dot(normal), context).toBeGreaterThan(0.99999)
      }
    }
  } finally {
    geometry.dispose()
    material.dispose()
  }
}

test('native sampling distinguishes vertical caps from steep and tiny upward facets', () => {
  const delta = 3 * 2 ** -25
  const controls: { vertices: [THREE.Vector3, THREE.Vector3, THREE.Vector3]; upward: boolean }[] = [
    {
      // An exactly representable vertical x + z = 6 cut.
      vertices: [
        new THREE.Vector3(3, 1, 3),
        new THREE.Vector3(4, 2, 2),
        new THREE.Vector3(3, 3, 3),
      ],
      upward: false,
    },
    {
      // Exactly vertical x + z = 6 + delta before Float32 rounding, but very thin in Y.
      // Mixed XZ binades round its vertices differently, producing a spurious upward normal.
      vertices: [
        new THREE.Vector3(3 + delta, 1, 3),
        new THREE.Vector3(5, 1.001, 1 + delta),
        new THREE.Vector3(4 + delta, 1.002, 2),
      ],
      upward: false,
    },
    {
      // A real rising plane below the discarded 1e-6 angular cutoff still has stable XZ area.
      vertices: [new THREE.Vector3(), new THREE.Vector3(0, 1, 1e-8), new THREE.Vector3(1, 0, 0)],
      upward: true,
    },
    {
      // Horizontal, despite projected area far below the old unnormalized cross-product cutoff.
      vertices: [new THREE.Vector3(), new THREE.Vector3(0, 0, 1e-6), new THREE.Vector3(1e-6, 0, 0)],
      upward: true,
    },
  ]
  for (const { vertices, upward } of controls) {
    for (const scale of [0.001, 1, 1000]) {
      const [a, b, c] = vertices.map(
        (vertex) =>
          new THREE.Vector3(
            Math.fround(vertex.x * scale),
            Math.fround(vertex.y * scale),
            Math.fround(vertex.z * scale),
          ),
      )
      expect(isNativeUpwardFace(a!, b!, c!)).toBe(upward)
    }
  }
})

describe('physical native covering dispatch', () => {
  for (const roofType of [
    'gable',
    'hip',
    'shed',
    'gambrel',
    'mansard',
    'dutch',
    'flat',
    'barrel',
    'conical',
  ]) {
    test(`${roofType} matches actual native geometry rather than a nominal slope`, () => {
      expectNativeCovering(
        segment({
          roofType,
          width: roofType === 'conical' ? 6 : 8,
          barrelRise: 1.1,
          barrelSegments: 7,
        }),
        [],
        [
          [0.31, 0.73],
          [-1.27, -0.83],
          [1.42, -1.13],
        ],
      )
    })
  }

  test('conical sectors retain signed angular coverage instead of returning a full cone', () => {
    for (const sweep of [Math.PI / 2, -Math.PI / 2]) {
      const node = segment({
        roofType: 'conical',
        width: 6,
        conicalFullCircle: false,
        conicalStartAngle: 0.3,
        conicalSweepAngle: sweep,
      })
      expectNativeCovering(node)
      const inside: Point = [Math.cos(0.3 + sweep / 2), Math.sin(0.3 + sweep / 2)]
      const outside: Point = [-inside[0], -inside[1]]
      for (const build of [buildRoofSegmentCoveringTriangles, buildRoofSegmentShellTriangles]) {
        const triangles = build(roof, node)
        expect(at(triangles, inside)).toBeDefined()
        expect(at(triangles, outside)).toBeUndefined()
      }
    }
  })

  test('configured barrel bays keep their native top datum with thickness directed inward', () => {
    const node = segment({
      roofType: 'barrel',
      barrelRise: 1,
      barrelSegments: 4,
      overhang: 0,
      wallThickness: 0,
      deckThickness: 0.4,
      shingleThickness: 0.2,
    })
    expectNativeCovering(node)
    const point: Point = [0.43, 2.5 / Math.sqrt(10)]
    const expected = (1 + 15 / Math.sqrt(10)) / 2
    for (const build of [buildRoofSegmentCoveringTriangles, buildRoofSegmentShellTriangles]) {
      expectHeight(build(roof, node), point, expected)
    }
    const finer = { ...node, barrelSegments: 12 }
    const fineHeight = at(buildRoofSegmentCoveringTriangles(roof, finer), point)!.y
    expect(Math.abs(fineHeight - expected)).toBeGreaterThan(0.01)
    expectNativeCovering(finer)
  })

  for (const roofType of ['gable', 'shed', 'barrel']) {
    test(`glazed ${roofType} uses native pane/frame tops rather than shingle build-up`, () => {
      expectNativeCovering(
        segment({
          roofType,
          roofSystem: 'glazed',
          barrelRise: 1,
          barrelSegments: 5,
          glazing: { across: { layout: 'count', count: 2 }, along: { layout: 'count', count: 1 } },
        }),
      )
    })
  }

  test('empty glazing panes stay unsupported in both covering and structural masks', () => {
    const node = segment({
      roofType: 'gable',
      roofSystem: 'glazed',
      width: 4,
      depth: 4,
      overhang: 0,
      wallThickness: 0,
      glazing: {
        across: { layout: 'count', count: 2 },
        along: { layout: 'count', count: 1 },
        panels: [{ face: 'front', column: 0, row: 0, type: 'empty' }],
      },
    })
    expectNativeCovering(
      node,
      [],
      [
        [-1, 1],
        [1, 1],
        [-1, -1],
      ],
    )
    for (const build of [buildRoofSegmentCoveringTriangles, buildRoofSegmentShellTriangles]) {
      const triangles = build(roof, node)
      expect(at(triangles, [-1, 1])).toBeUndefined()
      expectHeight(triangles, [1, 1], 2.5)
      expectHeight(triangles, [-1, -1], 2.5)
    }
  })

  for (const patch of [
    { roofType: 'gable' },
    { roofType: 'barrel' },
    { roofType: 'gable', roofSystem: 'glazed' },
  ]) {
    test(`${patch.roofType}/${patch.roofSystem ?? 'standard'} trims remove support from both masks but retain the rest`, () => {
      const node = segment({ ...patch, trim: { left: 1, frontRightX: 1, frontRightZ: 1 } })
      expectNativeCovering(
        node,
        [],
        [
          [-3.5, 0],
          [3.8, 2.8],
          [0.3, 0.7],
        ],
      )
      for (const build of [buildRoofSegmentCoveringTriangles, buildRoofSegmentShellTriangles]) {
        const triangles = build(roof, node)
        expect(at(triangles, [-3.5, 0])).toBeUndefined()
        expect(at(triangles, [3.8, 2.8])).toBeUndefined()
        expect(at(triangles, [0.3, 0.7])).toBeDefined()
      }
    })
  }

  test('fascia tops support covering but do not expand the structural footprint', () => {
    const node = segment({
      roofType: 'flat',
      pitch: 0,
      overhang: 0.5,
      deckThickness: 0.2,
      shingleThickness: 0.02,
      fascia: true,
      fasciaHeight: 0.3,
      fasciaDepth: 0.03,
    })
    expectNativeCovering(node, [], [[4.62, 0.3]])
    expectHeight(buildRoofSegmentCoveringTriangles(roof, node), [4.62, 0.3], 2.22)
    expect(at(buildRoofSegmentShellTriangles(roof, node), [4.62, 0.3])).toBeUndefined()
  })

  test('Dutch rake tops and opposite-axis Dutch geometry retain their native raised seat', () => {
    for (const [width, depth] of [
      [10, 6],
      [6, 10],
    ]) {
      expectNativeCovering(segment({ roofType: 'dutch', width, depth, dutchGabletRake: 0.6 }))
    }
  })

  test('bare and stored curved bands retain faceted physical support, not a filled sector', () => {
    const patch = {
      roofType: 'shed',
      width: 4,
      depth: 2,
      arc: { centerX: 0, centerZ: 4, radius: 5 },
      wallThickness: 0.01,
      overhang: 0,
    }
    for (const extra of [
      {},
      {
        shedFootprintPieces: [
          [
            [-2, -1],
            [2, -1],
            [2, 1],
            [-2, 1],
          ],
        ],
      },
    ]) {
      const node = segment({ ...patch, ...extra })
      expectNativeCovering(node, [], [[0.2, 4]])
      for (const build of [buildRoofSegmentCoveringTriangles, buildRoofSegmentShellTriangles]) {
        expect(at(build(roof, node), [0.2, 4])).toBeUndefined()
      }
    }
  })

  test('custom triangular seam keeps its pinned plane and native trim bypass', () => {
    const node = segment({
      roofType: 'shed',
      width: 4,
      depth: 4,
      pitch: 0,
      deckThickness: 0.2,
      shingleThickness: 0.05,
      overhang: 0,
      wallThickness: 0.01,
      shedFootprintPieces: [
        [
          [0, -1],
          [0, 1],
          [-2, 0],
        ],
      ],
      trim: { left: 3 },
    })
    const sibling = segment({
      id: 'rseg_sibling',
      roofType: 'shed',
      width: 4,
      depth: 4,
      pitch: 0,
      wallHeight: 5,
      deckThickness: 0.2,
      shingleThickness: 0.05,
      overhang: 0,
      wallThickness: 0.01,
      arc: { centerX: 0, centerZ: 10, radius: 10 },
      shedFootprintPieces: [
        [
          [0, -2],
          [2, -2],
          [2, 2],
          [0, 2],
        ],
      ],
    })
    const nodes = { [roof.id]: roof, [node.id]: node, [sibling.id]: sibling }
    expectNativeCovering(node, [sibling])
    const covering = buildRoofSegmentCoveringTriangles(roof, node, nodes)
    const shell = buildRoofSegmentShellTriangles(roof, node, nodes)
    expectHeight(covering, [-2 / 3, 0], 4.25)
    expectHeight(shell, [-2 / 3, 0], 4)
    const normal = at(covering, [-2 / 3, 0])!.normal
    expect(normal.x).toBeCloseTo(-1.5 / Math.sqrt(3.25), 9)
    expect(normal.y).toBeCloseTo(1 / Math.sqrt(3.25), 9)
    expect(normal.z).toBeCloseTo(0, 9)
  })

  test('collapsed stored shed support stays empty instead of inventing a nominal rectangle', () => {
    const node = segment({
      roofType: 'shed',
      shedFootprintPieces: [
        [
          [0, 0],
          [1, 0],
          [2, 0],
        ],
      ],
    })
    expect(buildRoofSegmentCoveringTriangles(roof, node)).toEqual([])
    expect(buildRoofSegmentShellTriangles(roof, node)).toEqual([])
  })
})

describe('independent structural surface anchors', () => {
  const cases: { roofType: string; point: Point; y: number; patch?: Record<string, unknown> }[] = [
    { roofType: 'flat', point: [0.3, 0.7], y: 2 },
    { roofType: 'gable', point: [0, 1], y: 3 },
    { roofType: 'shed', point: [0, -1], y: 4 },
    { roofType: 'hip', point: [2, 0], y: 3 },
    { roofType: 'gambrel', point: [0, 2.25], y: 2.375 },
    { roofType: 'gambrel', point: [0, 0.75], y: 3 },
    { roofType: 'mansard', point: [0, 0], y: 2 + 9 / 14 },
    { roofType: 'dutch', point: [0, 0.75], y: 3.125, patch: { dutchWaistLengthRatio: 1 } },
    {
      roofType: 'conical',
      point: [0.75 * (1 + Math.cos(Math.PI / 24)), -0.75 * Math.sin(Math.PI / 24)],
      y: 2.75,
      patch: { width: 6, depth: 6 },
    },
  ]
  for (const { roofType, point, y, patch } of cases) {
    test(`${roofType} structural height at ${point.join(',')} excludes physical build-up`, () => {
      const node = segment({ roofType, ...patch })
      const triangles = buildRoofSegmentShellTriangles(roof, freeze(node))
      validateTriangles(triangles)
      expectHeight(triangles, point, y)
      expect(at(triangles, [10, 10])).toBeUndefined()
    })
  }
})

describe('brush shingle module numeric recipe', () => {
  test('gable and shed dimensions, heights and shed shift retain the native construction recipe', () => {
    const base = segment({
      pitch: 45,
      wallThickness: 0.2,
      overhang: 0,
      deckThickness: 0.2,
      shingleThickness: 0.1,
    })
    const gable = getRoofShingleModules(freeze(base))
    const bottomY = 1.9 + 0.2 * Math.SQRT2
    expect(gable.bottom.w).toBeCloseTo(8.2, 9)
    expect(gable.bottom.d).toBeCloseTo(6.2, 9)
    expect(gable.bottom.wh).toBeCloseTo(bottomY, 9)
    expect(gable.bottom.rh).toBeCloseTo(3.1, 9)
    expect(gable.bottom.baseY).toBeCloseTo(bottomY - 2, 9)
    expect(gable.top.w).toBeCloseTo(8.2, 9)
    expect(gable.top.d).toBeCloseTo(6.2 + 0.1 * Math.SQRT2, 9)
    expect(gable.top.wh).toBeCloseTo(bottomY + 0.1 / Math.SQRT2, 9)
    expect(gable.top.rh).toBeCloseTo(3.1 + 0.1 / Math.SQRT2, 9)
    expect(gable.top.baseY).toBeCloseTo(bottomY - 1, 9)
    expect(gable.shiftZ).toBe(0)
    const shed = getRoofShingleModules({ ...base, roofType: 'shed' })
    expect(shed.bottom.rh).toBeCloseTo(6.2, 9)
    expect(shed.top.d).toBeCloseTo(6.2 + 0.1 / Math.SQRT2, 9)
    expect(shed.top.rh).toBeCloseTo(6.2 + 0.1 / Math.SQRT2, 9)
    expect(shed.shiftZ).toBeCloseTo(0.05 / Math.SQRT2, 9)
    const hip = getRoofShingleModules({ ...base, roofType: 'hip' })
    expect(hip.top.w).toBeCloseTo(8.2 + 0.1 * Math.SQRT2, 9)
    expect(hip.top.d).toBeCloseTo(6.2 + 0.1 * Math.SQRT2, 9)
    expect(hip.top.wh).toBeCloseTo(bottomY + 0.1 / Math.SQRT2, 9)
    expect(hip.shiftZ).toBe(0)
    const flat = getRoofShingleModules({ ...base, roofType: 'flat' })
    expect(flat.top.w).toBeCloseTo(8.2, 9)
    expect(flat.top.d).toBeCloseTo(6.2, 9)
    expect(flat.top.wh).toBeCloseTo(2.3, 9)
    expect(flat.top.rh).toBe(0)
    expect(flat.shiftZ).toBe(0)
  })

  test('plate-seated eaves remain below the plate instead of being clamped upward', () => {
    const modules = getRoofShingleModules(
      segment({
        wallHeight: 0,
        wallThickness: 0,
        pitch: 45,
        overhang: 1,
        deckThickness: 0.1,
        shingleThickness: 0.05,
      }),
    )
    expect(modules.bottom.wh).toBeCloseTo(-0.4 * Math.SQRT2, 9)
    expect(modules.top.wh).toBeCloseTo(-0.4 * Math.SQRT2 + 0.05 / Math.SQRT2, 9)
  })
})
