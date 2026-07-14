import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import {
  BuildingNode,
  DoorNode,
  FenceNode,
  LevelNode,
  SiteNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '@pascal-app/core/schema'

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
  return WallNode.parse({
    id,
    parentId: 'level_0',
    children,
    thickness: WALL_THICKNESS,
    height: WALL_HEIGHT,
    start,
    end,
    frontSide: 'unknown',
    backSide: 'unknown',
  })
}

function door(id: string, parentWallId: string, width = 0.9): AnyNode {
  return DoorNode.parse({
    id,
    parentId: parentWallId,
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
  })
}

function makeWindow(id: string, parentWallId: string, width = 1.2): AnyNode {
  return WindowNode.parse({
    id,
    parentId: parentWallId,
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
  })
}

function fence(id: string, start: [number, number], end: [number, number]): AnyNode {
  return FenceNode.parse({
    id,
    parentId: 'level_0',
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
  })
}

function buildTemplate(): SceneGraph {
  const nodes: NodeMap = {}

  nodes.site_garden = SiteNode.parse({
    id: 'site_garden',
    parentId: null,
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
  })

  nodes.building_garden = BuildingNode.parse({
    id: 'building_garden',
    parentId: 'site_garden',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    children: ['level_0'],
  })

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
  nodes.zone_living = ZoneNode.parse({
    id: 'zone_living',
    parentId: 'level_0',
    name: 'Living',
    color: '#60a5fa',
    polygon: [
      [-HOUSE_W, -HOUSE_D],
      [HOUSE_W, -HOUSE_D],
      [HOUSE_W, HOUSE_D],
      [-HOUSE_W, HOUSE_D],
    ],
  })

  nodes.zone_garden = ZoneNode.parse({
    id: 'zone_garden',
    parentId: 'level_0',
    name: 'Back garden',
    color: '#86efac',
    polygon: [
      [-HOUSE_W, -HOUSE_D - GARDEN_DEPTH],
      [HOUSE_W, -HOUSE_D - GARDEN_DEPTH],
      [HOUSE_W, -HOUSE_D],
      [-HOUSE_W, -HOUSE_D],
    ],
  })

  // Privacy fence along 3 sides of the garden.
  nodes.fence_n = fence(
    'fence_n',
    [-HOUSE_W, -HOUSE_D - GARDEN_DEPTH],
    [HOUSE_W, -HOUSE_D - GARDEN_DEPTH],
  )
  nodes.fence_e = fence('fence_e', [HOUSE_W, -HOUSE_D - GARDEN_DEPTH], [HOUSE_W, -HOUSE_D])
  nodes.fence_w = fence('fence_w', [-HOUSE_W, -HOUSE_D], [-HOUSE_W, -HOUSE_D - GARDEN_DEPTH])

  nodes.level_0 = LevelNode.parse({
    id: 'level_0',
    parentId: 'building_garden',
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
  })

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
