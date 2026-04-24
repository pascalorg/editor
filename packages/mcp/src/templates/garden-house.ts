import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'

/**
 * "Garden house" — a simplified take on the Casa del Sol layout used in the
 * MCP research fixtures.
 *
 * Footprint: 12 m × 8 m house centered at the origin, with a 12 m × 6 m
 * back garden zone immediately to the north of the house, surrounded by a
 * privacy fence on three sides.
 *
 * Contents:
 *   - 4 perimeter walls around the house
 *   - 1 front door (south wall), 1 large garden door (north wall)
 *   - 2 windows on the south wall, 1 window on each of east and west
 *   - 1 indoor "living" zone, 1 outdoor "garden" zone
 *   - 3 fence segments bounding the north/east/west of the garden
 */

const HOUSE_W = 6 // half-width of the house (12 m total)
const HOUSE_D = 4 // half-depth of the house (8 m total)
const GARDEN_DEPTH = 6 // depth of the back-garden zone along +z direction

const WALL_THICKNESS = 0.15
const WALL_HEIGHT = 2.7

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

function door(id: string, parentWallId: string, width = 0.9): AnyNode {
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
    width,
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

function fence(id: string, start: [number, number], end: [number, number]): AnyNode {
  return {
    object: 'node',
    id,
    type: 'fence',
    parentId: 'level_0',
    visible: true,
    metadata: {},
    start,
    end,
    height: 1.8,
    thickness: 0.08,
    baseHeight: 0.22,
    postSpacing: 2,
    postSize: 0.1,
    topRailHeight: 0.04,
    groundClearance: 0,
    edgeInset: 0.015,
    baseStyle: 'grounded',
    color: '#f3f4f6',
    style: 'privacy',
  } as unknown as AnyNode
}

function buildTemplate(): SceneGraph {
  const nodes: NodeMap = {}

  nodes.site_garden = {
    object: 'node',
    id: 'site_garden',
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
    children: ['building_garden'],
  } as unknown as AnyNode

  nodes.building_garden = {
    object: 'node',
    id: 'building_garden',
    type: 'building',
    parentId: 'site_garden',
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    children: ['level_0'],
  } as unknown as AnyNode

  // Openings
  nodes.door_front = door('door_front', 'wall_s', 1.0)
  nodes.door_garden = door('door_garden', 'wall_n', 1.6)
  nodes.window_s1 = makeWindow('window_s1', 'wall_s', 1.2)
  nodes.window_s2 = makeWindow('window_s2', 'wall_s', 1.2)
  nodes.window_e = makeWindow('window_e', 'wall_e', 1.0)
  nodes.window_w = makeWindow('window_w', 'wall_w', 1.0)

  // House perimeter (south is front, north opens to the garden)
  nodes.wall_n = wall('wall_n', [-HOUSE_W, -HOUSE_D], [HOUSE_W, -HOUSE_D], ['door_garden'])
  nodes.wall_e = wall('wall_e', [HOUSE_W, -HOUSE_D], [HOUSE_W, HOUSE_D], ['window_e'])
  nodes.wall_s = wall(
    'wall_s',
    [HOUSE_W, HOUSE_D],
    [-HOUSE_W, HOUSE_D],
    ['door_front', 'window_s1', 'window_s2'],
  )
  nodes.wall_w = wall('wall_w', [-HOUSE_W, HOUSE_D], [-HOUSE_W, -HOUSE_D], ['window_w'])

  // Zones
  nodes.zone_living = {
    object: 'node',
    id: 'zone_living',
    type: 'zone',
    parentId: 'level_0',
    visible: true,
    metadata: {},
    name: 'Living',
    color: '#60a5fa',
    polygon: [
      [-HOUSE_W, -HOUSE_D],
      [HOUSE_W, -HOUSE_D],
      [HOUSE_W, HOUSE_D],
      [-HOUSE_W, HOUSE_D],
    ],
  } as unknown as AnyNode

  nodes.zone_garden = {
    object: 'node',
    id: 'zone_garden',
    type: 'zone',
    parentId: 'level_0',
    visible: true,
    metadata: {},
    name: 'Back garden',
    color: '#86efac',
    polygon: [
      [-HOUSE_W, -HOUSE_D - GARDEN_DEPTH],
      [HOUSE_W, -HOUSE_D - GARDEN_DEPTH],
      [HOUSE_W, -HOUSE_D],
      [-HOUSE_W, -HOUSE_D],
    ],
  } as unknown as AnyNode

  // Privacy fence along 3 sides of the garden.
  nodes.fence_n = fence(
    'fence_n',
    [-HOUSE_W, -HOUSE_D - GARDEN_DEPTH],
    [HOUSE_W, -HOUSE_D - GARDEN_DEPTH],
  )
  nodes.fence_e = fence('fence_e', [HOUSE_W, -HOUSE_D - GARDEN_DEPTH], [HOUSE_W, -HOUSE_D])
  nodes.fence_w = fence('fence_w', [-HOUSE_W, -HOUSE_D], [-HOUSE_W, -HOUSE_D - GARDEN_DEPTH])

  nodes.level_0 = {
    object: 'node',
    id: 'level_0',
    type: 'level',
    parentId: 'building_garden',
    visible: true,
    metadata: {},
    level: 0,
    children: [
      'wall_n',
      'wall_e',
      'wall_s',
      'wall_w',
      'zone_living',
      'zone_garden',
      'fence_n',
      'fence_e',
      'fence_w',
    ],
  } as unknown as AnyNode

  // SiteNode.children is a discriminatedUnion of BuildingNode/ItemNode objects
  // (not string ids) per the schema — embed the full building node here.
  ;(nodes.site_garden as unknown as { children: unknown[] }).children = [nodes.building_garden!]

  return {
    nodes: nodes as Record<AnyNodeId, AnyNode>,
    rootNodeIds: ['site_garden'] as AnyNodeId[],
  }
}

export const template: SceneGraph = buildTemplate()

export const metadata = {
  id: 'garden-house',
  name: 'Garden house',
  description:
    '12 × 8 m single-level house with a fenced back-garden zone; 4 walls, 2 doors, 4 windows, 3 privacy fences.',
} as const
