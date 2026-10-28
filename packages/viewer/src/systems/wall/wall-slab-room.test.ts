// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { afterEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  buildWallFinishLayout,
  calculateLevelMiters,
  DoorNode,
  doorSillFloorOf,
  foundationRimBottoms,
  foundationRimSteps,
  foundationSharedStemTops,
  LevelNode,
  reconcileSceneStructure,
  SiteNode,
  sceneRegistry,
  slabRoomElevation,
  WALL_SURFACE_SLOT_DEFAULTS,
  WallNode,
  wallSupportForNodes,
  type ZoneNode,
} from '@pascal-app/core'
import { buildBuildingFoundationChanges } from '@pascal-app/core/building'
import * as THREE from 'three'
import { getWallFinishRefs } from './wall-finish-data'
import { generateExtrudedWall } from './wall-system'

type Nodes = Record<AnyNodeId, AnyNode>

let counter = 0
const mintId = (kind: string) => `${kind}_t${counter++}`

function apply(nodes: Nodes, update: Array<{ id: string; data: unknown }>): Nodes {
  const next = { ...nodes }
  for (const { id, data } of update)
    next[id as AnyNodeId] = { ...next[id as AnyNodeId], ...(data as object) } as AnyNode
  return next
}

const reconcile = (nodes: Nodes) => reconcileSceneStructure({ nodes, mintId }).nodes as Nodes

/**
 * A raised house 10 × 8 m and a garage 6 × 6 m off its east side, drawn as the wall tool leaves
 * them (the house's east wall split where the garage's north wall tees into it), its rooms and
 * plates reconciled; the house seated on its raised floor, the east room made a garage on its slab,
 * an overhead door in the garage's east wall on its slab and a door into the house through the
 * wall they share.
 */
function raisedHouseWithGarage(): Nodes {
  const wall = (id: string, start: [number, number], end: [number, number]) =>
    WallNode.parse({ id, parentId: 'level_g', start, end, thickness: 0.15 })
  const walls = [
    wall('wall_s', [0, 0], [10, 0]),
    wall('wall_gs', [10, 0], [16, 0]),
    wall('wall_ge', [16, 0], [16, 6]),
    wall('wall_gn', [16, 6], [10, 6]),
    wall('wall_e', [10, 6], [10, 8]),
    wall('wall_n', [10, 8], [0, 8]),
    wall('wall_w', [0, 8], [0, 0]),
    wall('wall_shared', [10, 0], [10, 6]),
  ]
  let nodes = Object.fromEntries(
    [
      SiteNode.parse({ id: 'site_a', children: ['building_a'] }),
      BuildingNode.parse({
        id: 'building_a',
        parentId: 'site_a',
        children: ['level_g'],
        metadata: { foundation: { enabled: true, type: 'raised' } },
      }),
      LevelNode.parse({ id: 'level_g', parentId: 'building_a', level: 0, children: [] }),
      ...walls,
    ].map((node) => [node.id, node]),
  ) as Nodes
  nodes['level_g' as AnyNodeId] = {
    ...nodes['level_g' as AnyNodeId],
    children: walls.map((w) => w.id),
  } as AnyNode
  nodes = reconcile(nodes)
  nodes = apply(
    nodes,
    buildBuildingFoundationChanges({ nodes, buildingId: 'building_a', patch: {} })!.update,
  )
  const garage = Object.values(nodes).find(
    (node): node is ZoneNode => node.type === 'zone' && node.polygon.some(([x]) => x > 12),
  )!
  nodes = apply(nodes, [
    {
      id: garage.id,
      data: {
        name: 'Garage',
        floor: { foundation: 'slab', elevation: slabRoomElevation(nodes, garage)! },
      },
    },
  ])
  nodes = reconcile(nodes)
  const door = (id: string, wallId: string, along: number, width: number, height: number) =>
    DoorNode.parse({
      id,
      parentId: wallId,
      wallId,
      width,
      height,
      position: [
        along,
        doorSillFloorOf(nodes, { id: wallId, parentId: 'level_g' }) + height / 2,
        0,
      ],
    })
  const doors = [
    door('door_overhead', 'wall_ge', 3, 2.7, 2.4),
    door('door_house', 'wall_shared', 3, 0.9, 2.1),
  ]
  for (const d of doors) {
    nodes[d.id as AnyNodeId] = d
    const host = nodes[d.parentId as AnyNodeId] as WallNode
    nodes[host.id as AnyNodeId] = { ...host, children: [...host.children, d.id] } as AnyNode
  }
  return nodes
}

/** The wall's geometry as the wall system builds it in the scene: on its support, its rim as the foundation gives it. */
function built(nodes: Nodes, wallId: string) {
  const wall = nodes[wallId as AnyNodeId] as WallNode
  const support = wallSupportForNodes(wall, nodes)
  const rimBottom = foundationRimBottoms(nodes).get(wallId)
  const drawn =
    rimBottom === undefined
      ? wall
      : { ...wall, underpinning: { rim: support.elevation - rimBottom, stem: 0 } }
  sceneRegistry.nodes.set(wall.id, new THREE.Mesh())
  const levelWalls = Object.values(nodes).filter(
    (node): node is WallNode => node.type === 'wall' && node.parentId === 'level_g',
  )
  const children = wall.children.map((id) => nodes[id as AnyNodeId]!)
  const geometry = generateExtrudedWall(
    drawn,
    children,
    calculateLevelMiters(levelWalls),
    support.elevation,
    support.baseElevation,
    support.baseSegments,
    undefined,
    undefined,
    support.faceDatum,
    buildWallFinishLayout(wall, []),
    nodes,
  )
  return { geometry, support, wall }
}

afterEach(() => {
  for (const id of ['wall_ge', 'wall_shared']) sceneRegistry.nodes.delete(id)
})

/** Whether a ray straight through the wall (across its thickness) at (x, y) hits the wall. */
function solidAt(geometry: THREE.BufferGeometry, x: number, y: number): boolean {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
  const ray = new THREE.Raycaster(new THREE.Vector3(x, y, 5), new THREE.Vector3(0, 0, -1))
  return ray.intersectObject(mesh).length > 0
}

/**
 * The material index and centroid of every triangle on the wall's two faces (half its thickness
 * out), away from its ends, where it joins its neighbours.
 */
function faceTriangles(geometry: THREE.BufferGeometry, length = 6, thickness = 0.15) {
  const position = geometry.getAttribute('position')
  const vertex = (at: number) => geometry.index?.getX(at) ?? at
  const out: Array<{ x: number; y: number; z: number; material: number }> = []
  const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  for (const group of geometry.groups)
    for (let at = group.start; at < group.start + group.count; at += 3) {
      a.fromBufferAttribute(position, vertex(at))
      b.fromBufferAttribute(position, vertex(at + 1))
      c.fromBufferAttribute(position, vertex(at + 2))
      const normal = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a))
      if (normal.lengthSq() < 1e-12 || Math.abs(normal.normalize().y) > 0.1) continue
      const z = (a.z + b.z + c.z) / 3
      const x = (a.x + b.x + c.x) / 3
      if (Math.abs(Math.abs(z) - thickness / 2) > 2e-3 || x < 0.3 || x > length - 0.3) continue
      out.push({
        x,
        y: (a.y + b.y + c.y) / 3,
        z,
        material: group.materialIndex!,
      })
    }
  return out
}

const foundationIndex = (geometry: THREE.BufferGeometry) =>
  3 + getWallFinishRefs(geometry).indexOf(WALL_SURFACE_SLOT_DEFAULTS.foundation)

test('a garage’s overhead door opens through its wall down to the slab; beside it the siding stops on the curb', () => {
  const nodes = raisedHouseWithGarage()
  const garage = Object.values(nodes).find(
    (node): node is ZoneNode => node.type === 'zone' && node.name === 'Garage',
  )!
  const { geometry, support } = built(nodes, 'wall_ge')
  const base = support.elevation
  const slab = garage.floor!.elevation! - base
  const curb = foundationRimSteps(nodes).get('wall_ge')![0]!.bottom - base
  expect(slab).toBeLessThan(curb)
  expect(curb).toBeLessThan(0)
  // Through the doorway: open from a hair over the slab, past the curb's top and the rim, up.
  for (const y of [slab + 0.02, (slab + curb) / 2, curb + 0.02, -0.05, 0.5])
    expect(solidAt(geometry, 3, y)).toBe(false)
  // Beside it the wall's siding runs down over the floor framing to the curb's top.
  expect(solidAt(geometry, 3 - 1.35 - 0.3, curb + 0.02)).toBe(true)
  expect(solidAt(geometry, 3 + 1.35 + 0.3, -0.05)).toBe(true)
  // Inside, the curb's 8 in under the wall is its concrete, the wall's finish over it.
  const foundation = foundationIndex(geometry)
  const faces = faceTriangles(geometry).filter((face) => Math.abs(face.x - 3) > 1.5)
  const under = faces.filter((face) => face.y < curb - 0.01)
  expect(under.length).toBeGreaterThan(0)
  for (const face of under) expect(face.material).toBe(foundation)
  const over = faces.filter((face) => face.y > curb + 0.01 && face.y < 0.5)
  expect(over.length).toBeGreaterThan(0)
  for (const face of over) expect(face.material).not.toBe(foundation)
  geometry.dispose()
})

test('the wall a garage shares with a raised house bares the house’s stem on the garage side, up to the sill line', () => {
  const nodes = raisedHouseWithGarage()
  const stemTop = foundationSharedStemTops(nodes).get('wall_shared')
  expect(stemTop).toBeDefined()
  // An outside wall carries its finish down to the stem instead.
  expect(foundationSharedStemTops(nodes).has('wall_ge')).toBe(false)
  expect(foundationRimBottoms(nodes).has('wall_shared')).toBe(false)
  const { geometry, support } = built(nodes, 'wall_shared')
  const top = stemTop! - support.elevation
  expect(top).toBeLessThan(0)
  const foundation = foundationIndex(geometry)
  expect(foundation).toBeGreaterThanOrEqual(3)
  const faces = faceTriangles(geometry)
  // Under the sill line, down to the garage's slab: the stem's concrete, nothing else.
  const under = faces.filter((face) => face.y < top - 0.01)
  expect(under.length).toBeGreaterThan(0)
  for (const face of under) expect(face.material).toBe(foundation)
  // Over it, the wall's own finish.
  const over = faces.filter((face) => face.y > top + 0.01)
  expect(over.length).toBeGreaterThan(0)
  for (const face of over) expect(face.material).not.toBe(foundation)
  // Its door into the house opens from the house's floor: the stem stands whole under it.
  expect(solidAt(geometry, 3, top - 0.05)).toBe(true)
  expect(solidAt(geometry, 3, 0.5)).toBe(false)
  geometry.dispose()
})
