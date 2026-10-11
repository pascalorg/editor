import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { WallNode } from '../schema'
import { getWallCurveFrameAt } from '../systems/wall/wall-curve'
import { getWallFaceOffsets } from '../systems/wall/wall-frame'
import { plateFootprint } from './level-footprints'
import { area, containsPoint, difference, union } from './polygon-boolean'
import { createRoomTopologyIndex } from './space-detection'

const cases = [
  { id: 'scene-02', rooms: 8, group: [2] },
  { id: 'scene-14', rooms: 4, group: [0, 1, 2] },
  { id: 'scene-15', rooms: 6, group: [0] },
  { id: 'scene-18', rooms: 28, group: [10] },
  { id: 'scene-28', rooms: 7, group: [4, 6] },
]

describe('production plate union regressions', () => {
  test.each(cases)('$id preserves the union of room faces', ({ id, rooms: count, group }) => {
    const coordinates = JSON.parse(
      readFileSync(new URL(`./__fixtures__/plate-corpus/${id}.json`, import.meta.url), 'utf8'),
    ) as Partial<WallNode>[]
    const walls = coordinates.map((geometry, i) =>
      WallNode.parse({ ...geometry, id: `wall_${i}`, parentId: 'level_fixture' }),
    )
    const index = createRoomTopologyIndex()
    index.rebuild(Object.fromEntries(walls.map((wall) => [wall.id, wall])))
    const rooms = index.getLevelTopology('level_fixture')!.rooms
    expect(rooms).toHaveLength(count)
    const members = group.map((i) => rooms[i]!)
    const faces = union(members.map((room) => ({ outer: room.polygon, holes: room.holes })))
    expect(area(faces)).toBeGreaterThan(0)
    const plate = plateFootprint(members)
    expect(plate.length).toBeGreaterThan(0)
    expect(area(plate)).toBeGreaterThanOrEqual(area(faces))
    const boundaryIds = new Set(
      members.flatMap((room) =>
        room.spans.filter((span) => span.kind === 'wall').map((span) => span.boundaryId),
      ),
    )
    for (const wallId of boundaryIds) {
      const footprint = members[0]!.context.wallFootprints.get(wallId)!
      const wall = walls.find((wall) => wall.id === wallId)!
      const { a, b } = getWallFaceOffsets(wall)
      const spans = members.flatMap((room) =>
        room.spans.filter((span) => span.boundaryId === wallId),
      )
      if (spans.some((span) => span.t0 === 0 && span.t1 === 1))
        expect(area(difference(footprint, plate, { throwOnError: true })), wallId).toBeLessThan(
          1e-6,
        )
      for (const span of spans)
        for (let i = 1; i < 32; i++) {
          const { point, normal } = getWallCurveFrameAt(
            wall,
            span.t0 + ((span.t1 - span.t0) * i) / 32,
          )
          for (const offset of [a * 0.99, 0, b * 0.99]) {
            const probe: [number, number] = [
              point.x + normal.x * offset,
              point.y + normal.y * offset,
            ]
            if (containsPoint([{ outer: footprint, holes: [] }], probe))
              expect(containsPoint(plate, probe), wallId).toBe(true)
          }
        }
    }
    if (id === 'scene-28') expect(containsPoint(plate, [1.2, 4.86])).toBe(true)
    expect(plateFootprint([...members].reverse())).toBe(plate)
  })
})
