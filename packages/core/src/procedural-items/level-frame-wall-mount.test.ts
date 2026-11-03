import { expect, test } from 'bun:test'
import { ItemNode } from '../schema/nodes/item'
import { LevelNode } from '../schema/nodes/level'
import { RoofNode } from '../schema/nodes/roof'
import { RoofSegmentNode } from '../schema/nodes/roof-segment'
import { roofFacePointToSegment } from '../schema/nodes/roof-segment-walls'
import { WallNode } from '../schema/nodes/wall'
import type { AnyNode } from '../schema/types'
import { nodeLevelFrame } from './query'
import { composeFrames, frame, transformPoint } from './spatial'

const asset = {
  id: 'frame-box',
  name: 'Frame box',
  category: 'decor',
  thumbnail: '',
  src: '/frame-box.glb',
  dimensions: [0.4, 0.4, 0.2] as [number, number, number],
}

function graph(...entries: AnyNode[]) {
  return Object.fromEntries(entries.map((node) => [node.id, node])) as Record<string, AnyNode>
}

// ItemSystem renders a wall-side item on the face it hangs from and a wall item
// on the wall body's centre, whatever its stored depth.
for (const [side, z] of [
  ['front', 0.15],
  ['back', -0.15],
] as const)
  test(`a wall-side item on the ${side} face sits on that face`, () => {
    const level = LevelNode.parse({})
    const wall = WallNode.parse({ parentId: level.id, start: [0, 0], end: [4, 0], thickness: 0.3 })
    const item = ItemNode.parse({
      parentId: wall.id,
      asset: { ...asset, attachTo: 'wall-side' },
      side,
      position: [1, 1, 0.07],
    })
    const f = nodeLevelFrame(item.id, graph(level, wall, item), undefined, { planOnly: true })
    expect(f.position[0]).toBeCloseTo(1)
    expect(f.position[2]).toBeCloseTo(z)
  })

test('a wall item sits relative to the body centre of a justified wall', () => {
  const level = LevelNode.parse({})
  const wall = WallNode.parse({
    parentId: level.id,
    start: [0, 0],
    end: [4, 0],
    thickness: 0.3,
    justification: 'a',
  })
  const item = ItemNode.parse({
    parentId: wall.id,
    asset: { ...asset, attachTo: 'wall' },
    position: [1, 1, 0.02],
  })
  const f = nodeLevelFrame(item.id, graph(level, wall, item), undefined, { planOnly: true })
  expect(f.position[2]).toBeCloseTo(0.17)
})

test('a wall-side item on a roof face sits on the roof wall surface', () => {
  const level = LevelNode.parse({})
  const roof = RoofNode.parse({ parentId: level.id, position: [2, 0, 3], rotation: 0.3 })
  const segment = RoofSegmentNode.parse({
    parentId: roof.id,
    position: [1, 2, 1],
    rotation: 0.2,
    wallThickness: 0.24,
  })
  const item = ItemNode.parse({
    parentId: segment.id,
    asset: { ...asset, attachTo: 'wall-side' },
    side: 'front',
    roofSegmentId: segment.id,
    roofFace: 'front',
    position: [0.5, 0.4, 0],
  })
  const segmentLocal = roofFacePointToSegment(segment, 'front', [0.5, 0.4, 0.12])
  const expected = transformPoint(
    composeFrames(
      frame(roof.position, [0, roof.rotation, 0]),
      frame(segment.position, [0, segment.rotation, 0]),
    ),
    segmentLocal,
  )
  const f = nodeLevelFrame(item.id, graph(level, roof, segment, item), undefined, {
    planOnly: true,
  })
  expect(f.position[0]).toBeCloseTo(expected[0])
  expect(f.position[2]).toBeCloseTo(expected[2])
})
