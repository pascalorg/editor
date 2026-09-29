import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  AnyNode,
  BuildingNode,
  calculateLevelMiters,
  computePlateSurfacePartition,
  computeWallSlabSupport,
  createTerrainField,
  DoorNode,
  encodeTerrainField,
  type GeometryContext,
  getLevelElevations,
  getOpeningFloorDatum,
  LevelNode,
  plateLevelContext,
  pointInPolygon2D,
  SeparatorNode,
  SiteNode,
  SlabNode,
  sceneRegistry,
  slabPolygonContextFromGeometry,
  WallNode,
  WindowNode,
  ZoneNode,
} from '@pascal-app/core'
import { generateSlabGeometry } from '@pascal-app/viewer'
import { FrontSide, Group, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { floorStepFixture as rawFloorStepFixture } from '../../../../core/src/systems/slab/__fixtures__/floor-step'
import { reconcileStructureOnLoad } from '../../../../core/src/utils/reconcile-structure-on-load'
import { reconcileStructureWithStableIds } from '../../../../core/src/utils/structure-id'
import { generateExtrudedWall } from '../../../../viewer/src/systems/wall/wall-system'
import { createSlabDependencyTracker } from '../dependency-tracker'
import { buildSlabGeometry } from '../geometry'
import { splitPlateFaces } from '../surface-split'

const rect = (x0: number, z0: number, x1: number, z1: number): [number, number][] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
]
const plate = (polygon: [number, number][], elevation: number, holes: [number, number][][] = []) =>
  SlabNode.parse({ boundary: 'auto', polygon, elevation, thickness: 0.05, holes })

function floorStepFixture(separator = false) {
  const fixture = rawFloorStepFixture(separator)
  fixture.level.height = 3
  return fixture
}

function context(slabs: SlabNode[], walls: WallNode[] = []): GeometryContext {
  const level = LevelNode.parse({ children: [...slabs, ...walls].map((n) => n.id) })
  const nodes = Object.fromEntries([...slabs, ...walls, level].map((n) => [n.id, n]))
  return { parent: level, resolve: (id) => nodes[id], children: [], siblings: [...slabs, ...walls] }
}

function build(node: SlabNode, ctx: GeometryContext) {
  return buildSlabGeometry(node, ctx, 'solid', false)
}

function riser(group: Group) {
  const meshes = group.children.filter(
    (m): m is Mesh => m instanceof Mesh && m.userData.slotId === 'riser',
  )
  expect(meshes).toHaveLength(1)
  return meshes[0]!
}

function probe(
  group: Group,
  start: [number, number],
  end: [number, number],
  heights: number[],
  baseY = 0,
) {
  group.updateMatrixWorld(true)
  const direction = new Vector3(end[1] - start[1], 0, start[0] - end[0]).normalize()
  for (const t of [0.17, 0.43, 0.79]) {
    const x = start[0] + (end[0] - start[0]) * t
    const z = start[1] + (end[1] - start[1]) * t
    for (const y of heights) {
      const origin = new Vector3(x, y + baseY, z).addScaledVector(direction, 0.1)
      const hits = new Raycaster(origin, direction.clone().negate(), 0, 0.2).intersectObject(
        group,
        true,
      )
      expect(hits).toHaveLength(1)
      expect(hits[0]!.object.userData.slotId).toBe('riser')
      expect(hits[0]!.face!.normal.dot(direction)).toBeGreaterThan(0.99)
    }
  }
}

function fixture() {
  const { nodes } = JSON.parse(
    readFileSync(new URL('../__fixtures__/sunken-pit-scene.json', import.meta.url), 'utf8'),
  ) as { nodes: Record<string, AnyNode> }
  const host = SlabNode.parse(nodes.slab_2wetb55oie8qzyhb)
  const parent = nodes[host.parentId!]!
  const ctx: GeometryContext = {
    parent,
    resolve: (id) => nodes[id],
    children: [],
    siblings: Object.values(nodes).filter((n) => n.parentId === host.parentId),
  }
  return { host, ctx }
}

test('sunken fixture riser reaches the pit top and every boundary gap probe hits once', () => {
  const { host, ctx } = fixture()
  const group = build(host, ctx)
  const mesh = riser(group)
  mesh.geometry.computeBoundingBox()
  expect(mesh.geometry.boundingBox!.min.y).toBeCloseTo(-0.5957, 4)
  expect(mesh.geometry.boundingBox!.max.y).toBeCloseTo(0.05)
  const hole = host.holes![0]!
  for (const [i, start] of hole.entries())
    probe(group, start, hole[(i + 1) % hole.length]!, [-0.59, -0.4, -0.2, -0.001, 0.04])
  const uv = mesh.geometry.getAttribute('uv')
  expect(Array.from(mesh.geometry.getAttribute('uv2').array)).toEqual(Array.from(uv.array))
  const lower = build(SlabNode.parse(ctx.resolve('slab_m7byobc8mtx1apva')), ctx)
  for (const child of lower.children) {
    if (!(child instanceof Mesh)) continue
    child.geometry.computeBoundingBox()
    expect(child.geometry.boundingBox!.max.y).toBeLessThanOrEqual(-0.5957)
  }
})

test('straight separator gap probes hit at each neighbour depth without overlapping faces', () => {
  const host = plate(rect(0, 0, 4, 4), 0.05)
  const shallow = plate(rect(4, 0, 8, 2), -0.6)
  const deep = plate(rect(4, 2, 8, 4), -1.2)
  const group = build(host, context([host, shallow, deep]))
  probe(group, [4, 0], [4, 2], [-0.59, -0.3, 0.04])
  probe(group, [4, 2], [4, 4], [-1.19, -0.9, -0.59, 0.04])
  expect(
    new Raycaster(new Vector3(4.1, -0.9, 1), new Vector3(-1, 0, 0), 0, 0.2).intersectObject(
      group,
      true,
    ),
  ).toHaveLength(0)
})

test('nested pit risers close both steps', () => {
  const outer = plate(rect(0, 0, 8, 8), 0.05, [rect(1, 1, 7, 7)])
  const middle = plate(rect(1, 1, 7, 7), -0.6, [rect(2, 2, 6, 6)])
  const inner = plate(rect(2, 2, 6, 6), -1.2)
  const ctx = context([outer, middle, inner])
  probe(build(outer, ctx), [1, 7], [7, 7], [-0.59, -0.3, 0.04])
  probe(build(middle, ctx), [2, 6], [6, 6], [-1.19, -0.9, -0.61])
})

test('raised platform beside a pit has one continuous riser and keeps its exterior base fill', () => {
  const host = plate(rect(0, 0, 4, 4), 0.8)
  const lower = plate(rect(4, 0, 8, 4), -0.6)
  const group = build(host, context([host, lower]))
  probe(group, [4, 0], [4, 4], [-0.59, -0.3, 0.01, 0.4, 0.79])
  const edge = group.children.find((m) => m.userData.slotId === 'edge') as Mesh
  edge.geometry.computeBoundingBox()
  expect(edge.geometry.boundingBox!.min.y).toBe(0)
})

test('platform step stops at a positive lower top instead of overlapping the lower plate side', () => {
  const host = plate(rect(0, 0, 4, 4), 0.8)
  const lower = plate(rect(4, 0, 8, 4), 0.3)
  const group = build(host, context([host, lower]))
  probe(group, [4, 0], [4, 4], [0.31, 0.5, 0.79])
  const mesh = riser(group)
  mesh.geometry.computeBoundingBox()
  expect(mesh.geometry.boundingBox!.min.y).toBeCloseTo(0.3)
})

test('step heights remain level-local under a nonzero level world elevation', () => {
  const host = plate(rect(0, 0, 4, 4), 0.05)
  const lower = plate(rect(4, 0, 8, 4), -0.6)
  const ground = LevelNode.parse({ level: 0, height: 3.2, baseElevation: 0.5 })
  const upstairs = LevelNode.parse({
    level: 1,
    height: 3,
    baseElevation: 1,
    children: [host.id, lower.id],
  })
  const building = BuildingNode.parse({ children: [ground.id, upstairs.id] })
  ground.parentId = building.id
  upstairs.parentId = building.id
  host.parentId = upstairs.id
  lower.parentId = upstairs.id
  const foreign = plate(rect(4, 0, 8, 4), -0.1)
  foreign.parentId = ground.id
  ground.children = [foreign.id]
  const nodes = Object.fromEntries(
    [host, lower, foreign, ground, upstairs, building].map((n) => [n.id, n]),
  )
  const group = build(host, {
    parent: upstairs,
    resolve: (id) => nodes[id],
    children: [],
    siblings: [host, lower],
  })
  const baseY = getLevelElevations(nodes).get(upstairs.id)!.baseY
  expect(baseY).toBeCloseTo(4.7)
  group.position.y = baseY
  probe(group, [4, 0], [4, 4], [-0.59, -0.3, 0.04], baseY)
})

test('wall-covered pit has no riser mesh and its walls close every gap', () => {
  const hole = rect(1, 1, 3, 3)
  const host = plate(rect(0, 0, 4, 4), 0.05, [hole])
  const lower = plate(hole, -0.6)
  const zones = [
    ZoneNode.parse({
      name: 'Host',
      spaceRole: 'room',
      polygon: host.polygon,
      holes: [hole],
      floor: { elevation: host.elevation },
    }),
    ZoneNode.parse({
      name: 'Pit',
      spaceRole: 'room',
      polygon: hole,
      floor: { elevation: lower.elevation },
    }),
  ]
  host.zoneIds = [zones[0]!.id]
  lower.zoneIds = [zones[1]!.id]
  const walls = hole.map((start, i) =>
    WallNode.parse({ start, end: hole[(i + 1) % hole.length], thickness: 0.2 }),
  )
  const ctx = context([host, lower], walls)
  const level = ctx.parent as LevelNode
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [host, lower, ...walls, ...zones, level].map((n) => [n.id, n]),
  )
  for (const n of [host, lower, ...walls, ...zones]) n.parentId = level.id
  level.children.push(...zones.map((z) => z.id))
  ctx.resolve = (id) => nodes[id]
  const group = build(host, ctx)
  expect(group.children.some((m) => m.userData.slotId === 'riser')).toBe(false)
  const material = new MeshBasicMaterial({ side: FrontSide })
  for (const wall of walls) {
    const support = computeWallSlabSupport(
      wall,
      [host, lower],
      walls,
      undefined,
      undefined,
      0,
      nodes,
    )
    const geometry = generateExtrudedWall(
      wall,
      [],
      calculateLevelMiters(walls),
      support.elevation,
      support.baseElevation,
      support.baseSegments,
      3,
      undefined,
      support.faceDatum,
      undefined,
      nodes,
    )
    const mesh = new Mesh(geometry, material)
    mesh.position.y = support.elevation
    mesh.updateMatrixWorld(true)
    const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
    for (const y of [-0.59, -0.3, 0.04]) {
      const origin = new Vector3(length / 2, y, 0.3)
      expect(
        new Raycaster(origin, new Vector3(0, 0, -1), 0, 0.4).intersectObject(mesh),
      ).toHaveLength(1)
    }
    geometry.dispose()
  }
  material.dispose()
})

test('open-below hole keeps only its original slab thickness', () => {
  const host = plate(rect(0, 0, 4, 4), 0.05, [rect(1, 1, 3, 3)])
  const mesh = build(host, context([host])).children.find(
    (child) => child.userData.slotId === 'edge',
  ) as Mesh
  mesh.geometry.computeBoundingBox()
  expect(mesh.geometry.boundingBox!.min.y).toBeCloseTo(0)
  expect(mesh.geometry.boundingBox!.max.y).toBeCloseTo(0.05)
})

test('lowering the fixture pit dirties its unchanged host and rebuilds the deeper riser', () => {
  const { host, ctx } = fixture()
  const level = ctx.parent as LevelNode
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [level, ...ctx.siblings].map((n) => [n.id, n]),
  )
  const track = createSlabDependencyTracker(nodes)
  const lower = SlabNode.parse(nodes.slab_m7byobc8mtx1apva)
  const changed = { ...nodes, [lower.id]: { ...lower, elevation: -0.9 } }
  expect(track(changed)).toContain(host.id)
  const group = build(host, { ...ctx, resolve: (id) => changed[id] })
  const hole = host.holes![0]!
  probe(group, hole[0]!, hole[1]!, [-0.89, -0.7, 0.04])
})

test('changing a neighbour to open support rebuilds the solid riser beneath the mezzanine', () => {
  const host = plate(rect(0, 0, 4, 4), 2)
  const floor = plate(rect(4, 0, 8, 4), 0.05)
  const neighbour = plate(rect(4, 0, 8, 4), 1.3)
  const ctx = context([host, floor, neighbour])
  const level = ctx.parent as LevelNode
  for (const slab of [host, floor, neighbour]) slab.parentId = level.id
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [level, host, floor, neighbour].map((node) => [node.id, node]),
  )
  const track = createSlabDependencyTracker(nodes)
  const before = riser(build(host, ctx))
  before.geometry.computeBoundingBox()
  expect(before.geometry.boundingBox!.min.y).toBeCloseTo(1.3)
  const open: SlabNode = { ...neighbour, support: 'open' }
  const changed = { ...nodes, [open.id]: open }
  expect(track(changed)).toContain(host.id)
  const group = build(host, { ...ctx, resolve: (id) => changed[id] })
  probe(group, [4, 0], [4, 4], [0.1, 0.5, 1, 1.5, 1.99])
  expect(track(nodes)).toContain(host.id)
})

test('terrain skirt clips only the partial step run and keeps the adjacent exterior fill', () => {
  const host = { ...plate(rect(0, 0, 4, 4), 0.05), fillToTerrain: true }
  const pit = plate(rect(4, 1.23, 8, 2.87), -0.6)
  const ctx = context([host, pit])
  const level = ctx.parent as LevelNode
  const field = createTerrainField({ cols: 11, rows: 7, spacing: 1, origin: [-1, -1] })
  field.heights.fill(-150)
  const site = SiteNode.parse({ terrain: encodeTerrainField(field) })
  const building = BuildingNode.parse({ parentId: site.id, children: [level.id] })
  site.children = [building.id]
  level.parentId = building.id
  host.parentId = level.id
  pit.parentId = level.id
  const nodes = Object.fromEntries(
    [site, building, level, host, pit].map((node) => [node.id, node]),
  )
  const group = build(host, { ...ctx, resolve: (id) => nodes[id] })
  probe(group, [4, 1.23], [4, 2.87], [-0.59, -0.3, -0.01, 0.04])
  for (const z of [0.37, 1.21, 2.89, 3.61]) {
    const hits = new Raycaster(
      new Vector3(4.1, -0.3, z),
      new Vector3(-1, 0, 0),
      0,
      0.2,
    ).intersectObject(group, true)
    expect(hits).toHaveLength(1)
    expect(hits[0]!.object.userData.slotId).toBe('edge')
  }
})

test('riser UVs preserve the original edge origin across walls, doors and neighbour seams', () => {
  const host = plate(rect(0, 0, 4.1, 6), 0.05)
  const shallow = plate(rect(4.1, 0, 8, 2.4), -0.6)
  const deep = plate(rect(4.1, 2.4, 8, 6), -0.9)
  const wall = WallNode.parse({ start: [4, 1], end: [4, 4.4], thickness: 0.2 })
  const door = DoorNode.parse({
    parentId: wall.id,
    wallId: wall.id,
    width: 0.8,
    height: 2,
    position: [1.7, 1, 0],
  })
  wall.children = [door.id]
  const ctx = context([host, shallow, deep], [wall])
  const resolve = ctx.resolve
  ctx.resolve = (id) => (id === door.id ? door : resolve(id))
  const group = build(host, ctx)
  group.updateMatrixWorld(true)
  const raw = generateSlabGeometry(host, slabPolygonContextFromGeometry(ctx))
  const material = new MeshBasicMaterial()
  const original = new Mesh(raw, material)
  original.updateMatrixWorld(true)
  for (const z of [0.41, 2.37, 2.85, 4.7, 5.43]) {
    const sourceRay = new Raycaster(new Vector3(4.2, 0.025, z), new Vector3(-1, 0, 0), 0, 0.2)
    const sourceU = sourceRay.intersectObject(original)[0]!.uv!.x
    expect(sourceU).toBeCloseTo(z)
    for (const y of [-0.3, 0.025]) {
      const hits = new Raycaster(
        new Vector3(4.2, y, z),
        new Vector3(-1, 0, 0),
        0,
        0.2,
      ).intersectObject(group, true)
      expect(hits).toHaveLength(1)
      expect(hits[0]!.object.userData.slotId).toBe('riser')
      expect(hits[0]!.uv!.x).toBeCloseTo(sourceU, 5)
      expect(hits[0]!.uv!.y).toBeCloseTo(y, 5)
    }
  }
  raw.dispose()
  material.dispose()
})

test('direct plate splitting extends drops with the required slab context', () => {
  const { host, ctx } = fixture()
  const partition = computePlateSurfacePartition(host, plateLevelContext(ctx.parent, ctx.resolve))!
  const raw = generateSlabGeometry(host, slabPolygonContextFromGeometry(ctx))
  const group = new Group()
  const material = new MeshBasicMaterial()
  const buckets = splitPlateFaces(raw, partition, host)
  for (const { role, geometry } of buckets) {
    const mesh = new Mesh(geometry, material)
    mesh.userData.slotId = role.startsWith('step:') ? 'riser' : role
    group.add(mesh)
  }
  const hole = host.holes![0]!
  probe(group, hole[0]!, hole[1]!, [-0.59, -0.3, 0.04])
  raw.dispose()
  for (const bucket of buckets) bucket.geometry.dispose()
  material.dispose()
})

function derivedScene(source: Record<string, AnyNode>, baseElevation = 0.05) {
  const nodes = reconcileStructureOnLoad(source).nodes
  const slabs = Object.values(nodes).filter((node): node is SlabNode => node.type === 'slab')
  const walls = Object.values(nodes).filter((node): node is WallNode => node.type === 'wall')
  const group = new Group()
  for (const slab of slabs)
    group.add(
      build(slab, {
        parent: nodes[slab.parentId!]!,
        resolve: (id) => nodes[id],
        children: [],
        siblings: Object.values(nodes).filter((node) => node.parentId === slab.parentId),
      }),
    )
  const material = new MeshBasicMaterial({ side: FrontSide })
  for (const wall of walls) {
    const support = computeWallSlabSupport(wall, slabs, walls, undefined, undefined, 0, nodes)
    expect(support.elevation).toBeCloseTo(baseElevation)
    const registered = new Mesh()
    sceneRegistry.nodes.set(wall.id, registered)
    const geometry = generateExtrudedWall(
      wall,
      wall.children.map((id) => nodes[id]!),
      calculateLevelMiters(walls),
      support.elevation,
      support.baseElevation,
      support.baseSegments,
      3,
      undefined,
      support.faceDatum,
      undefined,
      nodes,
    )
    sceneRegistry.nodes.delete(wall.id)
    registered.geometry.dispose()
    const mesh = new Mesh(geometry, material)
    mesh.userData.slotId = 'wall'
    mesh.position.set(wall.start[0], support.elevation, wall.start[1])
    mesh.rotation.y = -Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0])
    group.add(mesh)
  }
  group.updateMatrixWorld(true)
  return { nodes, slabs, group }
}

function authoredScene(source: Record<string, AnyNode>) {
  // Fresh room edits follow floor intent; legacy loads may preserve an old opening datum.
  return derivedScene(reconcileStructureWithStableIds({ nodes: source }).nodes)
}

function hitOnce(
  group: Group,
  origin: [number, number, number],
  direction: [number, number, number],
  slot: string,
  far = 0.15,
) {
  const hits = new Raycaster(
    new Vector3(...origin),
    new Vector3(...direction),
    0,
    far,
  ).intersectObject(group, true)
  expect(hits).toHaveLength(1)
  expect(hits[0]!.object.userData.slotId).toBe(slot)
  return hits[0]!
}

test('a live non-fitting door stays at its base without a floating platform threshold', () => {
  const source = floorStepFixture()
  source.level.height = 2.5
  source.nodes[source.zones[0]!.id] = { ...source.zones[0]!, floor: { elevation: 2.1 } }
  source.nodes[source.zones[1]!.id] = { ...source.zones[1]!, floor: { elevation: 0.05 } }
  source.nodes[source.divider.id] = { ...source.divider, children: [source.door.id] }
  source.nodes[source.door.id] = source.door
  const { group, nodes } = authoredScene(source.nodes)
  const door = nodes[source.door.id] as DoorNode
  expect(door.verticalAnchor).toBeUndefined()
  expect(getOpeningFloorDatum(nodes[source.divider.id] as WallNode, door, nodes)).toBeCloseTo(0.05)
  for (const y of [0.2, 1, 1.9]) {
    const side = hitOnce(group, [4.2, y, 1.83], [-1, 0, 0], 'riser', 0.4)
    expect(side.point.x).toBeCloseTo(3.9)
  }
  hitOnce(group, [4.2, 2.2, 1.83], [-1, 0, 0], 'wall')
  const threshold = hitOnce(group, [4, 1.9, 1.83], [0, -1, 0], 'surface', 2)
  expect(threshold.point.y).toBeCloseTo(0.05)
})

for (const [high, low] of [
  [0.55, 0.05],
  [0.05, -0.4],
  [0.55, -0.4],
  [0.8, 0.3],
  [-0.2, -0.6],
]) {
  test(`derived door step ${high}/${low}: one plate riser, no wall fill, continuous facade`, () => {
    const source = floorStepFixture()
    for (const [i, zone] of source.zones.entries())
      source.nodes[zone.id] = {
        ...zone,
        floor: { elevation: i ? low : high, finish: 'library:preset-tomato' },
      }
    source.nodes[source.divider.id] = { ...source.divider, children: [source.door.id] }
    source.nodes[source.door.id] = source.door
    const { group, slabs, nodes } = authoredScene(source.nodes)
    expect(slabs.filter((slab) => slab.plateRole === 'base')).toHaveLength(1)
    for (const z of [1.67, 1.93, 2.31]) {
      for (const t of [0.07, 0.43, 0.91]) {
        const hit = hitOnce(group, [4.2, low! + (high! - low!) * t, z], [-1, 0, 0], 'riser')
        // The higher room owns the step, keyed by the door it sits under.
        expect(hit.object.userData.paintRole).toBe(`step:${source.zones[0]!.id}/door_step`)
      }
      const hit = hitOnce(group, [4, high! + 0.1, z], [0, -1, 0], `room:${source.zones[0]!.id}`)
      expect(hit.point.y).toBeCloseTo(high!)
    }
    for (const x of [1.3, 5.7]) {
      hitOnce(group, [x, 0.025, -0.2], [0, 0, 1], 'edge')
      hitOnce(group, [x, 0.08, -0.2], [0, 0, 1], 'wall')
    }
    if (high! > 0.05) {
      const base = slabs.find((slab) => slab.plateRole === 'base')!
      const partition = computePlateSurfacePartition(
        base,
        plateLevelContext(nodes[base.parentId!]!, (id) => nodes[id]),
      )!
      expect(partition.masked.length).toBeGreaterThan(0)
      hitOnce(group, [3.8, high! + 0.03, 0.8], [1, 0, 0], 'wall')
    }
  })
}

test('saved raised-room fixture preserves an already over-height door without inventing a landing', () => {
  const raw = JSON.parse(
    readFileSync(new URL('../__fixtures__/raised-room-scene.json', import.meta.url), 'utf8'),
  )
  const source = Object.fromEntries(
    Object.entries(raw.nodes).map(([id, node]) => [id, AnyNode.parse(node)]),
  )
  const { nodes, slabs, group } = derivedScene(source)
  const base = slabs.find((slab) => slab.plateRole === 'base')!
  const platform = slabs.find((slab) => slab.plateRole === 'platform')!
  expect(platform.elevation).toBe(0.55)
  expect(platform.thickness).toBe(0.5)
  expect(reconcileStructureOnLoad(nodes).changed).toBe(false)
  for (const elevation of [-0.4, 0.05, 0.8]) {
    const zone = nodes[platform.zoneIds![0]!] as ZoneNode
    const next = reconcileStructureOnLoad({
      ...nodes,
      [zone.id]: { ...zone, floor: { ...zone.floor, elevation } },
    }).nodes
    expect(next[base.id]).toMatchObject({ plateRole: 'base', elevation: 0.05 })
  }
  const door = nodes.door_ciy3fjzgm5qj1puj as DoorNode
  expect(
    getOpeningFloorDatum(nodes[door.parentId!] as WallNode, door, nodes) +
      door.position[1] -
      door.height / 2,
  ).toBeCloseTo(0.55)
  for (const x of [-0.97, -0.63, -0.33]) {
    const side = hitOnce(group, [x, 0.3, 0.65], [0, 0, -1], 'wall', 0.3)
    expect(side.point.z).toBeCloseTo(0.55)
    const floor = hitOnce(group, [x, 0.65, 0.5], [0, -1, 0], 'wall', 0.2)
    expect(floor.point.y).toBeCloseTo(0.55)
  }
})

test('raised terrace sides are edges and sit on a continuous base', () => {
  const level = LevelNode.parse({ id: 'level_terrace' })
  const polygon = rect(0, 0, 4, 4)
  const separators = polygon.map((start, i) =>
    SeparatorNode.parse({ parentId: level.id, start, end: polygon[(i + 1) % 4] }),
  )
  const zone = ZoneNode.parse({
    name: 'Terrace',
    parentId: level.id,
    spaceRole: 'room',
    polygon,
    floor: { elevation: 0.55 },
  })
  level.children = [...separators, zone].map((node) => node.id)
  const { group } = derivedScene(
    Object.fromEntries([level, zone, ...separators].map((node) => [node.id, node])),
  )
  for (const y of [0.025, 0.08, 0.3, 0.54]) hitOnce(group, [4.1, y, 1.7], [-1, 0, 0], 'edge')
})

for (const [high, low] of [
  [0.55, 0.05],
  [0.55, -0.4],
  [0.8, 0.3],
  [0.55, 0.55],
]) {
  test(`derived Divide ${high}/${low}: exposed riser stops at neighbour floor`, () => {
    const source = floorStepFixture(true)
    for (const [i, zone] of source.zones.entries())
      source.nodes[zone.id] = { ...zone, floor: { elevation: i ? low : high } }
    const { group } = derivedScene(source.nodes)
    if (high === low) {
      expect(
        new Raycaster(new Vector3(4.1, 0.3, 1.73), new Vector3(-1, 0, 0), 0, 0.15).intersectObject(
          group,
          true,
        ),
      ).toHaveLength(0)
    } else {
      for (const t of [0.03, 0.31, 0.73, 0.98]) {
        const hit = hitOnce(group, [4.1, low! + (high! - low!) * t, 1.73], [-1, 0, 0], 'riser')
        // No door on a Divide: the step is keyed by the lower room it looks at.
        expect(hit.object.userData.paintRole).toBe(
          `step:${source.zones[0]!.id}/${source.zones[1]!.id}`,
        )
      }
    }
  })
}

test('floor-level window gets the higher plate threshold and a single riser', () => {
  const source = floorStepFixture()
  const zone = source.zones[0]!
  source.nodes[zone.id] = { ...zone, floor: { elevation: 0.55 } }
  const window = WindowNode.parse({
    ...source.door,
    type: 'window',
    openingKind: 'window',
    id: 'window_step',
  })
  source.nodes[window.id] = window
  source.nodes[source.divider.id] = { ...source.divider, children: [window.id] }
  const { group } = derivedScene(source.nodes)
  for (const y of [-0.35, 0.025, 0.3, 0.53]) hitOnce(group, [4.2, y, 1.83], [-1, 0, 0], 'riser')
  hitOnce(group, [4, 0.65, 1.83], [0, -1, 0], `room:${zone.id}`)
})

test('derived plates stay level-local on an upper storey with a nonzero base elevation', () => {
  const source = floorStepFixture(true)
  source.level.level = 1
  source.level.baseElevation = 1
  const ground = LevelNode.parse({ id: 'level_ground', level: 0, height: 3.2, baseElevation: 0.5 })
  const building = BuildingNode.parse({ children: [ground.id, source.level.id] })
  ground.parentId = building.id
  source.level.parentId = building.id
  for (const node of [source.level, ground, building]) source.nodes[node.id] = node
  source.nodes[source.zones[0]!.id] = { ...source.zones[0]!, floor: { elevation: 0.55 } }
  const { group, nodes, slabs } = derivedScene(source.nodes)
  expect(slabs.find((slab) => slab.plateRole === 'base')!.elevation).toBeCloseTo(0.05)
  const baseY = getLevelElevations(nodes).get(source.level.id)!.baseY
  expect(baseY).toBeCloseTo(4.7)
  group.position.y = baseY
  group.updateMatrixWorld(true)
  for (const y of [-0.35, 0.025, 0.3, 0.54])
    hitOnce(group, [4.1, baseY + y, 1.83], [-1, 0, 0], 'riser')
})

test('raised top keeps manual surface, finish-region and room-finish priority over the masked base', () => {
  const source = floorStepFixture()
  const zone = source.zones[0]!
  source.nodes[zone.id] = {
    ...zone,
    floor: {
      elevation: 0.55,
      finish: 'library:preset-tomato',
      regions: [
        { id: 'region_patch', polygon: rect(0.3, 0.3, 1.3, 1.3), finish: 'library:preset-white' },
      ],
    },
  }
  const manual = SlabNode.parse({
    parentId: source.level.id,
    polygon: rect(0.7, 0.7, 1, 1),
    elevation: 0.55,
  })
  source.nodes[manual.id] = manual
  source.level.children.push(manual.id)
  const { group } = derivedScene(source.nodes)
  hitOnce(group, [0.87, 0.65, 0.83], [0, -1, 0], 'surface')
  hitOnce(group, [0.43, 0.65, 0.83], [0, -1, 0], `room:${zone.id}/region_patch`)
  hitOnce(group, [2.17, 0.65, 0.83], [0, -1, 0], `room:${zone.id}`)
})

test('a raised terrace keeps the base terrain skirt and never fills the platform to ground', () => {
  const level = LevelNode.parse({ id: 'level_terrain_terrace' })
  const polygon = rect(0, 0, 4, 4)
  const separators = polygon.map((start, i) =>
    SeparatorNode.parse({ parentId: level.id, start, end: polygon[(i + 1) % 4] }),
  )
  const zone = ZoneNode.parse({
    name: 'Terrace',
    parentId: level.id,
    spaceRole: 'room',
    polygon,
    floor: { elevation: 0.55 },
  })
  const base = SlabNode.parse({
    parentId: level.id,
    boundary: 'auto',
    zoneIds: [zone.id],
    polygon,
    elevation: 0.05,
    thickness: 0.05,
    fillToTerrain: true,
  })
  level.children = [...separators, zone, base].map((node) => node.id)
  const field = createTerrainField({ cols: 11, rows: 11, spacing: 1, origin: [-2, -2] })
  field.heights.fill(-150)
  const site = SiteNode.parse({ terrain: encodeTerrainField(field) })
  const building = BuildingNode.parse({ parentId: site.id, children: [level.id] })
  level.parentId = building.id
  site.children = [building.id]
  const { group, slabs } = derivedScene(
    Object.fromEntries(
      [site, building, level, zone, base, ...separators].map((node) => [node.id, node]),
    ),
  )
  expect(slabs.find((slab) => slab.plateRole === 'base')!.foundation?.type).toBe('solid')
  expect(slabs.find((slab) => slab.plateRole === 'platform')!.fillToTerrain).toBe(false)
  for (const y of [-1.49, -0.3, 0.025, 0.08, 0.3, 0.54])
    hitOnce(group, [4.1, y, 1.73], [-1, 0, 0], y < 0 ? 'foundation' : 'edge')
})

test('one doorway spanning two upper rooms has one full-width landing and separate lower-face steps', () => {
  const source = floorStepFixture()
  const low = { ...source.zones[0]!, polygon: rect(0, 0, 4, 2), floor: { elevation: 0.3 } }
  const high = ZoneNode.parse({
    ...low,
    id: 'zone_split_high',
    polygon: rect(0, 2, 4, 4),
    floor: { elevation: 0.6, finish: 'library:preset-tomato' },
  })
  const split = SeparatorNode.parse({
    id: 'separator_split_upper',
    parentId: source.level.id,
    start: [0, 2],
    end: [4, 2],
  })
  source.nodes[low.id] = low
  source.nodes[high.id] = high
  source.nodes[split.id] = split
  source.nodes[source.zones[1]!.id] = { ...source.zones[1]!, floor: { elevation: 0.05 } }
  source.nodes[source.door.id] = { ...source.door, width: 2 }
  source.nodes[source.divider.id] = { ...source.divider, children: [source.door.id] }
  source.level.children.push(high.id, split.id)
  const { group, nodes } = derivedScene(source.nodes)
  for (const z of [1.3, 1.7, 2.3, 2.7]) {
    const top = hitOnce(group, [4, 0.7, z], [0, -1, 0], `room:${high.id}`)
    expect(top.point.y).toBeCloseTo(0.6)
    const step = hitOnce(group, [4.2, 0.4, z], [-1, 0, 0], 'riser')
    expect(step.object.userData.ownerZoneId).toBe(high.id)
  }
  hitOnce(group, [3.8, 0.45, 1.6], [1, 0, 0], 'riser')
  expect(reconcileStructureOnLoad(nodes).changed).toBe(false)
})

test('raised exterior doorway has a wall upstand and sunken exterior doorway has one inside base step', () => {
  for (const elevation of [0.55, -0.4]) {
    const source = floorStepFixture()
    source.nodes[source.zones[0]!.id] = { ...source.zones[0]!, floor: { elevation } }
    source.nodes[source.zones[1]!.id] = { ...source.zones[1]!, floor: { elevation: 0.05 } }
    const wall = source.walls[0]!
    const door = { ...source.door, parentId: wall.id, wallId: wall.id }
    source.nodes[door.id] = door
    source.nodes[wall.id] = { ...wall, children: [door.id] }
    const { group } = derivedScene(source.nodes)
    if (elevation > 0.05)
      for (const y of [0.08, 0.3, 0.54]) hitOnce(group, [2.1, y, -0.2], [0, 0, 1], 'wall')
    else for (const y of [-0.39, -0.2, 0.04]) hitOnce(group, [2.1, y, 0.2], [0, 0, -1], 'riser')
  }
})

test('downturn has a closed bottom and back while the original soffit is removed above it', () => {
  const host = plate(rect(0, 0, 4, 4), 0.05)
  const lower = plate(rect(4, 0, 8, 4), -0.6)
  const group = build(host, context([host, lower]))
  group.updateMatrixWorld(true)
  const bottom = new Raycaster(
    new Vector3(3.98, -0.7, 1.73),
    new Vector3(0, 1, 0),
    0,
    0.8,
  ).intersectObject(group, true)
  expect(bottom).toHaveLength(1)
  expect(bottom[0]!.point.y).toBeCloseTo(-0.6)
  const back = new Raycaster(
    new Vector3(3.9, -0.3, 1.73),
    new Vector3(1, 0, 0),
    0,
    0.2,
  ).intersectObject(group, true)
  expect(back).toHaveLength(1)
  expect(back[0]!.point.x).toBeCloseTo(3.95)
})

test('curved interior doorway shares its arc aperture with the plate and has one lower-face riser', async () => {
  const { getWallCurveLength, getWallCurveFrameAt, getOpeningWallCut } = await import(
    '@pascal-app/core'
  )
  const source = floorStepFixture()
  const wall = { ...source.divider, curveOffset: 0.5, children: [source.door.id] }
  const door = {
    ...source.door,
    position: [getWallCurveLength(wall) / 2, 1, 0] as [number, number, number],
  }
  source.nodes[wall.id] = wall
  source.nodes[door.id] = door
  source.nodes[source.zones[0]!.id] = { ...source.zones[0]!, floor: { elevation: 0.55 } }
  source.nodes[source.zones[1]!.id] = { ...source.zones[1]!, floor: { elevation: 0.05 } }
  const { nodes, group } = authoredScene(source.nodes)
  expect(getOpeningWallCut(wall, door, nodes).covered).toBe(true)
  for (const t of [0.463, 0.513, 0.537]) {
    const { point, normal } = getWallCurveFrameAt(wall, t)
    for (const y of [0.08, 0.3, 0.53])
      hitOnce(
        group,
        [point.x - normal.x * 0.2, y, point.y - normal.y * 0.2],
        [normal.x, 0, normal.y],
        'riser',
      )
  }
})

test('a wall-anchored window exposes only its rectangular overlap with a raised platform', () => {
  const source = floorStepFixture()
  const window = WindowNode.parse({
    ...source.door,
    type: 'window',
    openingKind: 'window',
    id: 'window_sill',
    height: 0.4,
    position: [2, 0.35, 0],
  })
  source.nodes[source.zones[0]!.id] = { ...source.zones[0]!, floor: { elevation: 0.55 } }
  source.nodes[source.zones[1]!.id] = { ...source.zones[1]!, floor: { elevation: 0.05 } }
  source.nodes[window.id] = window
  source.nodes[source.divider.id] = { ...source.divider, children: [window.id] }
  const { group } = derivedScene(source.nodes)
  hitOnce(group, [4.2, 0.3, 1.83], [-1, 0, 0], 'riser', 0.4)
  hitOnce(group, [4.2, 0.1, 1.83], [-1, 0, 0], 'wall')
  hitOnce(group, [4.2, 0.3, 0.8], [-1, 0, 0], 'wall')
})

test('a T-junction trims the shared aperture and retains one wall face at the return', async () => {
  const { getOpeningWallCut, getWallPlanFootprint, intersection, area } = await import(
    '@pascal-app/core'
  )
  const source = floorStepFixture()
  const stub = WallNode.parse({
    id: 'wall_door_return',
    parentId: source.level.id,
    start: [2, 2],
    end: [4, 2],
    thickness: 0.2,
  })
  source.nodes[stub.id] = stub
  source.nodes[source.door.id] = { ...source.door, width: 1.5 }
  source.nodes[source.divider.id] = { ...source.divider, children: [source.door.id] }
  source.nodes[source.zones[0]!.id] = { ...source.zones[0]!, floor: { elevation: 0.55 } }
  source.nodes[source.zones[1]!.id] = { ...source.zones[1]!, floor: { elevation: 0.05 } }
  source.level.children.push(stub.id)
  const { nodes, group } = derivedScene(source.nodes)
  const walls = Object.values(nodes).filter((node): node is WallNode => node.type === 'wall')
  const cut = getOpeningWallCut(
    nodes[source.divider.id] as WallNode,
    nodes[source.door.id] as DoorNode,
    nodes,
  )
  const footprint = getWallPlanFootprint(stub, calculateLevelMiters(walls)).map(
    ({ x, y }): [number, number] => [x, y],
  )
  expect(area(intersection(cut.aperture, footprint))).toBeLessThan(1e-8)
  for (const z of [1.43, 1.73, 2.23, 2.63]) hitOnce(group, [4.2, 0.3, z], [-1, 0, 0], 'riser')
  hitOnce(group, [4.2, 0.3, 2.03], [-1, 0, 0], 'riser')
  hitOnce(group, [3.73, 0.8, 1.8], [0, 0, 1], 'wall')
})

test('an orphan stair hole is removed from its platform on load', () => {
  const source = floorStepFixture()
  source.nodes[source.zones[0]!.id] = { ...source.zones[0]!, floor: { elevation: 0.55 } }
  const first = derivedScene(source.nodes)
  const platform = first.slabs.find((slab) => slab.plateRole === 'platform')!
  const hole = rect(1, 1, 2, 2)
  const { slabs, group, nodes } = derivedScene({
    ...first.nodes,
    [platform.id]: {
      ...platform,
      holes: [...platform.holes, hole],
      holeMetadata: [...platform.holeMetadata, { source: 'stair', stairId: 'stair_hole' }],
    },
  })
  expect(reconcileStructureOnLoad(nodes).nodes).toEqual(nodes)
  expect(
    slabs.filter((slab) => slab.holes.some((ring) => pointInPolygon2D([1.37, 1.43], ring))),
  ).toHaveLength(0)
  const hit = new Raycaster(
    new Vector3(1.37, 0.7, 1.43),
    new Vector3(0, -1, 0),
    0,
    1,
  ).intersectObject(group, true)
  expect(hit).toHaveLength(1)
  expect(hit[0]!.point.y).toBeCloseTo(0.55)
})

test('a partial downturn closes its exposed end return', () => {
  const host = plate(rect(0, 0, 4, 4), 0.05)
  const lower = plate(rect(4, 0, 8, 2), -0.6)
  const group = build(host, context([host, lower]))
  group.updateMatrixWorld(true)
  const hits = new Raycaster(
    new Vector3(3.98, -0.3, 2.1),
    new Vector3(0, 0, -1),
    0,
    0.2,
  ).intersectObject(group, true)
  expect(hits).toHaveLength(1)
  expect(hits[0]!.point.z).toBeCloseTo(2)
})

test.each([0, 0.7])('raised house band has a foundation only at site datum %s', (baseElevation) => {
  const source = floorStepFixture()
  const first = reconcileStructureOnLoad(source.nodes).nodes
  const base = Object.values(first).find(
    (n): n is SlabNode => n.type === 'slab' && n.plateRole === 'base',
  )!
  const level = { ...source.level, baseElevation }
  const field = createTerrainField({ cols: 13, rows: 9, spacing: 1, origin: [-2, -2] })
  for (let z = 0; z < field.rows; z++)
    for (let x = 0; x < field.cols; x++) field.heights[z * field.cols + x] = -100 + x * 3
  const site = SiteNode.parse({ terrain: encodeTerrainField(field) })
  const building = BuildingNode.parse({ parentId: site.id, children: [level.id] })
  site.children = [building.id]
  level.parentId = building.id
  const outside = source.walls[0]!
  const door = { ...source.door, parentId: outside.id, wallId: outside.id }
  const { group, slabs } = derivedScene(
    {
      ...first,
      [site.id]: site,
      [building.id]: building,
      [level.id]: { ...level, children: (first[level.id] as LevelNode).children },
      [base.id]: {
        ...base,
        floorHeight: 0.55,
        thickness: 0.2,
        foundation: { type: 'solid', material: 'library:concrete-raw' },
      },
      [source.zones[0]!.id]: { ...source.zones[0]!, floor: { elevation: 0.85 } },
      [source.zones[1]!.id]: { ...source.zones[1]!, floor: { elevation: 0.55 } },
      [outside.id]: { ...outside, children: [door.id] },
      [door.id]: door,
    },
    0.55,
  )
  for (const x of [1.3, 2.1, 5.7]) {
    hitOnce(group, [x, 0.45, -0.2], [0, 0, 1], 'edge')
    hitOnce(group, [x, 0.34, -0.2], [0, 0, 1], baseElevation === 0 ? 'foundation' : 'edge')
    hitOnce(group, [x, 0.56, -0.2], [0, 0, 1], 'wall')
  }
  hitOnce(group, [2.1, 0.8, -0.2], [0, 0, 1], 'wall')
  const foundation = group.children
    .flatMap((g) => g.children)
    .find((m) => m.userData.slotId === 'foundation') as Mesh | undefined
  if (baseElevation !== 0) {
    expect(foundation).toBeUndefined()
    expect(slabs.find((plate) => plate.id === base.id)).toMatchObject({
      elevation: 0.55,
      thickness: 0.55,
      foundation: { type: 'none' },
    })
    return
  }
  expect(foundation).toBeDefined()
  if (!foundation) throw new Error('Missing foundation')
  expect(foundation.userData.paintRole).toBe('foundation')
  const faces = group.children
    .flatMap((g) => g.children)
    .filter(
      (mesh): mesh is Mesh =>
        mesh instanceof Mesh && ['foundation', 'edge'].includes(mesh.userData.slotId),
    )
  for (const mesh of faces) {
    const position = mesh.geometry.getAttribute('position')
    const normal = mesh.geometry.getAttribute('normal')
    const uv = mesh.geometry.getAttribute('uv')
    expect(Array.from(mesh.geometry.getAttribute('uv2').array)).toEqual(Array.from(uv.array))
    for (let i = 0; i < position.count; i += 3) {
      if (Math.abs(normal.getY(i)) > 1e-6) continue
      for (let j = i + 1; j < i + 3; j++) {
        const metres = Math.hypot(
          position.getX(j) - position.getX(i),
          position.getY(j) - position.getY(i),
          position.getZ(j) - position.getZ(i),
        )
        const texels = Math.hypot(uv.getX(j) - uv.getX(i), uv.getY(j) - uv.getY(i))
        expect(texels).toBeCloseTo(metres, 4)
      }
    }
  }

  const position = foundation.geometry.getAttribute('position')
  const bottoms = Array.from({ length: position.count }, (_, i) => position.getY(i)).filter(
    (y) => y < 0.34,
  )
  expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeGreaterThan(0.1)
  expect(slabs.find((p) => p.id === base.id)).not.toHaveProperty('fillToTerrain')
})
