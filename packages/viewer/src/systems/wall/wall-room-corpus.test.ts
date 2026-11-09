import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  type AnyNode,
  calculateLevelMiters,
  computeWallSlabSupport,
  DoorNode,
  extractRooms,
  SlabNode,
  sceneRegistry,
  WallNode,
  WindowNode,
  ZoneNode,
} from '@pascal-app/core'
import { Mesh } from 'three'
import coordinates from '../../../../core/src/lib/__fixtures__/plate-corpus/scene-15.json'
import hashes from './wall-room-corpus-golden.json'
import { generateExtrudedWall } from './wall-system'

test('corpus room-path walls with door and window cuts retain pre-phase-5 geometry bytes', () => {
  const walls = coordinates.map((wall, i) =>
    WallNode.parse({ ...wall, id: `wall_corpus_${i}`, parentId: 'level_corpus' }),
  )
  const rooms = extractRooms(walls)
  expect(rooms.length).toBeGreaterThan(0)
  const zones = rooms.map((room, i) =>
    ZoneNode.parse({
      id: `zone_corpus_${i}`,
      name: 'Room',
      parentId: 'level_corpus',
      spaceRole: 'room',
      polygon: room.referencePolygon,
      holes: room.holes,
      floor: { elevation: 0.05 },
    }),
  )
  const slabs = [
    SlabNode.parse({
      id: 'slab_corpus',
      parentId: 'level_corpus',
      elevation: 0.05,
      polygon: [
        [-100, -100],
        [100, -100],
        [100, 100],
        [-100, 100],
      ],
    }),
  ]
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [...walls, ...zones, ...slabs].map((node) => [node.id, node]),
  )
  const miters = calculateLevelMiters(walls)
  for (const [i, wall] of walls.entries()) {
    const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
    const opening =
      i % 2 === 0
        ? DoorNode.parse({
            id: `door_corpus_${i}`,
            parentId: wall.id,
            wallId: wall.id,
            width: Math.min(0.8, length / 2),
            height: 2,
            position: [length / 2, 1, 0],
          })
        : WindowNode.parse({
            id: `window_corpus_${i}`,
            parentId: wall.id,
            wallId: wall.id,
            width: Math.min(0.8, length / 2),
            height: 1.4,
            position: [length / 2, 1.6, 0],
          })
    nodes[opening.id] = opening
    const support = computeWallSlabSupport(wall, slabs, walls, undefined, undefined, 0, nodes)
    expect(support.faceDatum.a).toEqual(support.baseSegments)
    expect(support.faceDatum.b).toEqual(support.baseSegments)
    const registered = new Mesh()
    sceneRegistry.nodes.set(wall.id, registered)
    try {
      const geometry = generateExtrudedWall(
        wall,
        [opening],
        miters,
        support.elevation,
        support.baseElevation,
        support.baseSegments,
        undefined,
        undefined,
        support.faceDatum,
        undefined,
        nodes,
      )
      const hash = createHash('sha256')
      for (const key of Object.keys(geometry.attributes).sort())
        hash.update(Buffer.from(geometry.attributes[key]!.array.buffer))
      if (geometry.index) hash.update(Buffer.from(geometry.index.array.buffer))
      hash.update(JSON.stringify(geometry.groups))
      expect(hash.digest('hex')).toBe(hashes[i]!)
      geometry.dispose()
    } finally {
      sceneRegistry.nodes.delete(wall.id)
      registered.geometry.dispose()
    }
  }
})
