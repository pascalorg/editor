import { expect, test } from 'bun:test'
import { cloneLevelSubtree, cloneSceneGraph } from '../../utils/clone-scene-graph'
import { LevelNode } from './level'
import { RoofNode } from './roof'
import { WallNode } from './wall'

test('roof wall bindings are optional and survive JSON parsing', () => {
  expect(RoofNode.parse({})).not.toHaveProperty('sourceWallIds')
  const roof = RoofNode.parse({ sourceWallIds: ['wall_source'] })
  expect(RoofNode.parse(JSON.parse(JSON.stringify(roof))).sourceWallIds).toEqual(['wall_source'])
})

test('scene and level clones remap roof source walls', () => {
  const level = LevelNode.parse({})
  const wall = WallNode.parse({ parentId: level.id, start: [0, 0], end: [4, 0] })
  const roof = RoofNode.parse({ parentId: level.id, sourceWallIds: [wall.id] })
  level.children = [wall.id, roof.id]
  const nodes = Object.fromEntries([level, wall, roof].map((node) => [node.id, node]))
  const whole = cloneSceneGraph({ nodes, rootNodeIds: [level.id] })
  const levelClone = cloneLevelSubtree(nodes, level.id)
  for (const clonedNodes of [Object.values(whole.nodes), levelClone.clonedNodes]) {
    const clonedWall = clonedNodes.find((node) => node.type === 'wall')!
    const clonedRoof = clonedNodes.find((node) => node.type === 'roof')!
    expect(clonedRoof.sourceWallIds).toEqual([clonedWall.id])
    expect(clonedWall.id).not.toBe(wall.id)
  }
})
