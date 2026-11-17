import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  clearSceneHistory,
  createSceneApi,
  FLAT_GROUND,
  type GeometryContext,
  LevelNode,
  PlantingNode,
  planPlanting,
  SiteNode,
  SlabNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { Mesh } from 'three'
import { hedgeMaterial } from '../hedge/material'
import { plantingDefinition } from './definition'
import { buildPlantingFloorplan } from './floorplan'
import {
  createPlantingMoveSession,
  plantingFloorplanMoveTarget,
  translatedPlanting,
} from './floorplan-move'
import { buildPlantingGeometry } from './geometry'
import { plantingFloorplanDependencies, plantingsOnChangedScene } from './ground-invalidation'
import { plantingParametrics } from './parametrics'
import { placePlanting } from './placement'
import { editPlantingPlants } from './plants-panel'

const site = SiteNode.parse({ id: 'site_garden' })
const outline: [number, number][] = [
  [-3, -2],
  [3, -2],
  [3, 2],
  [-3, 2],
]
const bed = (extra: Partial<PlantingNode> = {}) =>
  PlantingNode.parse({ id: 'planting_test', parentId: site.id, outline, seed: 19, ...extra })
const nodesOf = (...nodes: AnyNode[]) =>
  Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<AnyNodeId, AnyNode>
const context = (node: PlantingNode, extra: AnyNode[] = []) => {
  const nodes = nodesOf(site, node, ...extra)
  return {
    parent: site,
    children: [],
    siblings: [],
    sceneNodes: nodes,
    resolve: (id: AnyNodeId) => nodes[id],
  } as unknown as GeometryContext
}

describe('planting render and plan adapters', () => {
  test('merged indexed meshes use the foliage material, shadows and a body-only prefix', () => {
    const node = bed(),
      group = buildPlantingGeometry(node, context(node))
    const meshes = group.children as Mesh[]
    expect(meshes.length).toBeGreaterThan(0)
    expect(meshes.length).toBeLessThan(group.userData.planting.plants)
    const triangles = meshes.reduce((sum, mesh) => sum + mesh.geometry.getIndex()!.count / 3, 0)
    expect(group.userData.planting).toMatchObject({ triangles, gen: 1 })
    expect(group.userData.planting.area).toBeCloseTo(24, 7)
    for (const mesh of meshes) {
      expect(mesh).toBeInstanceOf(Mesh)
      expect(Object.keys(mesh.geometry.attributes).sort()).toEqual(['color', 'normal', 'position'])
      expect(mesh.material).toBe(hedgeMaterial())
      expect(mesh.castShadow && mesh.receiveShadow).toBe(true)
      expect(mesh.geometry.boundingSphere).not.toBeNull()
      expect(mesh.userData.plantingBodyIndexCount).toBeGreaterThan(0)
      expect(mesh.userData.plantingBodyIndexCount).toBeLessThanOrEqual(
        mesh.geometry.getIndex()!.count,
      )
    }
    const plain = buildPlantingGeometry(node, context(node), undefined, false).children[0] as Mesh
    expect(plain.material).not.toBe(hedgeMaterial())
  })
  test('plan dots are the actual accepted plants, with the same outline and selection palette', () => {
    const node = bed(),
      ctx = context(node),
      plan = planPlanting(node, FLAT_GROUND)
    const symbol = buildPlantingFloorplan(node, ctx)
    if (symbol?.kind !== 'group') throw new Error('A bed has one grouped plan symbol')
    expect(symbol.children[0]).toMatchObject({ kind: 'polygon', points: plan.outline })
    expect(symbol.children.slice(1)).toHaveLength(plan.placements.length)
    plan.placements.forEach((p, i) => {
      expect(symbol.children[i + 1]).toMatchObject({
        kind: 'circle',
        cx: p.x,
        cy: p.z,
      })
    })
    const selected = buildPlantingFloorplan(node, {
      ...ctx,
      viewState: {
        selected: true,
        palette: { selectedFill: '#abcdef', selectedStroke: '#123456' },
      },
    } as GeometryContext)
    if (selected?.kind !== 'group') throw new Error('Missing selected symbol')
    expect(selected.children[0]).toMatchObject({ fill: '#abcdef', stroke: '#123456' })
  })
  test('plan crowns stay inside the organic boundary, including large back shrubs', () => {
    // Analytic point-to-segment distance, independent of production edge-distance code.
    // The symbol may reduce radii, but must retain every accepted plant's true centre.
    for (const seed of [7, 19, 41]) {
      const node = bed({
        outline: [
          [-2.9, 1.25],
          [2.9, 1.25],
          [2.9, -1.25],
          [-2.9, -1.25],
        ],
        seed,
      })
      const symbol = buildPlantingFloorplan(node, context(node))
      if (symbol?.kind !== 'group') throw new Error('Missing bed symbol')
      const boundary = symbol.children[0]
      if (boundary?.kind !== 'polygon') throw new Error('Missing bed outline')
      const plan = planPlanting(node, FLAT_GROUND)
      expect(symbol.children.slice(1)).toHaveLength(plan.placements.length)
      expect(plan.placements.filter((p) => p.layer === 'back').length).toBeGreaterThan(0)
      for (const [i, shape] of symbol.children.slice(1).entries()) {
        if (shape.kind !== 'circle') throw new Error('Expected a plant circle')
        expect([shape.cx, shape.cy]).toEqual([plan.placements[i]!.x, plan.placements[i]!.z])
        expect(shape.r).toBeGreaterThan(0)
        const distances = boundary.points.map((a, j) => {
          const b = boundary.points[(j + 1) % boundary.points.length]!
          const dx = b[0] - a[0],
            dz = b[1] - a[1]
          const t = Math.max(
            0,
            Math.min(1, ((shape.cx - a[0]) * dx + (shape.cy - a[1]) * dz) / (dx * dx + dz * dz)),
          )
          return Math.hypot(shape.cx - a[0] - t * dx, shape.cy - a[1] - t * dz)
        })
        expect(shape.r).toBeLessThanOrEqual(Math.min(...distances) + 1e-9)
      }
    }
  })
  test('both representations honor a real paved footprint, not an unrelated decorative scatter', () => {
    const node = bed()
    const building = BuildingNode.parse({ id: 'building_garden', parentId: site.id })
    const level = LevelNode.parse({ id: 'level_ground', parentId: building.id, level: 0 })
    const path = SlabNode.parse({
      id: 'slab_walk',
      parentId: level.id,
      polygon: [
        [-8, -8],
        [0, -8],
        [0, 8],
        [-8, 8],
      ],
      metadata: { flatwork: 'walk' },
    })
    const ctx = context(node, [building, level, path])
    const symbol = buildPlantingFloorplan(node, ctx)
    if (symbol?.kind !== 'group') throw new Error('Missing symbol')
    const dots = symbol.children.slice(1)
    expect(dots.length).toBeGreaterThan(0)
    for (const dot of dots) {
      if (dot.kind !== 'circle') throw new Error('Expected a plant circle')
      expect(dot.cx - dot.r).toBeGreaterThanOrEqual(0)
    }
    expect(buildPlantingGeometry(node, ctx).userData.planting.plants).toBe(dots.length)
    expect(dots.length).toBeLessThan(planPlanting(node, FLAT_GROUND).placements.length)
  })

  test('a raised lawn lifts rendered plants without moving or removing their plan centres', () => {
    const node = bed()
    const lawn = SlabNode.parse({
      id: 'slab_raised_lawn',
      parentId: site.id,
      polygon: [
        [-20, -20],
        [20, -20],
        [20, 20],
        [-20, 20],
      ],
      elevation: 0.8,
      thickness: 0.3,
      metadata: { flatwork: 'lawn' },
    })
    const plainContext = context(node)
    const raisedContext = context(node, [lawn])
    const flat = buildPlantingGeometry(node, plainContext)
    const raised = buildPlantingGeometry(node, raisedContext)
    expect(buildPlantingFloorplan(node, raisedContext)).toEqual(
      buildPlantingFloorplan(node, plainContext),
    )
    expect(raised.children.length).toBeGreaterThan(0)
    expect(raised.children.length).toBe(flat.children.length)
    raised.children.forEach((child, i) => {
      const position = (child as Mesh).geometry.getAttribute('position')
      const previous = (flat.children[i] as Mesh).geometry.getAttribute('position')
      expect(position.count).toBe(previous.count)
      for (let vertex = 0; vertex < position.count; vertex++) {
        expect(position.getX(vertex)).toBeCloseTo(previous.getX(vertex), 6)
        expect(position.getZ(vertex)).toBeCloseTo(previous.getZ(vertex), 6)
        expect(position.getY(vertex) - previous.getY(vertex)).toBeCloseTo(0.85, 5)
      }
    })
  })
})

describe('planting registration and editing surfaces', () => {
  test('is a Site element with plan and 3D tools, geometry, panel, move and invalidation', async () => {
    expect(plantingDefinition.kind).toBe('planting')
    expect(plantingDefinition.capabilities.hostable?.parents).toEqual(['site'])
    expect(plantingDefinition.capabilities.drawTool).toBe(true)
    expect(plantingDefinition.floorplanScope).toBe('site')
    expect(plantingDefinition.system).toBeDefined()
    expect(plantingDefinition.geometry).toBe(buildPlantingGeometry)
    expect(plantingDefinition.floorplanMoveTarget).toBe(plantingFloorplanMoveTarget)
    expect(typeof (await plantingDefinition.tool?.())?.default).toBe('function')
    const extension = plantingDefinition.extensions?.['pascal:editor/floorplan'] as {
      tool?: () => Promise<{ default: unknown }>
    }
    expect(typeof (await extension.tool?.())?.default).toBe('function')
    expect(
      PlantingNode.safeParse({ ...plantingDefinition.defaults(), id: 'planting_default' }).success,
    ).toBe(true)
    expect(plantingParametrics.groups.flatMap((g) => g.fields.map((f) => f.key))).toEqual([
      'area',
      'pattern',
      'seed',
      'ground',
      'edging',
    ])
    expect(plantingParametrics.trailingSection).toBeDefined()
    expect(plantingParametrics.actions?.map((a) => a.label)).toEqual(['Randomise'])
  })
})

describe('planting atomic scene edits', () => {
  let original: ReturnType<typeof useScene.getState>
  let overrides: ReturnType<typeof useLiveNodeOverrides.getState>
  const frame = globalThis.requestAnimationFrame,
    cancel = globalThis.cancelAnimationFrame
  beforeEach(() => {
    original = useScene.getState()
    overrides = useLiveNodeOverrides.getState()
    globalThis.requestAnimationFrame = (cb) => {
      cb(0)
      return 0
    }
    globalThis.cancelAnimationFrame = () => {}
    useScene.setState({ nodes: nodesOf(site), rootNodeIds: [site.id] } as never)
    useLiveNodeOverrides.getState().clearAll()
    clearSceneHistory()
  })
  afterEach(() => {
    useScene.setState(original)
    useLiveNodeOverrides.setState(overrides)
    globalThis.requestAnimationFrame = frame
    globalThis.cancelAnimationFrame = cancel
    clearSceneHistory()
  })
  test('drawing commits one compact Site child and selects it; refused geometry writes nothing', () => {
    const selected: AnyNodeId[] = [],
      api = createSceneApi(useScene)
    const id = placePlanting(api, outline, (id) => selected.push(id))
    expect(selected).toEqual([id as AnyNodeId])
    expect(
      Object.values(useScene.getState().nodes).filter((n) => n.type === 'planting'),
    ).toHaveLength(1)
    expect(useScene.getState().nodes[id!]).toMatchObject({ parentId: site.id, outline, gen: 1 })
    expect((useScene.getState().nodes[site.id] as SiteNode).children).toContain(id as AnyNodeId)
    const before = useScene.getState().nodes,
      errors: string[] = []
    expect(
      placePlanting(
        api,
        [
          [0, 0],
          [2, 2],
          [0, 2],
          [2, 0],
        ],
        () => {
          throw new Error('Refusal selected a bed')
        },
        site.id,
        (error) => errors.push(error),
      ),
    ).toBeNull()
    expect(errors.length).toBe(1)
    expect(useScene.getState().nodes).toBe(before)
  })
  test('species edits validate before one write, do not mutate the supplied list and reject empty/oversize lists', () => {
    const node = bed()
    useScene.setState({ nodes: nodesOf(site, node) } as never)
    const before = JSON.stringify(node)
    let writes = 0
    const unsubscribe = useScene.subscribe((next, prev) => {
      if (next.nodes !== prev.nodes) writes++
    })
    try {
      expect(
        editPlantingPlants(node.id, (plants) => {
          plants[0]!.height = 2
          return plants
        }),
      ).toBe(true)
      expect(writes).toBe(1)
      expect(JSON.stringify(node)).toBe(before)
      expect(editPlantingPlants(node.id, () => [])).toBe(false)
      expect(
        editPlantingPlants(node.id, (plants) => Array.from({ length: 9 }, () => plants[0]!)),
      ).toBe(false)
      expect(
        editPlantingPlants(node.id, (plants) => {
          plants[0]!.height = 100
          return plants
        }),
      ).toBe(false)
      expect(writes).toBe(1)
      const live = useScene.getState().nodes[node.id] as PlantingNode
      plantingParametrics.actions![0]!.onClick(live)
      expect(writes).toBe(2)
      expect((useScene.getState().nodes[node.id] as PlantingNode).seed).not.toBe(live.seed)
    } finally {
      unsubscribe()
    }
  })
  test('moving stages a live preview, keeps validation pure and persists exactly once', () => {
    const node = bed()
    useScene.setState({ nodes: nodesOf(site, node) } as never)
    const session = createPlantingMoveSession({ node, nodes: useScene.getState().nodes } as never)!
    const modifiers = { altKey: true, shiftKey: false, ctrlKey: false, metaKey: false }
    session.apply({ planPoint: [0, 0], modifiers } as never)
    session.apply({ planPoint: [2, 3], modifiers } as never)
    const expected = outline.map(([x, z]) => [x + 2, z + 3])
    expect(useScene.getState().nodes[node.id]).toBe(node)
    expect(useLiveNodeOverrides.getState().get(node.id)).toMatchObject({ outline: expected })
    let writes = 0
    const unsubscribe = useScene.subscribe((next, prev) => {
      if (next.nodes !== prev.nodes) writes++
    })
    try {
      expect(session.canCommit?.()).toBe(true)
      expect(session.canCommit?.()).toBe(true)
      expect(writes).toBe(0)
      session.commit?.()
      expect(writes).toBe(1)
      expect(useScene.getState().nodes[node.id]).toMatchObject({
        outline: expected,
        seed: node.seed,
        plants: node.plants,
      })
      expect(useLiveNodeOverrides.getState().get(node.id)).toBeUndefined()
    } finally {
      unsubscribe()
    }
    expect(translatedPlanting(PlantingNode.parse({ area: 12, center: [1, -2] }), 2, 3)).toEqual({
      center: [3, 1],
    })
  })
  test('an out-of-bounds move keeps the last valid preview and never exposes invalid geometry', () => {
    const node = PlantingNode.parse({
      id: 'planting_boundary',
      parentId: site.id,
      area: 0.25,
      center: [9998, 0],
    })
    useScene.setState({ nodes: nodesOf(site, node) } as never)
    const session = createPlantingMoveSession({ node, nodes: useScene.getState().nodes } as never)!
    const modifiers = { altKey: true, shiftKey: false, ctrlKey: false, metaKey: false }
    session.apply({ planPoint: [9998, 0], modifiers } as never)
    session.apply({ planPoint: [9999, 0], modifiers } as never)
    const lastValid = useLiveNodeOverrides.getState().get(node.id)
    expect(lastValid).toBeDefined()
    expect(PlantingNode.safeParse({ ...node, ...lastValid }).success).toBe(true)
    expect(() => session.apply({ planPoint: [10002, 0], modifiers } as never)).not.toThrow()
    expect(useLiveNodeOverrides.getState().get(node.id)).toEqual(lastValid)
    const preview = PlantingNode.parse({ ...node, ...useLiveNodeOverrides.getState().get(node.id) })
    expect(() => buildPlantingFloorplan(preview, context(preview))).not.toThrow()
    expect(() => buildPlantingGeometry(preview, context(preview))).not.toThrow()
    expect(useScene.getState().nodes[node.id]).toBe(node)
    expect(session.canCommit?.()).toBe(false)
    // The invalid drop is refused rather than silently committing an unseen location.
    session.commit?.()
    const after = useScene.getState().nodes[node.id] as PlantingNode
    expect(after).toBe(node)
    expect(PlantingNode.safeParse(after).success).toBe(true)
    expect(after.center[0]).toBeLessThanOrEqual(9999.000001)
  })
})

describe('planting dependency invalidation', () => {
  test('ground, footprints and their ancestor transforms invalidate only their Site', () => {
    const node = bed(),
      otherSite = SiteNode.parse({ id: 'site_other' })
    const other = bed({ id: 'planting_other', parentId: otherSite.id })
    const building = BuildingNode.parse({ id: 'building_test', parentId: site.id })
    const level = LevelNode.parse({ id: 'level_test', parentId: building.id, level: 0 })
    const slab = SlabNode.parse({
      id: 'slab_test',
      parentId: level.id,
      polygon: [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ],
    })
    const nodes = nodesOf(site, node, otherSite, other, building, level, slab)
    const first = plantingsOnChangedScene(nodes, new Map())
    expect(first.dirty).toEqual([])
    expect(plantingsOnChangedScene(nodes, first.parts).dirty).toEqual([])
    const changes: AnyNode[] = [
      { ...building, position: [3, 1, 2] },
      { ...building, rotation: [0, Math.PI / 2, 0] },
      { ...level, baseElevation: 0.5 },
      { ...slab, elevation: 0.8 },
      {
        ...slab,
        holes: [
          [
            [-0.5, -0.5],
            [0.5, -0.5],
            [0.5, 0.5],
            [-0.5, 0.5],
          ],
        ],
      },
    ]
    for (const dependency of changes) {
      expect(
        plantingsOnChangedScene({ ...nodes, [dependency.id]: { ...dependency } }, first.parts)
          .dirty,
      ).toEqual([node.id])
    }
    expect(
      plantingsOnChangedScene({ ...nodes, [node.id]: { ...node, seed: 42 } }, first.parts).dirty,
    ).toEqual([])
    const dependencies = plantingFloorplanDependencies(node, nodes)
    for (const dependency of [site, building, level, slab])
      expect(dependencies).toContain(dependency.id)
    expect(dependencies).not.toContain(other.id)
    expect(dependencies).not.toContain(otherSite.id)
    const removed = { ...nodes }
    delete removed[slab.id]
    expect(plantingsOnChangedScene(removed, first.parts).dirty).toEqual([node.id])
  })
})
