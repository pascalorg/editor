// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, CeilingNode, LevelNode } from '@pascal-app/core'
import { EXPLODED_LEVEL_GAP, getLevelLayoutEntries } from './level-utils'

function sceneWithTwoLevels() {
  const ground = LevelNode.parse({ level: 0, children: [] })
  const upper = LevelNode.parse({ level: 1, children: [] })
  const groundCeiling = CeilingNode.parse({
    parentId: ground.id,
    height: 2.5,
    polygon: [
      [0, 0],
      [5, 0],
      [5, 10],
      [0, 10],
    ],
  })
  const upperCeiling = CeilingNode.parse({
    parentId: upper.id,
    height: 2.5,
    polygon: [
      [0, 0],
      [5, 0],
      [5, 10],
      [0, 10],
    ],
  })
  const linkedGround = { ...ground, children: [groundCeiling.id] }
  const linkedUpper = { ...upper, children: [upperCeiling.id] }

  return {
    entries: [
      { levelId: linkedGround.id, index: linkedGround.level },
      { levelId: linkedUpper.id, index: linkedUpper.level },
    ],
    ground: linkedGround,
    upper: linkedUpper,
    nodes: {
      [linkedGround.id]: linkedGround,
      [linkedUpper.id]: linkedUpper,
      [groundCeiling.id]: groundCeiling,
      [upperCeiling.id]: upperCeiling,
    } as Record<AnyNodeId, AnyNode>,
  }
}

describe('level layout entries', () => {
  test('stacks levels by cumulative story height', () => {
    const scene = sceneWithTwoLevels()

    const layout = getLevelLayoutEntries({
      entries: scene.entries,
      nodes: scene.nodes,
      levelMode: 'stacked',
      selectedLevelId: scene.upper.id,
    })

    expect(layout.map((entry) => entry.targetY)).toEqual([0, 2.5])
    expect(layout.every((entry) => entry.visible)).toBe(true)
  })

  test('adds an explicit gap in exploded mode', () => {
    const scene = sceneWithTwoLevels()

    const layout = getLevelLayoutEntries({
      entries: scene.entries,
      nodes: scene.nodes,
      levelMode: 'exploded',
      selectedLevelId: scene.upper.id,
    })

    expect(layout.map((entry) => entry.targetY)).toEqual([0, 2.5 + EXPLODED_LEVEL_GAP])
  })

  test('drops the selected solo level to local ground height', () => {
    const scene = sceneWithTwoLevels()

    const layout = getLevelLayoutEntries({
      entries: scene.entries,
      nodes: scene.nodes,
      levelMode: 'solo',
      selectedLevelId: scene.upper.id,
    })

    expect(layout.find((entry) => entry.levelId === scene.upper.id)).toMatchObject({
      targetY: 0,
      visible: true,
    })
    expect(layout.find((entry) => entry.levelId === scene.ground.id)).toMatchObject({
      targetY: 0,
      visible: false,
    })
  })
})
