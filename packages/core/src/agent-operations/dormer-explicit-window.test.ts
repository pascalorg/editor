import { expect, test } from 'bun:test'
import { type AnyNode, LevelNode, RoofNode, RoofSegmentNode } from '../schema'
import { addDormer } from './index'

// Restated from the lab's attic-dormer test: explicit window dimensions are the person's
// design and are kept exactly as asked (0.7 m by 0.6 m here).
test('add_dormer keeps explicit window dimensions', () => {
  const level = LevelNode.parse({ id: 'level_explicit', children: ['roof_explicit'] })
  const roof = RoofNode.parse({ id: 'roof_explicit', parentId: level.id, children: ['rseg_e'] })
  const segment = RoofSegmentNode.parse({
    id: 'rseg_e',
    parentId: roof.id,
    roofType: 'gable',
    width: 12,
    depth: 8,
    pitch: 45,
    wallHeight: 2,
  })
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [level, roof, segment].map((node) => [node.id, node]),
  )
  const outcome = addDormer(
    nodes,
    { segmentId: segment.id, at: [0, 2], windowWidth: 0.7, windowHeight: 0.6 },
    { activeLevelId: null },
  )
  const window = outcome.changes?.create?.map(({ node }) => node).find((n) => n.type === 'window')
  if (window?.type !== 'window') throw new Error('explicit window missing')
  expect(window.width).toBe(0.7)
  expect(window.height).toBe(0.6)
})
