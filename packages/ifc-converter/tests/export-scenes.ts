import {
  type AnyNode,
  BuildingNode,
  ColumnNode,
  createZone,
  DoorNode,
  LevelNode,
  reconcileLevelStructure,
  SiteNode,
  type StructureNodes,
  structureChangeBatch,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import type { IfcMeshPart } from '../src/export'

type Nodes = Record<string, AnyNode>

function applyBatch(nodes: Nodes, batch: ReturnType<typeof structureChangeBatch>): Nodes {
  const next: Nodes = { ...nodes }
  for (const id of batch.delete) delete next[id]
  for (const { node, parentId } of batch.create) {
    next[node.id] = { ...node, parentId: parentId ?? node.parentId } as AnyNode
  }
  for (const { id, data } of batch.update) {
    if (next[id]) next[id] = { ...next[id], ...data } as AnyNode
  }
  return next
}

let counter = 0
const mintId = (kind: string) => `${kind}_x${++counter}`

/** An enclosed room through the real structure commands: walls, zone, floor plate, ceiling. */
export function addRoom(
  nodes: Nodes,
  levelId: string,
  polygon: [number, number][],
  name: string,
  roomNumber?: string,
): Nodes {
  const plan = createZone(nodes as StructureNodes, {
    levelId,
    polygon,
    enclose: true,
    mintId,
    name,
  })
  if (plan.conflicts) throw new Error(`createZone conflicts: ${JSON.stringify(plan.conflicts)}`)
  let next = applyBatch(nodes, structureChangeBatch(plan.changes))
  const derived = reconcileLevelStructure({
    levelId,
    nodes: next as StructureNodes,
    previousNodes: nodes as StructureNodes,
    mintId,
  })
  next = applyBatch(next, structureChangeBatch(derived.patches))
  if (roomNumber && plan.zoneId) {
    next[plan.zoneId] = { ...next[plan.zoneId]!, roomNumber } as AnyNode
  }
  return next
}

export function wallsOn(nodes: Nodes, levelId: string) {
  return Object.values(nodes).filter(
    (node) => node.type === 'wall' && node.parentId === levelId,
  ) as Extract<AnyNode, { type: 'wall' }>[]
}

/** 5 x 4 m room, 2.8 m storey, a door and a window in the wall along +x. */
export function roomWithOpenings(): Nodes {
  const level = LevelNode.parse({ id: 'level_ground', name: 'Ground floor', height: 2.8 })
  let nodes = addRoom(
    { [level.id]: level },
    level.id,
    [
      [0, 0],
      [5, 0],
      [5, 4],
      [0, 4],
    ],
    'Living room',
    'R01',
  )
  const host = wallsOn(nodes, level.id).find((wall) => wall.start[1] === 0 && wall.end[1] === 0)!
  const door = DoorNode.parse({
    id: 'door_front',
    name: 'Front door',
    parentId: host.id,
    wallId: host.id,
    position: [1.5, 1.05, 0],
    width: 0.9,
    height: 2.1,
    doorType: 'hinged',
    hingesSide: 'right',
  })
  const window = WindowNode.parse({
    id: 'window_south',
    name: 'South window',
    parentId: host.id,
    wallId: host.id,
    position: [3.5, 1.5, 0],
    width: 1.2,
    height: 1.2,
  })
  nodes = { ...nodes, [door.id]: door, [window.id]: window }
  return nodes
}

/** Two stacked storeys (2.8 m and 3.1 m), each an enclosed room with plate and ceiling. */
export function twoLevelScene(): Nodes {
  const ground = LevelNode.parse({ id: 'level_l0', name: 'Ground', level: 0, height: 2.8 })
  const upper = LevelNode.parse({ id: 'level_l1', name: 'Upper', level: 1, height: 3.1 })
  let nodes: Nodes = { [ground.id]: ground, [upper.id]: upper }
  nodes = addRoom(
    nodes,
    ground.id,
    [
      [0, 0],
      [6, 0],
      [6, 5],
      [0, 5],
    ],
    'Kitchen',
  )
  nodes = addRoom(
    nodes,
    upper.id,
    [
      [0, 0],
      [6, 0],
      [6, 5],
      [0, 5],
    ],
    'Bedroom',
    'B1',
  )
  return nodes
}

export function columnScene(): Nodes {
  const level = LevelNode.parse({ id: 'level_col', name: 'Columns', height: 3 })
  const plain = {
    style: 'plain',
    baseStyle: 'none',
    capitalStyle: 'none',
    shaftProfile: 'straight',
    baseHeight: 0,
    capitalHeight: 0,
  } as const
  const square = ColumnNode.parse({
    id: 'column_rect',
    name: 'Rect column',
    parentId: level.id,
    position: [2, 0, 1],
    crossSection: 'rectangular',
    width: 0.3,
    depth: 0.5,
    height: 2.7,
    ...plain,
  })
  const round = ColumnNode.parse({
    id: 'column_round',
    name: 'Round column',
    parentId: level.id,
    position: [-1.5, 0, 3],
    crossSection: 'round',
    radius: 0.2,
    height: 3,
    ...plain,
  })
  return {
    [level.id]: { ...level, children: [square.id, round.id] } as AnyNode,
    [square.id]: square,
    [round.id]: round,
  }
}

/** Axis-aligned box as a mesh part, in world coordinates. */
export function box(min: [number, number, number], max: [number, number, number]): IfcMeshPart {
  const [x0, y0, z0] = min
  const [x1, y1, z1] = max
  const positions = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ].flat()
  const indices = [
    [0, 2, 1, 0, 3, 2],
    [4, 5, 6, 4, 6, 7],
    [0, 1, 5, 0, 5, 4],
    [2, 3, 7, 2, 7, 6],
    [1, 2, 6, 1, 6, 5],
    [0, 4, 7, 0, 7, 3],
  ].flat()
  return { positions, indices, color: [0.8, 0.4, 0.2], opacity: 1 }
}

export const node = (fields: Record<string, unknown>) =>
  ({ object: 'node', visible: true, metadata: {}, children: [], ...fields }) as unknown as AnyNode

/**
 * A rotated, offset building with straight and curved walls, rooms grouped in
 * a unit, and mesh-only kinds (item, fence, roof, stair) with world-space boxes.
 */
export function groupedElementsScene() {
  const site = SiteNode.parse({ id: 'site_main' })
  const building = BuildingNode.parse({
    id: 'building_main',
    parentId: site.id,
    position: [10, 0, 5],
    rotation: [0, Math.PI / 2, 0],
  })
  const ground = LevelNode.parse({ id: 'level_g', parentId: building.id, level: 0, height: 3 })
  const upper = LevelNode.parse({ id: 'level_u', parentId: building.id, level: 1, height: 3 })
  const wall = WallNode.parse({
    id: 'wall_straight',
    parentId: ground.id,
    start: [1, 0],
    end: [4, 0],
    thickness: 0.2,
    height: 2.5,
  })
  const curved = WallNode.parse({
    id: 'wall_curved',
    parentId: upper.id,
    start: [0, 0],
    end: [4, 0],
    curveOffset: 0.8,
    thickness: 0.15,
    height: 2.4,
  })
  const nodes: Record<string, AnyNode> = {
    [site.id]: { ...site, children: [building.id] } as AnyNode,
    [building.id]: { ...building, children: [ground.id, upper.id] } as AnyNode,
    [ground.id]: ground,
    [upper.id]: upper,
    [wall.id]: wall,
    [curved.id]: curved,
    item_sofa: node({ id: 'item_sofa', type: 'item', name: 'Sofa', parentId: upper.id }),
    item_hidden: node({ id: 'item_hidden', type: 'item', parentId: upper.id, visible: false }),
    item_bare: node({ id: 'item_bare', type: 'item', name: 'No mesh', parentId: ground.id }),
    fence_1: node({ id: 'fence_1', type: 'fence', parentId: ground.id }),
    roof_1: node({ id: 'roof_1', type: 'roof', name: 'Roof', parentId: upper.id }),
    'roof-segment_1': node({ id: 'roof-segment_1', type: 'roof-segment', parentId: 'roof_1' }),
    'roof-segment_2': node({ id: 'roof-segment_2', type: 'roof-segment', parentId: 'roof_1' }),
    stair_1: node({ id: 'stair_1', type: 'stair', name: 'Stair', parentId: ground.id }),
    'stair-segment_1': node({ id: 'stair-segment_1', type: 'stair-segment', parentId: 'stair_1' }),
    zone_a: node({
      id: 'zone_a',
      type: 'zone',
      name: 'Flat A kitchen',
      parentId: ground.id,
      polygon: [
        [0, 0],
        [3, 0],
        [3, 3],
        [0, 3],
      ],
      spaceRole: 'room',
      ceilingHeight: 2.6,
    }),
    zone_b: node({
      id: 'zone_b',
      type: 'zone',
      name: 'Flat A bath',
      parentId: ground.id,
      polygon: [
        [3, 0],
        [5, 0],
        [5, 3],
        [3, 3],
      ],
      spaceRole: 'room',
      ceilingHeight: 2.4,
    }),
    unit_a: node({
      id: 'unit_a',
      type: 'unit',
      name: 'Flat A',
      kind: 'apartment',
      members: ['zone_a', 'zone_b'],
    }),
    tree_oak: node({ id: 'tree_oak', type: 'trees:tree', name: 'Oak', parentId: ground.id }),
    spawn_1: node({ id: 'spawn_1', type: 'spawn', parentId: ground.id }),
    // Legacy migration keeps a zero-thickness manual slab's degenerate interval.
    slab_flat: node({
      id: 'slab_flat',
      type: 'slab',
      name: 'Flat slab',
      parentId: ground.id,
      polygon: [
        [0, 0],
        [2, 0],
        [2, 2],
      ],
      elevation: 0,
      thickness: 0,
    }),
    slab_flat_bare: node({
      id: 'slab_flat_bare',
      type: 'slab',
      parentId: ground.id,
      polygon: [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
      elevation: 0,
      thickness: 0,
    }),
    slab_pool: node({
      id: 'slab_pool',
      type: 'slab',
      name: 'Pool',
      parentId: ground.id,
      polygon: [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
      elevation: -1.2,
      thickness: 0.2,
      recessed: true,
    }),
  }
  // World coordinates: the sofa sits on the upper storey (world y 3).
  const meshes = new Map<string, IfcMeshPart[]>([
    ['item_sofa', [box([12, 3, 6], [14, 3.8, 7])]],
    ['item_hidden', [box([0, 3, 0], [1, 4, 1])]],
    ['fence_1', [box([0, 0, -2], [4, 1, -1.9])]],
    ['roof-segment_1', [box([10, 6, 5], [14, 6.2, 8])]],
    ['roof-segment_2', [box([10, 6, 8], [14, 6.2, 11])]],
    ['stair-segment_1', [box([11, 0, 6], [12, 3, 9])]],
    ['tree_oak', [box([9, 0, 2], [10, 6, 3])]],
    ['slab_flat', [box([10, 0, 3], [12, 0.001, 5])]],
    ['slab_pool', [box([10, -1.2, 3], [12, 0, 5])]],
  ])
  return { nodes, meshes, wall, curved }
}
