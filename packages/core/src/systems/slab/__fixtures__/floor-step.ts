import {
  type AnyNode,
  DoorNode,
  LevelNode,
  SeparatorNode,
  SlabNode,
  WallNode,
  ZoneNode,
} from '../../../schema'

export function floorStepFixture(separator = false) {
  const ring = (x0: number, z0: number, x1: number, z1: number): [number, number][] => [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ]
  const outline = ring(0, 0, 8, 4)
  const walls = outline.map((start, i) =>
    WallNode.parse({
      id: `wall_step_${i}`,
      parentId: 'level_step',
      start,
      end: outline[(i + 1) % 4],
      thickness: 0.2,
    }),
  )
  const divider = WallNode.parse({
    id: 'wall_step_divider',
    parentId: 'level_step',
    start: [4, 0],
    end: [4, 4],
    thickness: 0.2,
    frontSide: 'interior',
    backSide: 'exterior',
  })
  const boundary = separator
    ? SeparatorNode.parse({
        id: 'separator_step',
        parentId: 'level_step',
        start: divider.start,
        end: divider.end,
      })
    : divider
  if (!separator) walls.push(divider)
  const zones = [0.05, -0.4].map((elevation, i) =>
    ZoneNode.parse({
      id: `zone_step_${i}`,
      parentId: 'level_step',
      name: 'Room',
      spaceRole: 'room',
      enclosureStatus: 'enclosed',
      polygon: ring(i * 4, 0, (i + 1) * 4, 4),
      floor: { elevation },
    }),
  )
  const slabs = zones.map((zone, i) =>
    SlabNode.parse({
      id: `slab_step_${i}`,
      parentId: 'level_step',
      boundary: 'auto',
      zoneIds: [zone.id],
      elevation: zone.floor!.elevation,
      thickness: i ? 0.05 : 0.45,
      polygon: ring(i ? (separator ? 4 : 3.9) : -0.1, -0.1, i ? 8.1 : separator ? 4 : 4.1, 4.1),
    }),
  )
  const door = DoorNode.parse({
    id: 'door_step',
    parentId: divider.id,
    wallId: divider.id,
    width: 1,
    height: 2,
    position: [2, 1, 0],
  })
  const children = [...walls, ...(separator ? [boundary] : []), ...zones, ...slabs]
  const level = LevelNode.parse({ id: 'level_step', children: children.map((node) => node.id) })
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [level, ...children].map((node) => [node.id, node]),
  )
  return { walls, divider, boundary, zones, slabs, door, level, nodes }
}
