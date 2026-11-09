import type { z } from 'zod'
import {
  type AnyNode,
  BuildingNode,
  CeilingNode,
  DoorNode,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  SlabNode,
  WallNode,
  ZoneNode,
} from '../../schema'

/**
 * Buildings under a roof, for the Enclosure family: where the roof sits against the wall tops.
 * Built from the geometry alone (levels, explicit wall heights, a roof's pitch and seat), so a
 * scene can be broken by one number. Plan axes: x east, z south; a wall drawn clockwise has its
 * interior on the front side.
 */

export type EnclosureScene = { nodes: Record<string, AnyNode>; rootNodeIds: string[] }

export function graph(...nodes: AnyNode[]): EnclosureScene {
  const byId = Object.fromEntries(nodes.map((node) => [node.id, { ...node }])) as Record<
    string,
    AnyNode & { children?: string[] }
  >
  for (const node of Object.values(byId)) {
    const parent = node.parentId ? byId[node.parentId] : undefined
    if (parent && Array.isArray(parent.children) && !parent.children.includes(node.id))
      parent.children = [...parent.children, node.id]
  }
  return {
    nodes: byId,
    rootNodeIds: nodes.filter((node) => node.type === 'building').map((node) => node.id),
  }
}

type Pt = [number, number]

/** What a maker declares about a wall that meets a roof. */
export type Declaration = { roofJunction?: 'parapet'; cap?: boolean }
type Declarations = Declaration | (Declaration | undefined)[] | undefined

/** The four walls of a rectangle, drawn clockwise so the room is on their front side. */
export function rectangleWalls(
  levelId: string,
  [x0, z0, x1, z1]: [number, number, number, number],
  heights: [number?, number?, number?, number?] | number | undefined,
  sides: 'exterior' | 'interior' = 'exterior',
  tag = 'wall',
  declare?: Declarations,
): WallNode[] {
  const corners: Pt[] = [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ]
  return corners.map((start, index) => {
    const end = corners[(index + 1) % 4]!
    const height = Array.isArray(heights) ? heights[index] : heights
    return WallNode.parse({
      id: `${tag}_${index}`,
      parentId: levelId,
      start,
      end,
      ...(height === undefined ? {} : { height }),
      ...(Array.isArray(declare) ? declare[index] : declare),
      frontSide: 'interior',
      backSide: sides,
    })
  })
}

export const building = () => BuildingNode.parse({ id: 'building_main' })
export const storey = (height: number) =>
  LevelNode.parse({
    id: 'level_0',
    parentId: 'building_main',
    level: 0,
    name: 'Ground',
    height,
  })
