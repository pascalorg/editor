import { describe, expect, test } from 'bun:test'
import {
  createTerrainField,
  encodeTerrainField,
  type GeometryContext,
  ROCK_LIMITS,
  RockNode,
  rockSections,
  SiteNode,
} from '@pascal-app/core'
import { LOD, Mesh, PerspectiveCamera, Scene } from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { rockDefinition } from './definition'
import { buildRockFloorplan } from './floorplan'
import { ROCK_BASE_COLORS, rockMaterial } from './geology'
import { buildRockBakeGeometry, buildRockGeometry } from './geometry'

const site = SiteNode.parse({
  // Source mesh/section assertions use a datum-zero ground, explicitly persisted on main.
  terrain: encodeTerrainField(createTerrainField()),
  polygon: {
    type: 'polygon',
    points: [
      [-20, -20],
      [20, -20],
      [20, 20],
      [-20, 20],
    ],
  },
})
const outline: [number, number][] = [
  [0, 0],
  [6, 0],
  [6, 4],
  [0, 4],
]
const rock = (extra: Partial<RockNode> = {}) =>
  RockNode.parse({ parentId: site.id, polygon: outline, height: 3, seed: 11, ...extra })
const context = { parent: site } as unknown as GeometryContext

function meshOf(node: RockNode) {
  const lod = buildRockGeometry(node, context).getObjectByName('rock-lod')
  if (!(lod instanceof LOD)) throw new Error('A rock builds a rock-lod LOD')
  const mesh = lod.levels[0]?.object
  if (!(mesh instanceof Mesh)) throw new Error('rock-lod holds a near Mesh')
  return mesh
}

describe('a rock’s mesh', () => {
  test('is one mesh from below the ground to exactly the rock’s height', () => {
    const mesh = meshOf(rock())

    mesh.geometry.computeBoundingBox()
    const box = mesh.geometry.boundingBox
    expect(box?.min.y).toBeLessThan(0)
    expect(box?.max.y).toBeCloseTo(3, 9)
  })

  test('stays within its outline', () => {
    const mesh = meshOf(rock())

    mesh.geometry.computeBoundingBox()
    const box = mesh.geometry.boundingBox
    expect(box?.min.x).toBeGreaterThanOrEqual(-1e-6)
    expect(box?.max.x).toBeLessThanOrEqual(6 + 1e-6)
    expect(box?.min.z).toBeGreaterThanOrEqual(-1e-6)
    expect(box?.max.z).toBeLessThanOrEqual(4 + 1e-6)
  })

  test('has its foot vertices on the outline: the mesh and the shape the floors read agree', () => {
    const node = rock()
    const positions = meshOf(node).geometry.getAttribute('position')

    // A faceted mesh is not indexed, so find each outline corner among its foot vertices.
    const has = ([x, z]: [number, number]) =>
      Array.from({ length: positions.count }, (_, i) => [
        positions.getX(i),
        positions.getZ(i),
      ]).some(([px, pz]) => Math.hypot((px ?? 0) - x, (pz ?? 0) - z) < 1e-5)
    expect(outline.every((point) => has(point))).toBe(true)
  })

  test('produces finite geometry across ROCK_LIMITS minHeight and maxHeight and single-mesh bake export', () => {
    for (const height of [ROCK_LIMITS.minHeight, ROCK_LIMITS.maxHeight]) {
      const mesh = meshOf(rock({ height }))
      const position = mesh.geometry.getAttribute('position')
      const normal = mesh.geometry.getAttribute('normal')
      expect(position.count).toBeGreaterThan(0)
      expect(Array.from(position.array).every(Number.isFinite)).toBe(true)
      expect(Array.from(normal.array).every(Number.isFinite)).toBe(true)
    }

    const baked = buildRockBakeGeometry(rock(), context)
    const body = baked.getObjectByName('rock-body')
    expect(baked.children).toHaveLength(1)
    expect(body).toBeInstanceOf(Mesh)
    expect(baked.getObjectByName('rock-lod') ?? null).toBeNull()
  })

  test('faceted and weathered forms produce distinct indexed boulder profiles', () => {
    const faceted = meshOf(rock({ form: 'faceted' })).geometry
    const weathered = meshOf(rock({ form: 'weathered' })).geometry

    expect(faceted.getIndex()).not.toBeNull()
    expect(weathered.getIndex()).not.toBeNull()
    expect(Array.from(faceted.getAttribute('position').array)).not.toEqual(
      Array.from(weathered.getAttribute('position').array),
    )
  })

  test('another seed is another mesh', () => {
    const one = meshOf(rock({ seed: 1 })).geometry.getAttribute('position').array
    const other = meshOf(rock({ seed: 2 })).geometry.getAttribute('position').array

    expect(Array.from(one)).not.toEqual(Array.from(other))
  })

  test('draws in plan as its outline', () => {
    const plan = buildRockFloorplan(rock(), context)

    expect(plan).toMatchObject({ kind: 'polygon', points: outline })
  })

  test('offers a handle at every corner, midpoint and edge while selected, and none otherwise', () => {
    const selected = { ...context, viewState: { selected: true } } as unknown as GeometryContext

    const plan = buildRockFloorplan(rock(), selected)

    const handles = plan?.kind === 'group' ? plan.children : []
    const count = (kind: string) => handles.filter((child) => child.kind === kind).length
    expect(count('endpoint-handle')).toBe(outline.length)
    expect(count('midpoint-handle')).toBe(outline.length)
    expect(count('edge-handle')).toBe(outline.length)
    expect(buildRockFloorplan(rock(), context)?.kind).toBe('polygon')
  })
})

/** Where a horizontal plane cuts the mesh: the end points of each triangle's slice, as plan points. */
function planeSlice(
  positions: ArrayLike<number>,
  indices: ArrayLike<number> | null,
  height: number,
) {
  const vertex = (i: number): [number, number, number] => [
    positions[i * 3] ?? 0,
    positions[i * 3 + 1] ?? 0,
    positions[i * 3 + 2] ?? 0,
  ]
  const count = indices ? indices.length : positions.length / 3
  const found: [number, number][] = []
  for (let t = 0; t < count; t += 3) {
    const corners = [0, 1, 2].map((k) => vertex(indices ? (indices[t + k] ?? 0) : t + k))
    for (let k = 0; k < 3; k++) {
      const [p, q] = [corners[k], corners[(k + 1) % 3]]
      if (!(p && q) || (p[1] - height) * (q[1] - height) >= 0) continue
      const u = (height - p[1]) / (q[1] - p[1])
      found.push([p[0] + (q[0] - p[0]) * u, p[2] + (q[2] - p[2]) * u])
    }
  }
  return found
}

describe('the section the floors read, and the mesh', () => {
  const square: [number, number][] = [
    [-3, -3],
    [3, -3],
    [3, 3],
    [-3, 3],
  ]
  const near = (a: [number, number], b: [number, number]) =>
    Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-5

  for (const form of ['faceted', 'weathered'] as const)
    test(`${form}: a plane through the mesh cuts it exactly where the section says`, () => {
      const node = RockNode.parse({ parentId: site.id, polygon: square, height: 3, seed: 1, form })
      const geometry = meshOf(node).geometry
      const [section = []] = rockSections(node, (0.1 + 0.3) / 3.3, { footY: -0.3, topY: 3 })

      const cut = planeSlice(
        geometry.getAttribute('position').array,
        geometry.getIndex()?.array ?? null,
        0.1,
      )

      expect(section.length).toBeGreaterThan(square.length)
      expect(section.every((point) => cut.some((found) => near(found, point)))).toBe(true)
      expect(cut.every((found) => section.some((point) => near(found, point)))).toBe(true)
    })
})

describe('the rock material', () => {
  test('creates a distinct geology material per type with expected base colors', () => {
    const granite = rockMaterial(rock({ rockType: 'granite' }))
    const volcanic = rockMaterial(rock({ rockType: 'volcanic' }))
    expect(granite.name).toBe('rock-geology-granite-near')
    expect(volcanic.name).toBe('rock-geology-volcanic-near')
    expect(granite).not.toBe(volcanic)
    expect(ROCK_BASE_COLORS.granite).not.toBe(ROCK_BASE_COLORS.volcanic)
  })

  test('generates WGSL for every option', () => {
    const canvas = { width: 64, height: 64, style: {}, addEventListener() {} }
    const renderer = new WebGPURenderer({ canvas: canvas as unknown as HTMLCanvasElement })
    renderer.hasFeature = () => false
    renderer.backend.capabilities.getUniformBufferLimit = () => 65536
    // three 0.187 starts `_bindings` at null until the renderer is initialised, which this headless
    // build never does; the node builder reads it as 'no shared bind groups' when it is undefined.
    ;(renderer as unknown as { _bindings?: unknown })._bindings = undefined
    const geometry = meshOf(rock()).geometry
    try {
      for (const look of [
        { strata: false, lichen: 0, weathering: 0, moss: 0 },
        { strata: true, lichen: 0, weathering: 0.4, moss: 0.2 },
        { rockType: 'granite' as const, strata: false, lichen: 0.6, moss: 0.8 },
        { rockType: 'stepping' as const, strata: true, lichen: 1, weathering: 0.9 },
      ]) {
        const material = rockMaterial(rock(look))
        const builder = renderer.backend.createNodeBuilder(new Mesh(geometry, material), renderer)
        builder.camera = new PerspectiveCamera()
        builder.scene = new Scene()
        builder.clippingContext = null
        builder.build()
        expect(builder.vertexShader.length).toBeGreaterThan(0)
        expect(builder.fragmentShader.length).toBeGreaterThan(0)
        material.dispose()
      }
    } finally {
      geometry.dispose()
    }
  })
})

describe('the rock definition', () => {
  test('mounts the shared polygon editor for its footprint in 3D', async () => {
    // Main dispatches selection affordances, not the lab's boundary-edit extension.
    const tool = rockDefinition.affordanceTools?.selection

    const module = await tool?.()

    expect(typeof module?.default).toBe('function')
  })

  test('is a Site element with a tool, a panel and a system', () => {
    expect(rockDefinition.kind).toBe('rock')
    expect(rockDefinition.capabilities.hostable?.parents).toEqual(['site'])
    expect(rockDefinition.tool).toBeDefined()
    expect(rockDefinition.system).toBeDefined()
    expect(rockDefinition.parametrics?.groups.flatMap((g) => g.fields.map((f) => f.key))).toEqual(
      expect.arrayContaining([
        'rockType',
        'height',
        'seed',
        'form',
        'weathering',
        'moss',
        'strata',
        'lichen',
      ]),
    )
  })
})
