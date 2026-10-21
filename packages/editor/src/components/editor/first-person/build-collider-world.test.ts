import { afterEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  applyHeightPatch,
  BuildingNode,
  CeilingNode,
  ColumnNode,
  createTerrainField,
  DoorNode,
  ElevatorNode,
  encodeTerrainField,
  flattenPatch,
  GeometryArtifactManifest,
  LevelNode,
  nodeRegistry,
  registerNode,
  ShelfNode,
  SiteNode,
  SlabNode,
  StairNode,
  sceneRegistry,
  useInteractive,
  useScene,
} from '@pascal-app/core'
import { hideFromScene, STAND_CLEARANCE, showInScene } from '@pascal-app/viewer'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { buildFirstPersonColliderWorldFromRegistry } from './build-collider-world'

function registerColliderDefinition(
  kind: AnyNode['type'],
  schema: AnyNodeDefinition['schema'],
  category: AnyNodeDefinition['category'],
  surfaceRole?: AnyNodeDefinition['surfaceRole'],
) {
  registerNode({
    kind,
    schema,
    schemaVersion: 1,
    category,
    surfaceRole,
    capabilities: {},
  } as AnyNodeDefinition)
}

function mountNode(
  node: AnyNode,
  box: [number, number, number],
  position: [number, number, number],
) {
  const group = new Group()
  const mesh = new Mesh(new BoxGeometry(box[0], box[1], box[2]), new MeshBasicMaterial())
  mesh.position.set(position[0], position[1], position[2])
  group.add(mesh)
  group.updateMatrixWorld(true)
  sceneRegistry.nodes.set(node.id, group)
  sceneRegistry.byType[node.type]!.add(node.id)
}

function mountRegistryGroup(node: AnyNode, position: [number, number, number] = [0, 0, 0]) {
  const group = new Group()
  group.position.set(position[0], position[1], position[2])
  group.updateMatrixWorld(true)
  sceneRegistry.nodes.set(node.id, group)
  sceneRegistry.byType[node.type]!.add(node.id)
}

function setSceneNodes(nodes: AnyNode[]) {
  useScene.setState({
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
    rootNodeIds: nodes.map((node) => node.id),
  } as never)
}

describe('buildFirstPersonColliderWorldFromRegistry', () => {
  afterEach(() => {
    sceneRegistry.clear()
    nodeRegistry._reset()
    useScene.setState({ nodes: {}, rootNodeIds: [] } as never)
  })

  test('includes structure and furnish nodes discovered through the node registry', () => {
    registerColliderDefinition('column', ColumnNode, 'structure')
    registerColliderDefinition('shelf', ShelfNode, 'furnish')

    const column = ColumnNode.parse({ id: 'column_test' })
    const shelf = ShelfNode.parse({ id: 'shelf_test', position: [3, 0, 0] })
    setSceneNodes([column, shelf])
    mountNode(column, [1, 2, 1], [0, 1, 0])
    mountNode(shelf, [2, 1, 1], [3, 0.5, 0])

    const world = buildFirstPersonColliderWorldFromRegistry()

    expect(world).not.toBeNull()
    expect(world?.bounds?.min.x).toBeCloseTo(-0.5)
    expect(world?.bounds?.max.x).toBeCloseTo(4)
    world?.dispose()
  })

  test('keeps a procedural static body but excludes moving groups', () => {
    registerColliderDefinition('shelf', ShelfNode, 'furnish')
    const shelf = ShelfNode.parse({ id: 'shelf_motion_test' })
    setSceneNodes([shelf])
    mountNode(shelf, [1, 1, 1], [0, 0.5, 0])
    const root = sceneRegistry.nodes.get(shelf.id)!
    const motion = new Group()
    motion.userData.proceduralMotion = { nodeId: shelf.id, partId: 'drawer' }
    const movingMesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
    movingMesh.position.set(5, 0.5, 0)
    motion.add(movingMesh)
    root.add(motion)
    root.updateMatrixWorld(true)

    const world = buildFirstPersonColliderWorldFromRegistry()!
    expect(world.bounds?.min.x).toBeCloseTo(-0.5)
    expect(world.bounds?.max.x).toBeCloseTo(0.5)
    world.dispose()
  })

  test('an idle joint tree collides with its static split parts, not its merged rest pose', () => {
    registerColliderDefinition('shelf', ShelfNode, 'furnish')
    const shelf = ShelfNode.parse({ id: 'shelf_rest_test' })
    setSceneNodes([shelf])
    mountRegistryGroup(shelf)
    const root = sceneRegistry.nodes.get(shelf.id)!
    const box = (x: number) => {
      const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
      mesh.position.set(x, 0.5, 0)
      return mesh
    }
    // The rest pose merges the body with the gate leaf at x = 5; the hidden split draws them apart.
    const rest = new Group()
    rest.userData.pascalProceduralRest = true
    rest.add(box(0), box(5))
    const split = new Group()
    split.userData.pascalProceduralSplit = true
    split.visible = false
    const motion = new Group()
    motion.userData.proceduralMotion = { nodeId: shelf.id, partId: 'gate' }
    motion.add(box(5))
    split.add(box(0), motion)
    root.add(rest, split)
    root.updateMatrixWorld(true)

    const world = buildFirstPersonColliderWorldFromRegistry()!
    expect(world.bounds?.min.x).toBeCloseTo(-0.5)
    expect(world.bounds?.max.x).toBeCloseTo(0.5)
    world.dispose()
  })

  test('standing clearance and floor hits survive a slab source joining and leaving a batch', () => {
    registerColliderDefinition('slab', SlabNode, 'structure', 'floor')
    const slab = SlabNode.parse({ id: 'slab_clearance_batch', polygon: [] })
    setSceneNodes([slab])
    mountNode(slab, [4, 0.2, 4], [0, 2, 0])
    const source = sceneRegistry.nodes.get(slab.id)!.children[0] as Mesh
    const raycaster = new Raycaster()
    for (const batched of [false, true, false]) {
      if (batched) hideFromScene(source, 'batched')
      else showInScene(source, 'batched')
      const world = buildFirstPersonColliderWorldFromRegistry()!
      expect(world).not.toBeNull()
      try {
        raycaster.set(new Vector3(0, 3, 0), new Vector3(0, -1, 0))
        raycaster.far = STAND_CLEARANCE
        expect(raycaster.intersectObject(world.mesh, false)[0]!.point.y).toBeCloseTo(2.1)
        raycaster.set(new Vector3(0, 1, 0), new Vector3(0, 1, 0))
        expect(raycaster.intersectObjects([world.mesh], false)[0]!.point.y).toBeCloseTo(1.9)
        raycaster.set(new Vector3(0, 2.5, 0), new Vector3(0, 1, 0))
        expect(raycaster.intersectObjects([world.mesh], false)).toHaveLength(0)
      } finally {
        world.dispose()
      }
    }
    source.geometry.dispose()
    ;(source.material as MeshBasicMaterial).dispose()
  })

  test('excludes ceiling surfaces so the walkthrough player passes through them', () => {
    registerColliderDefinition('column', ColumnNode, 'structure')
    registerColliderDefinition('ceiling', CeilingNode, 'structure', 'ceiling')

    const column = ColumnNode.parse({ id: 'column_test' })
    const ceiling = CeilingNode.parse({ id: 'ceiling_test', polygon: [] })
    setSceneNodes([column, ceiling])
    mountNode(column, [1, 2, 1], [0, 1, 0])
    // A wide ceiling at head height — if it were collected, bounds would span ±5.
    mountNode(ceiling, [10, 0.1, 10], [0, 2.5, 0])

    const world = buildFirstPersonColliderWorldFromRegistry()

    expect(world).not.toBeNull()
    // Bounds reflect only the 1×1 column; the ceiling contributed no geometry.
    expect(world?.bounds?.min.x).toBeCloseTo(-0.5)
    expect(world?.bounds?.max.x).toBeCloseTo(0.5)
    world?.dispose()
  })

  test('skips meshes hidden by an invisible ancestor (stale roof segment CSG)', () => {
    registerColliderDefinition('column', ColumnNode, 'structure')

    // Mirror the roof's segments-wrapper shape: the registered mesh's own
    // visible flag stays true while a hidden wrapper hides it at render
    // time. The collider must match the render, not the own-flag.
    const column = ColumnNode.parse({ id: 'column_test' })
    const visibleColumn = ColumnNode.parse({ id: 'column_visible', position: [3, 0, 0] })
    setSceneNodes([column, visibleColumn])

    const wrapper = new Group()
    wrapper.visible = false
    const hiddenMesh = new Mesh(new BoxGeometry(10, 2, 10), new MeshBasicMaterial())
    wrapper.add(hiddenMesh)
    wrapper.updateMatrixWorld(true)
    sceneRegistry.nodes.set(column.id, hiddenMesh)
    sceneRegistry.byType[column.type]!.add(column.id)

    mountNode(visibleColumn, [1, 2, 1], [3, 1, 0])

    const world = buildFirstPersonColliderWorldFromRegistry()

    expect(world).not.toBeNull()
    // Bounds reflect only the visible 1×1 column at x = 3; the 10×10 mesh
    // under the hidden wrapper contributed no geometry.
    expect(world?.bounds?.min.x).toBeCloseTo(2.5)
    expect(world?.bounds?.max.x).toBeCloseTo(3.5)
    world?.dispose()
  })

  test('leaves elevators to their dedicated dynamic collider meshes', () => {
    registerColliderDefinition('elevator', ElevatorNode, 'structure')

    const elevator = ElevatorNode.parse({ id: 'elevator_test' })
    setSceneNodes([elevator])
    mountNode(elevator, [2, 3, 2], [0, 1.5, 0])

    const world = buildFirstPersonColliderWorldFromRegistry()

    expect(world).toBeNull()
  })

  test('adds a fallback floor for a visible level with no slab', () => {
    const level = LevelNode.parse({ id: 'level_test', level: 0 })
    setSceneNodes([level])
    mountRegistryGroup(level)

    const world = buildFirstPersonColliderWorldFromRegistry()

    expect(world).not.toBeNull()
    expect(world?.bounds?.min.y).toBeCloseTo(-0.08)
    expect(world?.bounds?.max.y).toBeCloseTo(0)
    world?.dispose()
  })

  test('adds a fallback floor only for the lowest slab-less level in a building', () => {
    const building = BuildingNode.parse({
      id: 'building_test',
      children: ['level_ground', 'level_upper'],
    })
    const groundLevel = LevelNode.parse({
      id: 'level_ground',
      parentId: building.id,
      level: 0,
      height: 3,
    })
    const upperLevel = LevelNode.parse({
      id: 'level_upper',
      parentId: building.id,
      level: 1,
    })
    setSceneNodes([building, groundLevel, upperLevel])
    mountRegistryGroup(groundLevel)
    mountRegistryGroup(upperLevel, [0, 3, 0])

    const world = buildFirstPersonColliderWorldFromRegistry()

    expect(world).not.toBeNull()
    expect(world?.bounds?.min.y).toBeCloseTo(-0.08)
    expect(world?.bounds?.max.y).toBeCloseTo(0)
    world?.dispose()
  })

  test('adds a site ground collider so a spawn on bare ground has a floor', () => {
    const site = SiteNode.parse({ id: 'site_test' })
    setSceneNodes([site])
    mountRegistryGroup(site)

    const world = buildFirstPersonColliderWorldFromRegistry()

    expect(world).not.toBeNull()
    // Ground slab sits just below the site ground plane (y = 0).
    expect(world?.bounds?.min.y).toBeCloseTo(-0.08)
    expect(world?.bounds?.max.y).toBeCloseTo(0)
    // The ground collider extends far past the site polygon so stepping out of
    // the site boundary never drops the player below the ground plane.
    expect(world?.bounds?.min.x).toBeCloseTo(-1000)
    expect(world?.bounds?.max.x).toBeCloseTo(1000)
    expect(world?.bounds?.min.z).toBeCloseTo(-1000)
    expect(world?.bounds?.max.z).toBeCloseTo(1000)
    world?.dispose()
  })

  test('a sculpted site walks on its terrain instead of the flat ground slab', () => {
    const base = createTerrainField({ cols: 17, rows: 17, spacing: 1, origin: [-8, -8] })
    const patch = flattenPatch(base, { minX: 2, minZ: 2, maxX: 5, maxZ: 5 }, 2.5)
    const field = applyHeightPatch(base, patch as never)
    const site = SiteNode.parse({ id: 'site_test', terrain: encodeTerrainField(field) })
    setSceneNodes([site])
    mountRegistryGroup(site)

    const world = buildFirstPersonColliderWorldFromRegistry()
    expect(world).not.toBeNull()
    if (!world) return

    // The hill is in the collider: a flat slab would top out at 0.
    expect(world.bounds?.max.y).toBeCloseTo(2.5)
    // And it still reaches past the site so stepping out does not drop the player.
    expect(world.bounds?.min.x).toBeCloseTo(-1008)
    expect(world.bounds?.max.x).toBeCloseTo(1008)

    // What the player actually stands on, on the plateau and off it.
    const raycaster = new Raycaster()
    const standOn = (x: number, z: number) => {
      raycaster.set(new Vector3(x, 500, z), new Vector3(0, -1, 0))
      return raycaster.intersectObject(world.mesh, false)[0]?.point.y ?? null
    }
    expect(standOn(3, 3)).toBeCloseTo(2.5, 4)
    expect(standOn(-3, -3)).toBeCloseTo(0, 4)

    world.dispose()
  })
})

// A door built from a script is drawn by its model: the leaves are the model's own and its `open`
// clip moves them. What the player is stopped by is a stand-in leaf box at the door's frame, and
// that box has to follow the door's own open state, not the native `operationState` the clip
// never touches.
describe('a door built from a script', () => {
  const source = {
    kind: 'script' as const,
    script: 'b'.repeat(64),
    artifact: 'a'.repeat(64),
    manifest: GeometryArtifactManifest.parse({
      bounds: { min: [-0.6, 0, -0.11], max: [0.6, 2.55, 0.11] },
      triangles: 12,
      animations: [{ name: 'open', duration: 1.3 }],
    }),
  }
  // The door mechanism's open state for a script: the first control toggle of the item.
  const mechanism = {
    verb: 'open',
    icon: 'door',
    has: (node: AnyNode) => Boolean((node as { source?: unknown }).source),
    isOn: (node: AnyNode, state: ReturnType<typeof useInteractive.getState>) =>
      Boolean(state.items[node.id as never]?.controlValues[0]),
    set: () => {},
  }

  function mountScriptedDoor(language: 'three' | 'bpy' = 'three') {
    registerNode({
      kind: 'door',
      schema: DoorNode,
      schemaVersion: 1,
      category: 'structure',
      capabilities: { mechanism },
    } as unknown as AnyNodeDefinition)
    registerColliderDefinition('column', ColumnNode, 'structure')
    const door = DoorNode.parse({
      id: 'door_shoji',
      doorType: 'sliding',
      width: 1.2,
      height: 2.55,
      source: { ...source, language },
    })
    const column = ColumnNode.parse({ id: 'column_far' })
    setSceneNodes([door, column])
    mountNode(column, [1, 2, 1], [10, 1, 0])
    // The door's registered group, as its renderer builds it: the compiled model under it, with
    // the agent's 1 m deep `cutout` box and two leaves.
    const group = new Group()
    group.position.set(0, 1.275, 0)
    const box = (name: string, size: [number, number, number], x: number, z: number) => {
      const mesh = new Mesh(new BoxGeometry(...size), new MeshBasicMaterial())
      mesh.name = name
      mesh.position.set(x, 0, z)
      group.add(mesh)
    }
    box('cutout', [1.2, 2.55, 1], 0, 0)
    box('leaf_0', [0.5, 2.4, 0.02], -0.255, 0.025)
    box('leaf_1', [0.5, 2.4, 0.02], 0.255, -0.025)
    group.updateMatrixWorld(true)
    sceneRegistry.nodes.set(door.id, group)
    sceneRegistry.byType.door!.add(door.id)
    return door
  }

  /** Walk straight at the doorway from the front, at hip height: where the first thing is hit. */
  function firstHitAcrossDoorway() {
    const world = buildFirstPersonColliderWorldFromRegistry()
    if (!world) return null
    const raycaster = new Raycaster(new Vector3(0, 1, -3), new Vector3(0, 0, 1))
    const hit = raycaster.intersectObject(world.mesh, false)[0]
    world.dispose()
    return hit ? { z: hit.point.z } : null
  }

  afterEach(() => {
    useInteractive.setState({ items: {} } as never)
    sceneRegistry.clear()
    nodeRegistry._reset()
    useScene.setState({ nodes: {}, rootNodeIds: [] } as never)
  })

  test('a closed one stops the player at its leaf, not at the model’s cutout box', () => {
    mountScriptedDoor()
    useInteractive.setState({ items: { door_shoji: { controlValues: [false] } } } as never)

    const hit = firstHitAcrossDoorway()
    expect(hit).not.toBeNull()
    // the stand-in leaf is 0.06 m deep at the frame; the cutout would stop the player at z = -0.5
    expect(hit!.z).toBeCloseTo(-0.03, 3)
  })

  test('an open one can be walked through, and its cutout never collides', () => {
    mountScriptedDoor()
    useInteractive.setState({ items: { door_shoji: { controlValues: [true] } } } as never)

    expect(firstHitAcrossDoorway()).toBeNull()
  })
  test('a Blender-built door follows its mechanism the same way: the language makes no difference', () => {
    mountScriptedDoor('bpy')
    useInteractive.setState({ items: { door_shoji: { controlValues: [false] } } } as never)
    expect(firstHitAcrossDoorway()?.z).toBeCloseTo(-0.03, 3)

    useInteractive.setState({ items: { door_shoji: { controlValues: [true] } } } as never)
    expect(firstHitAcrossDoorway()).toBeNull()
  })
})

// The ground is a sheet across the lot, and under a house with a basement the sheet ran across the
// stairwell: a walker going down the stair met it at grade. The ground is drawn open over what the
// house covers (`coveredBelowGradeFootprints`), and the walker's ground is cut open over the same.
describe('a basement under the house', () => {
  afterEach(() => {
    sceneRegistry.clear()
    nodeRegistry._reset()
    useScene.setState({ nodes: {}, rootNodeIds: [] } as never)
  })

  type Box = { size: [number, number, number]; at: [number, number, number] }

  function mountBoxes(node: AnyNode, boxes: Box[]) {
    const group = new Group()
    for (const { size, at } of boxes) {
      const mesh = new Mesh(new BoxGeometry(...size), new MeshBasicMaterial())
      mesh.position.set(...at)
      group.add(mesh)
    }
    group.updateMatrixWorld(true)
    sceneRegistry.nodes.set(node.id, group)
    sceneRegistry.byType[node.type]!.add(node.id)
  }

  const rect = (x0: number, x1: number, z0: number, z1: number): Array<[number, number]> => [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ]
  const TREADS = 14
  const RISE = 0.2
  const FLOOR_G = 0.05
  const FLOOR_B = -2.95

  /**
   * An 8 m square house on a flat site (or a flat sculpted one) over a basement whose floor lies at
   * -2.95 m, its plan 1.3..6.7 × 1.4..6.6. The ground floor is a slab with the stairwell cut out of
   * it, and a stair of 14 treads, 0.2 m each, goes down along +x from x = 2 at z 3..4.
   */
  function house(sculpted: boolean) {
    registerColliderDefinition('slab', SlabNode, 'structure', 'floor')
    registerColliderDefinition('stair', StairNode, 'structure')
    const field = createTerrainField({ cols: 21, rows: 21, spacing: 1, origin: [-6, -6] })
    const site = SiteNode.parse({
      id: 'site_test',
      children: ['building_a'],
      ...(sculpted ? { terrain: encodeTerrainField(field) } : {}),
    })
    const building = BuildingNode.parse({
      id: 'building_a',
      parentId: site.id,
      children: ['level_b', 'level_g'],
    })
    const basement = LevelNode.parse({
      id: 'level_b',
      parentId: building.id,
      level: -1,
      baseElevation: -3,
      height: 3,
      children: ['slab_b'],
    })
    const ground = LevelNode.parse({
      id: 'level_g',
      parentId: building.id,
      level: 0,
      height: 3,
      children: ['slab_g'],
    })
    const slabB = SlabNode.parse({
      id: 'slab_b',
      parentId: basement.id,
      polygon: rect(1.3, 6.7, 1.4, 6.6),
      elevation: 0.05,
    })
    const slabG = SlabNode.parse({
      id: 'slab_g',
      parentId: ground.id,
      polygon: rect(0, 8, 0, 8),
      elevation: FLOOR_G,
    })
    const stair = StairNode.parse({ id: 'stair_a', parentId: basement.id })
    setSceneNodes([site, building, basement, ground, slabB, slabG, stair])
    mountRegistryGroup(site)
    mountBoxes(slabB, [{ size: [5.4, 0.1, 5.2], at: [4, FLOOR_B - 0.05, 4] }])
    // The ground floor around the stairwell (x 2..5.4, z 3..4).
    mountBoxes(slabG, [
      { size: [2, 0.1, 8], at: [1, FLOOR_G - 0.05, 4] },
      { size: [2.6, 0.1, 8], at: [6.7, FLOOR_G - 0.05, 4] },
      { size: [3.4, 0.1, 3], at: [3.7, FLOOR_G - 0.05, 1.5] },
      { size: [3.4, 0.1, 4], at: [3.7, FLOOR_G - 0.05, 6] },
    ])
    mountBoxes(
      stair,
      Array.from({ length: TREADS }, (_, i) => ({
        size: [0.3, RISE, 1] as [number, number, number],
        at: [2.15 + 0.3 * i, FLOOR_G - RISE * (i + 1) - RISE / 2, 3.5] as [number, number, number],
      })),
    )
  }

  const UP = new Vector3(0, 1, 0)
  /** The first upward-facing surface under (x, z), looking down from `from`. */
  function floorUnder(mesh: Mesh, x: number, z: number, from: number): number | null {
    const raycaster = new Raycaster()
    raycaster.set(new Vector3(x, from, z), new Vector3(0, -1, 0))
    const hit = raycaster
      .intersectObject(mesh, false)
      .find(
        (h) => !h.face || h.face.normal.clone().transformDirection(mesh.matrixWorld).dot(UP) > 0.2,
      )
    return hit ? hit.point.y : null
  }

  for (const sculpted of [false, true]) {
    describe(sculpted ? 'on sculpted ground' : 'on flat ground', () => {
      test('a walker goes down the stair from the ground floor to the basement', () => {
        house(sculpted)
        const world = buildFirstPersonColliderWorldFromRegistry()!
        expect(world).not.toBeNull()

        // Eye-level search from half a metre over the floor the walker stands on, a step at a time
        // along the stair's run: the floor found is the next one he stands on.
        let floor = floorUnder(world.mesh, 1, 3.5, 3)!
        expect(floor).toBeCloseTo(FLOOR_G, 6)
        const floors = [floor]
        for (let x = 1.1; x < 6.5; x += 0.1) {
          floor = floorUnder(world.mesh, x, 3.5, floor + 0.5) ?? Number.NaN
          floors.push(floor)
        }
        // He never stands on the ground sheet (0 m) once past the stairwell's edge, and ends on
        // the basement's floor; no step is deeper than a tread.
        expect(Math.min(...floors)).toBeCloseTo(FLOOR_B, 6)
        for (let i = 1; i < floors.length; i += 1)
          expect(floors[i - 1]! - floors[i]!).toBeLessThanOrEqual(RISE + 1e-6)
        world.dispose()
      })

      test('the ground is open over the part of the basement the house covers, and closed past it', () => {
        house(sculpted)
        const world = buildFirstPersonColliderWorldFromRegistry()!
        // Under the ground floor's slab, looking down from just under it: the ground sheet is
        // there outside the basement's plan and gone inside it, where the basement's floor is.
        const under = (x: number, z: number) => floorUnder(world.mesh, x, z, FLOOR_G - 0.03)
        expect(under(1.2, 5)).toBeCloseTo(0, 6)
        expect(under(1.4, 5)).toBeCloseTo(FLOOR_B, 6)
        expect(under(6.6, 5)).toBeCloseTo(FLOOR_B, 6)
        expect(under(6.8, 5)).toBeCloseTo(0, 6)
        expect(under(4, 1.3)).toBeCloseTo(0, 6)
        expect(under(4, 1.5)).toBeCloseTo(FLOOR_B, 6)
        // Outside the house: the garden is walked on as before.
        expect(floorUnder(world.mesh, 12, 5, 3)).toBeCloseTo(0, 6)
        expect(floorUnder(world.mesh, -3, -3, 3)).toBeCloseTo(0, 6)
        world.dispose()
      })
    })
  }
})
