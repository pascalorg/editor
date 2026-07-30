import { describe, expect, test } from 'bun:test'
import { type AnyNode, CeilingNode, LevelNode, SlabNode } from '@pascal-app/core'
import useElevationGuides from '../store/use-elevation-guides'
import {
  clearStructuralElevationGuide,
  collectElevationSnapTargets,
  publishStructuralElevationGuide,
  resolveElevationSnapMatch,
  resolveStructuralElevationSnap,
} from './elevation-guides'

function structuralScene() {
  const rawLevel = LevelNode.parse({ level: 0, height: 3 })
  const slab = SlabNode.parse({
    parentId: rawLevel.id,
    polygon: [
      [2, -1],
      [4, -1],
      [4, 1],
      [2, 1],
    ],
    elevation: 0.6,
    thickness: 0.2,
  })
  const ceiling = CeilingNode.parse({
    parentId: rawLevel.id,
    polygon: [
      [-4, -1],
      [-2, -1],
      [-2, 1],
      [-4, 1],
    ],
    height: 2.4,
  })
  const level = { ...rawLevel, children: [slab.id, ceiling.id] }
  const nodes: Record<string, AnyNode> = {
    [level.id]: level,
    [slab.id]: slab,
    [ceiling.id]: ceiling,
  }
  return { ceiling, level, nodes, slab }
}

describe('elevation guides', () => {
  test('collects the level, slab faces, and ceiling plane on the source level', () => {
    const { level, nodes, slab } = structuralScene()
    const targets = collectElevationSnapTargets(
      { nodeId: 'wall_moving', levelId: level.id, anchor: [0, 0] },
      nodes,
    )

    expect(targets.map((target) => [target.label, target.elevation])).toEqual([
      ['Level', 0],
      ['Slab top', 0.6],
      ['Slab underside', 0.39999999999999997],
      ['Ceiling', 2.4],
    ])

    const withoutSelf = collectElevationSnapTargets(
      { nodeId: slab.id, levelId: level.id, anchor: [0, 0] },
      nodes,
    )
    expect(withoutSelf.some((target) => target.id.startsWith(slab.id))).toBe(false)
  })

  test('snaps inside the Y tolerance and leaves values outside it alone', () => {
    const { level, nodes } = structuralScene()
    const source = { nodeId: 'wall_moving', levelId: level.id, anchor: [0, 0] } as const

    expect(resolveStructuralElevationSnap(source, 0.54, nodes)).toBe(0.6)
    expect(resolveStructuralElevationSnap(source, 0.49, nodes)).toBe(0.49)
    expect(resolveStructuralElevationSnap(source, 2.34, nodes)).toBe(2.4)
  })

  test('uses plan distance to disambiguate datums at the same elevation', () => {
    const match = resolveElevationSnapMatch(
      1,
      [0, 0],
      [
        { id: 'far', elevation: 1, anchor: [10, 0], label: 'Far' },
        { id: 'near', elevation: 1, anchor: [2, 0], label: 'Near' },
      ],
    )

    expect(match?.target.id).toBe('near')
  })

  test('publishes one owner-scoped guide only while exactly aligned', () => {
    const { level, nodes } = structuralScene()
    const source = { nodeId: 'wall_moving', levelId: level.id, anchor: [0, 0] } as const
    useElevationGuides.setState({ guide: null })

    publishStructuralElevationGuide(source, 0.6, nodes)
    expect(useElevationGuides.getState().guide).toMatchObject({
      ownerId: 'wall_moving',
      elevation: 0.6,
      label: 'Slab top',
      direction: [1, 0],
    })

    clearStructuralElevationGuide('someone_else')
    expect(useElevationGuides.getState().guide).not.toBeNull()

    publishStructuralElevationGuide(source, 0.7, nodes)
    expect(useElevationGuides.getState().guide).toBeNull()
  })
})
