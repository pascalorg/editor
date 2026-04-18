import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'

/**
 * 80 m² two-bedroom apartment.
 *
 * Footprint: 10 m × 8 m = 80 m², centered near the origin.
 * Contents: 9 walls (4 perimeter + 5 interior), 4 zones
 * (living/kitchen, bedroom1, bedroom2, bath), 4 doors (front + 3 interior),
 * 5 windows (2 on the living/kitchen, 1 per bedroom, 1 on the bath).
 * Interior partitions split the north half into two bedrooms and a bath.
 *
 * Coordinate system: `[x, z]` on the XZ plane, with `x` running east/west
 * and `z` running north/south (positive z points south).
 */

// Perimeter extents: 10 m × 8 m.
const X_MIN = -5
const X_MAX = 5
const Z_MIN = -4
const Z_MAX = 4

// Interior split lines.
const CORRIDOR_Z = 0 // horizontal wall separating north half (bedrooms+bath) from south (living)
const BED_X = -1 // vertical wall between bedroom 1 (west) and bath (east of it)
const BATH_X = 2 // vertical wall between bath (middle) and bedroom 2 (east)

const WALL_THICKNESS = 0.1
const WALL_HEIGHT = 2.5

type NodeMap = Record<string, AnyNode>

function wall(
  id: string,
  start: [number, number],
  end: [number, number],
  children: string[] = [],
): AnyNode {
  return {
    object: 'node',
    id,
    type: 'wall',
    parentId: 'level_0',
    visible: true,
    metadata: {},
    children,
    thickness: WALL_THICKNESS,
    height: WALL_HEIGHT,
    start,
    end,
    frontSide: 'unknown',
    backSide: 'unknown',
  } as unknown as AnyNode
}

function door(id: string, parentWallId: string): AnyNode {
  return {
    object: 'node',
    id,
    type: 'door',
    parentId: parentWallId,
    visible: true,
    metadata: {},
    wallId: parentWallId,
    position: [0, 1.05, 0],
    rotation: [0, 0, 0],
    width: 0.8,
    height: 2.1,
    frameThickness: 0.05,
    frameDepth: 0.07,
    threshold: true,
    thresholdHeight: 0.02,
    hingesSide: 'left',
    swingDirection: 'inward',
    segments: [
      {
        type: 'panel',
        heightRatio: 0.5,
        columnRatios: [1],
        dividerThickness: 0.03,
        panelDepth: 0.01,
        panelInset: 0.04,
      },
      {
        type: 'panel',
        heightRatio: 0.5,
        columnRatios: [1],
        dividerThickness: 0.03,
        panelDepth: 0.01,
        panelInset: 0.04,
      },
    ],
    handle: true,
    handleHeight: 1.05,
    handleSide: 'right',
    contentPadding: [0.04, 0.04],
    doorCloser: false,
    panicBar: false,
    panicBarHeight: 1.0,
  } as unknown as AnyNode
}

function makeWindow(id: string, parentWallId: string, width = 1.2): AnyNode {
  return {
    object: 'node',
    id,
    type: 'window',
    parentId: parentWallId,
    visible: true,
    metadata: {},
    wallId: parentWallId,
    position: [0, 1.2, 0],
    rotation: [0, 0, 0],
    width,
    height: 1.2,
    frameThickness: 0.05,
    frameDepth: 0.07,
    columnRatios: [1],
    rowRatios: [1],
    columnDividerThickness: 0.03,
    rowDividerThickness: 0.03,
    sill: true,
    sillDepth: 0.08,
    sillThickness: 0.03,
  } as unknown as AnyNode
}

function buildTemplate(): SceneGraph {
  const nodes: NodeMap = {}

  // Root nodes
  nodes.site_2br = {
    object: 'node',
    id: 'site_2br',
    type: 'site',
    parentId: null,
    visible: true,
    metadata: {},
    polygon: {
      type: 'polygon',
      points: [
        [-15, -15],
        [15, -15],
        [15, 15],
        [-15, 15],
      ],
    },
    children: ['building_2br'],
  } as unknown as AnyNode

  nodes.building_2br = {
    object: 'node',
    id: 'building_2br',
    type: 'building',
    parentId: 'site_2br',
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    children: ['level_0'],
  } as unknown as AnyNode

  // Openings — declared up front so walls can list them as children.
  nodes.door_front = door('door_front', 'wall_s')
  nodes.door_bed1 = door('door_bed1', 'wall_corr_1')
  nodes.door_bath = door('door_bath', 'wall_corr_2')
  nodes.door_bed2 = door('door_bed2', 'wall_corr_3')

  nodes.window_living_a = makeWindow('window_living_a', 'wall_s', 1.5)
  nodes.window_living_b = makeWindow('window_living_b', 'wall_e', 1.2)
  nodes.window_bed1 = makeWindow('window_bed1', 'wall_n', 1.2)
  nodes.window_bath = makeWindow('window_bath', 'wall_n', 0.6)
  nodes.window_bed2 = makeWindow('window_bed2', 'wall_n', 1.2)

  // Perimeter walls (N, E, S, W) — 4 walls.
  // Interior partitions — 5 walls (the east/west corridor wall is split into
  // three segments by the two vertical partitions so doors have a clear host).
  nodes.wall_n = wall(
    'wall_n',
    [X_MIN, Z_MIN],
    [X_MAX, Z_MIN],
    ['window_bed1', 'window_bath', 'window_bed2'],
  )
  nodes.wall_e = wall('wall_e', [X_MAX, Z_MIN], [X_MAX, Z_MAX], ['window_living_b'])
  nodes.wall_s = wall('wall_s', [X_MAX, Z_MAX], [X_MIN, Z_MAX], ['door_front', 'window_living_a'])
  nodes.wall_w = wall('wall_w', [X_MIN, Z_MAX], [X_MIN, Z_MIN])

  // Corridor wall is broken into 3 segments so each has its own interior door.
  // Segment 1: from west to BED_X (bedroom-1 wall)
  nodes.wall_corr_1 = wall('wall_corr_1', [X_MIN, CORRIDOR_Z], [BED_X, CORRIDOR_Z], ['door_bed1'])
  // Segment 2: from BED_X to BATH_X (bath wall)
  nodes.wall_corr_2 = wall('wall_corr_2', [BED_X, CORRIDOR_Z], [BATH_X, CORRIDOR_Z], ['door_bath'])
  // Segment 3: from BATH_X to east (bedroom-2 wall)
  nodes.wall_corr_3 = wall('wall_corr_3', [BATH_X, CORRIDOR_Z], [X_MAX, CORRIDOR_Z], ['door_bed2'])

  // Two vertical partitions between the three north rooms.
  nodes.wall_part_1 = wall('wall_part_1', [BED_X, Z_MIN], [BED_X, CORRIDOR_Z])
  nodes.wall_part_2 = wall('wall_part_2', [BATH_X, Z_MIN], [BATH_X, CORRIDOR_Z])

  // Zones: one per room.
  nodes.zone_living = {
    object: 'node',
    id: 'zone_living',
    type: 'zone',
    parentId: 'level_0',
    visible: true,
    metadata: {},
    name: 'Living / Kitchen',
    color: '#60a5fa',
    polygon: [
      [X_MIN, CORRIDOR_Z],
      [X_MAX, CORRIDOR_Z],
      [X_MAX, Z_MAX],
      [X_MIN, Z_MAX],
    ],
  } as unknown as AnyNode

  nodes.zone_bed1 = {
    object: 'node',
    id: 'zone_bed1',
    type: 'zone',
    parentId: 'level_0',
    visible: true,
    metadata: {},
    name: 'Bedroom 1',
    color: '#f472b6',
    polygon: [
      [X_MIN, Z_MIN],
      [BED_X, Z_MIN],
      [BED_X, CORRIDOR_Z],
      [X_MIN, CORRIDOR_Z],
    ],
  } as unknown as AnyNode

  nodes.zone_bath = {
    object: 'node',
    id: 'zone_bath',
    type: 'zone',
    parentId: 'level_0',
    visible: true,
    metadata: {},
    name: 'Bath',
    color: '#a7f3d0',
    polygon: [
      [BED_X, Z_MIN],
      [BATH_X, Z_MIN],
      [BATH_X, CORRIDOR_Z],
      [BED_X, CORRIDOR_Z],
    ],
  } as unknown as AnyNode

  nodes.zone_bed2 = {
    object: 'node',
    id: 'zone_bed2',
    type: 'zone',
    parentId: 'level_0',
    visible: true,
    metadata: {},
    name: 'Bedroom 2',
    color: '#fcd34d',
    polygon: [
      [BATH_X, Z_MIN],
      [X_MAX, Z_MIN],
      [X_MAX, CORRIDOR_Z],
      [BATH_X, CORRIDOR_Z],
    ],
  } as unknown as AnyNode

  nodes.level_0 = {
    object: 'node',
    id: 'level_0',
    type: 'level',
    parentId: 'building_2br',
    visible: true,
    metadata: {},
    level: 0,
    children: [
      'wall_n',
      'wall_e',
      'wall_s',
      'wall_w',
      'wall_corr_1',
      'wall_corr_2',
      'wall_corr_3',
      'wall_part_1',
      'wall_part_2',
      'zone_living',
      'zone_bed1',
      'zone_bath',
      'zone_bed2',
    ],
  } as unknown as AnyNode

  // SiteNode.children is a discriminatedUnion of BuildingNode/ItemNode objects
  // (not string ids) per the schema — embed the full building node here.
  ;(nodes.site_2br as unknown as { children: unknown[] }).children = [nodes.building_2br!]

  return {
    nodes: nodes as Record<AnyNodeId, AnyNode>,
    rootNodeIds: ['site_2br'] as AnyNodeId[],
  }
}

export const template: SceneGraph = buildTemplate()

export const metadata = {
  id: 'two-bedroom',
  name: 'Two-bedroom apartment',
  description:
    '80 m² two-bedroom flat: 9 walls, 4 zones (living/kitchen, 2 bedrooms, bath), 4 doors and 5 windows.',
} as const
