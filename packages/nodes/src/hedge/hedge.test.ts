import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  clearSceneHistory,
  createSceneApi,
  createTerrainField,
  encodeTerrainField,
  type GeometryContext,
  HEDGE_EMBED,
  HEDGE_LIMITS,
  HedgeNode,
  LevelNode,
  SITE_GROUND_DEPENDENCY_TYPES,
  SiteNode,
  SlabNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { Mesh, PerspectiveCamera, Scene } from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { siteKindsOnChangedGround } from '../shared/site-ground-invalidation'
import { hedgeDefinition } from './definition'
import { buildHedgeFloorplan } from './floorplan'
import { hedgeFloorplanMoveTarget } from './floorplan-move'
import { buildHedgeGeometry } from './geometry'
import { hedgeMaterial } from './material'
import { hedgeParametrics } from './parametrics'
import { placeHedge } from './placement'

const hedgesOnChangedGround = (nodes: Record<string, AnyNode>, previous: Map<string, unknown[]>) =>
  siteKindsOnChangedGround(nodes, previous, 'hedge', SITE_GROUND_DEPENDENCY_TYPES)

const lot = {
  type: 'polygon' as const,
  points: [
    [-20, -20],
    [20, -20],
    [20, 20],
    [-20, 20],
  ] as [number, number][],
}
const site = SiteNode.parse({ id: 'site_garden', polygon: lot })
const line: [number, number][] = [
  [0, 0],
  [8, 0],
]
const hedge = (extra: Partial<HedgeNode> = {}) =>
  HedgeNode.parse({ id: 'hedge_test', parentId: site.id, path: line, seed: 5, ...extra })
const context = { parent: site } as unknown as GeometryContext

const meshesOf = (node: HedgeNode, ctx = context) =>
  buildHedgeGeometry(node, ctx).children.filter((child): child is Mesh => child instanceof Mesh)

describe('a hedge’s meshes', () => {
  test('are plain geometry with vertex colours: three vertex buffers, one material, no texture', () => {
    const meshes = meshesOf(
      hedge({
        path: [
          [0, 0],
          [30, 0],
        ],
      }),
    )

    expect(meshes.length).toBeGreaterThan(2)
    for (const mesh of meshes) {
      expect(Object.keys(mesh.geometry.attributes).sort()).toEqual(['color', 'normal', 'position'])
      expect(mesh.geometry.getIndex()).not.toBeNull()
      expect(mesh.material).toBe(hedgeMaterial())
      expect(mesh.castShadow).toBe(true)
      expect(mesh.receiveShadow).toBe(true)
      expect(mesh.geometry.boundingSphere).not.toBeNull()
    }
    const material = hedgeMaterial()
    expect(material.vertexColors).toBe(true)
    expect(material.map).toBeNull()
    expect(material.normalMap).toBeNull()
    expect(material.colorNode).toBeNull()
  })

  test('says how many triangles it holds', () => {
    const group = buildHedgeGeometry(hedge(), context)
    const drawn = group.children.reduce(
      (sum, child) => sum + ((child as Mesh).geometry.getIndex()?.count ?? 0) / 3,
      0,
    )

    expect(group.userData.hedge).toEqual({ triangles: drawn, gen: 1 })
    expect(drawn / 8).toBeGreaterThan(1000)
  })

  test('stand on the existing single-grid Site slope, or its rendered flat plane', () => {
    const field = createTerrainField({ origin: [-16, -16], cols: 65, rows: 65, spacing: 0.5 })
    for (let row = 0; row < 65; row++)
      for (let col = 0; col < 65; col++)
        field.heights[row * 65 + col] = Math.round((col * 0.5 * 0.2) / field.step)
    const sloped = { ...site, terrain: encodeTerrainField(field) }
    const lowestAt = (meshes: Mesh[], x: number) => {
      let lowest = Number.POSITIVE_INFINITY
      for (const mesh of meshes) {
        const position = mesh.geometry.getAttribute('position')
        for (let i = 0; i < position.count; i++)
          if (Math.abs(position.getX(i) - x) < 0.1) lowest = Math.min(lowest, position.getY(i))
      }
      return lowest
    }
    const onSlope = meshesOf(hedge(), { parent: sloped } as unknown as GeometryContext)
    // Ground at x is (x + 16) * 0.2 on this field.
    expect(lowestAt(onSlope, 2)).toBeCloseTo(18 * 0.2 - HEDGE_EMBED, 1)
    expect(lowestAt(onSlope, 6)).toBeCloseTo(22 * 0.2 - HEDGE_EMBED, 1)
    expect(lowestAt(meshesOf(hedge()), 4)).toBeCloseTo(-0.05 - HEDGE_EMBED, 6)
  })

  test('without textures is one plain colour', () => {
    const [mesh] = buildHedgeGeometry(hedge(), context, undefined, false).children as Mesh[]
    expect(mesh?.material).not.toBe(hedgeMaterial())
  })

  test('produces finite buffers across HEDGE_LIMITS bounds', () => {
    for (const [height, width] of [
      [HEDGE_LIMITS.minHeight, HEDGE_LIMITS.minWidth],
      [HEDGE_LIMITS.maxHeight, 1],
    ]) {
      const meshes = meshesOf(hedge({ height, width }))
      expect(meshes.length).toBeGreaterThan(0)
      for (const mesh of meshes) {
        const position = mesh.geometry.getAttribute('position')
        const normal = mesh.geometry.getAttribute('normal')
        expect(Array.from(position.array).every(Number.isFinite)).toBe(true)
        expect(Array.from(normal.array).every(Number.isFinite)).toBe(true)
      }
    }
  })

  test('geometry stands on a transformed ground-storey slab, with thickness below its top', () => {
    const building = BuildingNode.parse({
      id: 'building_support',
      parentId: site.id,
      position: [10, 1, -3],
      rotation: [0, Math.PI / 2, 0],
      children: ['level_support'],
    })
    const level = LevelNode.parse({
      id: 'level_support',
      parentId: building.id,
      baseElevation: 0.4,
      height: 3,
      children: ['slab_support'],
    })
    const slab = SlabNode.parse({
      id: 'slab_support',
      parentId: level.id,
      polygon: [
        [-2, -2],
        [10, -2],
        [10, 2],
        [-2, 2],
      ],
      elevation: 0.7,
      thickness: 0.3,
    })
    const node = hedge({
      path: [
        [10, -3],
        [10, -11],
      ],
    })
    const nodes = Object.fromEntries([site, building, level, slab, node].map((n) => [n.id, n]))
    const meshes = meshesOf(node, {
      parent: site,
      sceneNodes: nodes,
      resolve: (id: string) => nodes[id],
    } as unknown as GeometryContext)
    expect(meshes.length).toBeGreaterThan(0)
    const bottom = Math.min(...meshes.map((mesh) => mesh.geometry.boundingBox?.min.y ?? Infinity))
    expect(bottom).toBeCloseTo(2.1 - HEDGE_EMBED, 6)
  })

  test('the material generates WGSL from position, normal and colour alone', () => {
    const canvas = { width: 64, height: 64, style: {}, addEventListener() {} }
    const renderer = new WebGPURenderer({ canvas: canvas as unknown as HTMLCanvasElement })
    renderer.hasFeature = () => false
    renderer.backend.capabilities.getUniformBufferLimit = () => 65536
    // three 0.187 starts `_bindings` at null until the renderer is initialised, which this headless
    // build never does; the node builder reads it as 'no shared bind groups' when it is undefined.
    ;(renderer as unknown as { _bindings?: unknown })._bindings = undefined
    const [mesh] = meshesOf(hedge())
    if (!mesh) throw new Error('A hedge builds a mesh')
    const builder = renderer.backend.createNodeBuilder(mesh, renderer)
    builder.camera = new PerspectiveCamera()
    builder.scene = new Scene()
    builder.clippingContext = null
    builder.build()

    expect(builder.vertexShader.length).toBeGreaterThan(0)
    expect(builder.fragmentShader.length).toBeGreaterThan(0)
    expect(builder.fragmentShader).not.toContain('textureSample')
    const attributes = builder
      .getAttributesArray()
      .map((attribute: { name: string }) => attribute.name)
    expect(attributes.sort()).toEqual(['color', 'normal', 'position'])
  })
})

describe('a hedge on the plan', () => {
  const view = (selected: boolean) =>
    ({
      viewState: {
        selected,
        highlighted: false,
        hovered: false,
        moving: false,
        unit: 'metric',
        palette: { selectedFill: '#abcdef', selectedStroke: '#123456' },
      },
    }) as unknown as GeometryContext
  const rings = (d: string) => d.split('M').filter(Boolean)

  test('is a band as wide as the hedge along its line', () => {
    const plan = buildHedgeFloorplan(hedge({ width: 1 }), view(false))
    if (plan?.kind !== 'path') throw new Error('A hedge draws a path')
    const points = plan.d
      .replace(/[MZ]/g, '')
      .split('L')
      .map((pair) => pair.split(' ').map(Number))
    const zs = points.map(([, z]) => z ?? 0)
    const xs = points.map(([x]) => x ?? 0)

    expect(rings(plan.d)).toHaveLength(1)
    expect(Math.max(...zs)).toBeCloseTo(0.5, 6)
    expect(Math.min(...zs)).toBeCloseTo(-0.5, 6)
    expect(Math.min(...xs)).toBeCloseTo(0, 6)
    expect(Math.max(...xs)).toBeCloseTo(8, 6)
    expect(plan.fill).toBe('#7fae5f')
  })

  test('shows an opening as a break in the band, and a ring as a hollow band', () => {
    const gated = buildHedgeFloorplan(hedge({ gaps: [{ at: 4, width: 1.2 }] }), view(false))
    const ring = buildHedgeFloorplan(
      hedge({
        path: [
          [0, 0],
          [8, 0],
          [8, 6],
          [0, 6],
        ],
        closed: true,
      }),
      view(false),
    )
    if (gated?.kind !== 'path' || ring?.kind !== 'path') throw new Error('A hedge draws a path')

    expect(rings(gated.d)).toHaveLength(2)
    expect(rings(ring.d)).toHaveLength(2)
    expect(ring.fillRule).toBe('evenodd')
  })

  test('takes the selection’s colours while selected; no line, no symbol', () => {
    const selected = buildHedgeFloorplan(hedge(), view(true))
    expect(selected).toMatchObject({ fill: '#abcdef', stroke: '#123456' })
    expect(
      buildHedgeFloorplan(
        hedge({
          path: [
            [1, 1],
            [1, 1],
          ],
        }),
        view(false),
      ),
    ).toBeNull()
  })
})

describe('the hedge definition', () => {
  test('is a Site element with a draw tool in 3D and on the plan, a panel and a system', async () => {
    expect(hedgeDefinition.kind).toBe('hedge')
    expect(hedgeDefinition.capabilities.hostable?.parents).toEqual(['site'])
    expect(hedgeDefinition.capabilities.drawTool).toBe(true)
    expect(hedgeDefinition.floorplanScope).toBe('site')
    expect(hedgeDefinition.system).toBeDefined()
    expect(typeof (await hedgeDefinition.tool?.())?.default).toBe('function')
    const extension = hedgeDefinition.extensions?.['pascal:editor/floorplan'] as
      | { tool?: () => Promise<{ default: unknown }> }
      | undefined
    expect(typeof (await extension?.tool?.())?.default).toBe('function')
    expect(hedgeDefinition.floorplanMoveTarget).toBe(hedgeFloorplanMoveTarget)
    expect(HedgeNode.parse({ id: 'hedge_x', ...hedgeDefinition.defaults() }).path).toHaveLength(2)
  })

  test('its panel edits height, width, clip and seed, and offers Randomise', () => {
    expect(hedgeParametrics.groups.flatMap((g) => g.fields.map((f) => f.key))).toEqual([
      'height',
      'width',
      'clip',
      'curve',
      'closed',
      'seed',
      'leafSize',
      'leafColor',
    ])
    expect(hedgeParametrics.actions?.map((action) => action.label)).toEqual(['Randomise'])
  })
})

describe('a hedge in the scene', () => {
  const originalFrame = globalThis.requestAnimationFrame
  const originalCancel = globalThis.cancelAnimationFrame
  let original: ReturnType<typeof useScene.getState>

  beforeEach(() => {
    globalThis.requestAnimationFrame = (callback) => {
      callback(0)
      return 0
    }
    globalThis.cancelAnimationFrame = () => {}
    original = useScene.getState()
    useScene.setState({ nodes: { [site.id]: site }, rootNodeIds: [site.id] } as never)
    clearSceneHistory()
  })
  afterEach(() => {
    globalThis.requestAnimationFrame = originalFrame
    globalThis.cancelAnimationFrame = originalCancel
    useScene.setState(original)
    clearSceneHistory()
  })

  const hedges = () =>
    Object.values(useScene.getState().nodes).filter((n): n is HedgeNode => n.type === 'hedge')

  test('drawing one plants it through the agents’ operation and selects it', () => {
    const selected: string[] = []
    const id = placeHedge(
      createSceneApi(useScene),
      [
        [0, 0],
        [4, 0],
        [4, 3],
      ],
      (hedgeId) => selected.push(hedgeId),
    )

    expect(hedges()).toHaveLength(1)
    expect(selected).toEqual([id as AnyNodeId])
    expect(hedges()[0]).toMatchObject({
      parentId: site.id,
      path: [
        [0, 0],
        [4, 0],
        [4, 3],
      ],
      gen: 1,
    })
  })

  test('a line that cannot be a hedge places nothing and throws nothing', () => {
    const none = () => {
      throw new Error('nothing to select')
    }
    expect(
      placeHedge(
        createSceneApi(useScene),
        [
          [0, 0],
          [0.01, 0],
        ],
        none,
      ),
    ).toBeNull()
    useScene.setState({ nodes: {}, rootNodeIds: [] } as never)
    expect(placeHedge(createSceneApi(useScene), line, none)).toBeNull()
    expect(hedges()).toHaveLength(0)
  })

  test('Randomise gives it another seed in one write', () => {
    const id = placeHedge(createSceneApi(useScene), line, () => {}) as AnyNodeId
    const seeds = new Set<number>()
    for (let i = 0; i < 8; i++) {
      hedgeParametrics.actions?.[0]?.onClick(useScene.getState().nodes[id] as HedgeNode)
      seeds.add((useScene.getState().nodes[id] as HedgeNode).seed)
    }
    expect(seeds.size).toBeGreaterThan(1)
    expect(hedges()).toHaveLength(1)
  })

  test('moving previews its whole line without persistence and commits once with its openings', () => {
    const node = hedge({ gaps: [{ at: 4, width: 1 }] })
    useScene.setState({ nodes: { [site.id]: site, [node.id]: node } } as never)
    const session = hedgeFloorplanMoveTarget({
      node,
      nodes: useScene.getState().nodes as Record<AnyNodeId, AnyNode>,
    } as never)
    // The first point is where the hedge is grabbed; it then follows the cursor from there.
    for (const planPoint of [
      [4, 0],
      [7, 2],
    ])
      session?.apply({
        planPoint,
        modifiers: { shiftKey: true, altKey: false, ctrlKey: false, metaKey: false },
      } as never)

    expect(useScene.getState().nodes[node.id as AnyNodeId]).toBe(node)
    expect(useLiveNodeOverrides.getState().get(node.id)).toMatchObject({
      path: [
        [3, 2],
        [11, 2],
      ],
    })
    let writes = 0
    const unsubscribe = useScene.subscribe((next, before) => {
      if (next.nodes !== before.nodes) writes++
    })
    try {
      expect(session?.canCommit?.()).toBe(true)
      expect(session?.canCommit?.()).toBe(true)
      expect(writes).toBe(0)
      session?.commit?.()
      expect(writes).toBe(1)
      expect(useScene.getState().nodes[node.id as AnyNodeId]).toMatchObject({
        path: [
          [3, 2],
          [11, 2],
        ],
        gaps: [{ at: 4, width: 1 }],
      })
      expect(useLiveNodeOverrides.getState().get(node.id)).toBeUndefined()
    } finally {
      unsubscribe()
      useLiveNodeOverrides.getState().clear(node.id)
    }
  })
})

describe('the ground under a hedge', () => {
  const building = BuildingNode.parse({
    id: 'building_garden',
    parentId: site.id,
    children: ['level_garden'],
  })
  const level = LevelNode.parse({
    id: 'level_garden',
    parentId: building.id,
    children: ['slab_garden'],
    height: 3,
  })
  const slab = SlabNode.parse({
    id: 'slab_garden',
    parentId: level.id,
    polygon: [
      [0, -2],
      [8, -2],
      [8, 2],
      [0, 2],
    ],
    elevation: 0.7,
  })
  const node = hedge()
  const otherSite = SiteNode.parse({ id: 'site_other' })
  const other = hedge({ id: 'hedge_other_site', parentId: otherSite.id })
  const scene = (extra: Record<string, AnyNode> = {}) =>
    ({
      [site.id]: site,
      [node.id]: node,
      [building.id]: building,
      [level.id]: level,
      [slab.id]: slab,
      [otherSite.id]: otherSite,
      [other.id]: other,
      ...extra,
    }) as Record<string, AnyNode>

  test('slab heights, holes and ancestor transforms rebuild only their Site’s hedges', () => {
    const first = hedgesOnChangedGround(scene(), new Map())

    expect(first.dirty).toEqual([])
    expect(hedgesOnChangedGround(scene(), first.parts).dirty).toEqual([])
    const changes: AnyNode[] = [
      { ...slab, elevation: 1.2 },
      {
        ...slab,
        holes: [
          [
            [2, -1],
            [4, -1],
            [4, 1],
            [2, 1],
          ],
        ],
      },
      { ...building, position: [4, 1, 2] },
      { ...building, rotation: [0, Math.PI / 2, 0] },
      { ...level, baseElevation: 0.5 },
    ]
    for (const changed of changes)
      expect(hedgesOnChangedGround(scene({ [changed.id]: changed }), first.parts).dirty).toEqual([
        node.id,
      ])
    // Another hedge, or the hedge itself, is not ground.
    expect(
      hedgesOnChangedGround(scene({ [node.id]: { ...node } as AnyNode }), first.parts).dirty,
    ).toEqual([])
    const removed = scene()
    delete removed[slab.id]
    expect(hedgesOnChangedGround(removed, first.parts).dirty).toEqual([node.id])
    const otherSlab = SlabNode.parse({ ...slab, id: 'slab_other', parentId: otherSite.id })
    expect(hedgesOnChangedGround(scene({ [otherSlab.id]: otherSlab }), first.parts).dirty).toEqual([
      other.id,
    ])
  })

  test('a stored single-grid ground edit rebuilds only hedges on that Site', () => {
    const first = hedgesOnChangedGround(scene(), new Map())
    const field = createTerrainField({ cols: 3, rows: 3 })
    field.heights.fill(100)
    const raised = { ...site, terrain: encodeTerrainField(field) }
    expect(hedgesOnChangedGround(scene({ [site.id]: raised }), first.parts).dirty).toEqual([
      node.id,
    ])
  })
})
