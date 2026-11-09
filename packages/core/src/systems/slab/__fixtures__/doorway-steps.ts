import {
  type AnyNode,
  DoorNode,
  LevelNode,
  SeparatorNode,
  WallNode,
  ZoneNode,
} from '../../../schema'
import { reconcileStructureWithStableIds } from '../../../utils/structure-id'

/**
 * Three rooms in a row, A | B | C, a door in each dividing wall. B is raised,
 * so it owns a step at each door: one toward A, one toward C. `open` divides B
 * from C with a separator instead of a wall and door.
 */
export function doorwayStepsFixture(
  elevations: [number, number, number] = [0.05, 0.3, 0.05],
  open = false,
) {
  const ring = (x0: number, x1: number): [number, number][] => [
    [x0, 0],
    [x1, 0],
    [x1, 4],
    [x0, 4],
  ]
  const outline = ring(0, 12)
  const walls = outline.map((start, i) =>
    WallNode.parse({
      id: `wall_row_${i}`,
      parentId: 'level_row',
      start,
      end: outline[(i + 1) % 4],
      thickness: 0.2,
    }),
  )
  const doors = (['ab', 'bc'] as const).map((pair) =>
    DoorNode.parse({
      id: `door_${pair}`,
      parentId: `wall_row_${pair}`,
      wallId: `wall_row_${pair}`,
      width: 1,
      height: 2,
      position: [2, 1, 0],
    }),
  )
  const dividers = ([4, 8] as const).map((x, i) =>
    WallNode.parse({
      id: `wall_row_${i ? 'bc' : 'ab'}`,
      parentId: 'level_row',
      start: [x, 0],
      end: [x, 4],
      thickness: 0.2,
      children: [doors[i]!.id],
    }),
  )
  const zones = (['a', 'b', 'c'] as const).map((name, i) =>
    ZoneNode.parse({
      id: `zone_${name}`,
      parentId: 'level_row',
      name: name.toUpperCase(),
      spaceRole: 'room',
      enclosureStatus: 'enclosed',
      polygon: ring(i * 4, (i + 1) * 4),
      floor: { elevation: elevations[i] },
    }),
  )
  const separator = SeparatorNode.parse({
    id: 'separator_bc',
    parentId: 'level_row',
    start: [8, 0],
    end: [8, 4],
  })
  const children = [...walls, ...(open ? [dividers[0]!, separator] : dividers), ...zones]
  const level = LevelNode.parse({
    id: 'level_row',
    height: 3,
    children: children.map((node) => node.id),
  })
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [level, ...children, ...(open ? doors.slice(0, 1) : doors)].map((node) => [node.id, node]),
  )
  return reconcileStructureWithStableIds({ nodes }).nodes as Record<string, AnyNode>
}
