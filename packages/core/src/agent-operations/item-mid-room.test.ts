import { describe, expect, it } from 'bun:test'
import { type AnyNode, ItemNode, LevelNode, WallNode, ZoneNode } from '../schema'
import { layoutIssuesFromScene } from './layout-clearance'

/** A 4 × 3 m room (zone and four walls) on one level, with the named pieces standing at the given centres. */
function room(
  ...pieces: { asset: string; at: [number, number]; size?: [number, number, number] }[]
) {
  const corners: [number, number][] = [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ]
  const walls = corners.map((start, index) =>
    WallNode.parse({
      id: `wall_${index}`,
      parentId: 'level_m',
      start,
      end: corners[(index + 1) % corners.length]!,
      thickness: 0.1,
    }),
  )
  const zone = ZoneNode.parse({
    id: 'zone_m',
    parentId: 'level_m',
    name: 'Room',
    polygon: corners,
    spaceRole: 'room',
  })
  const items = pieces.map((piece) =>
    ItemNode.parse({
      id: `item_${piece.asset}`,
      parentId: 'level_m',
      position: [piece.at[0], 0, piece.at[1]],
      asset: {
        id: piece.asset,
        name: piece.asset,
        category: 'furniture',
        thumbnail: '',
        src: 'asset://x',
        dimensions: piece.size ?? [0.7, 1.8, 0.7],
      },
    }),
  )
  const level = LevelNode.parse({
    id: 'level_m',
    level: 0,
    children: [...walls, zone, ...items].map((node) => node.id),
  })
  return [level, ...walls, zone, ...items] as AnyNode[]
}

const midRoom = (nodes: AnyNode[]) =>
  layoutIssuesFromScene(nodes).filter((issue) => issue.type === 'item_mid_room')

describe('item_mid_room: a wall-bound piece standing away from every wall', () => {
  it('flags a fridge in the middle of the room', () => {
    const issues = midRoom(room({ asset: 'fridge', at: [2, 1.5] }))
    expect(issues).toHaveLength(1)
    expect(issues[0]?.message).toContain('item_fridge')
    expect(issues[0]?.message).toMatch(/wall/)
  })

  it('accepts a fridge set against a wall', () => {
    expect(midRoom(room({ asset: 'fridge', at: [2, 0.46] }))).toEqual([])
  })

  it('measures from the wall face, not its centre line', () => {
    // A 0.7 m deep piece whose back edge stands 0.35 m off the face of a 0.1 m wall.
    expect(midRoom(room({ asset: 'fridge', at: [2, 0.05 + 0.35 + 0.35] }))).toEqual([])
    // ...and one 0.5 m off the face is mid-room.
    expect(midRoom(room({ asset: 'fridge', at: [2, 0.05 + 0.5 + 0.35] }))).toHaveLength(1)
  })

  it('leaves free-standing kinds alone: a dining table or a rug may take the middle', () => {
    expect(
      midRoom(
        room(
          { asset: 'dining-table', at: [2, 1.5], size: [1.6, 0.75, 0.9] },
          { asset: 'rug', at: [2, 1.5], size: [2, 0.02, 1.4] },
        ),
      ),
    ).toEqual([])
  })

  it('does not judge a piece that is not inside any room', () => {
    expect(midRoom(room({ asset: 'fridge', at: [9, 9] }))).toEqual([])
  })

  it('does not judge a level with no walls', () => {
    const nodes = room({ asset: 'fridge', at: [2, 1.5] }).filter((node) => node.type !== 'wall')
    expect(midRoom(nodes)).toEqual([])
  })
})
