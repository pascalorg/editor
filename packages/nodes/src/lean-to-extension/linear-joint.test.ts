import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  LeanToExtensionNode,
  type LeanToExtensionNode as LeanToExtensionNodeType,
  WallNode,
} from '@pascal-app/core'
import { createLeanToAssembly, leanToCornerPostIndex, managedLeanToPostIndex } from './assembly'
import { resolveLeanToCornerJoints } from './corner-joint'
import { resolveLeanToLayout } from './layout'

function linearFixture(overrides: Partial<LeanToExtensionNodeType> = {}) {
  const wall = WallNode.parse({
    id: 'wall_linear_joint',
    parentId: 'level_linear_joint',
    start: [0, 0],
    end: [12, 0],
  })
  const left = LeanToExtensionNode.parse({
    id: 'leanto_linear_left',
    parentId: wall.id,
    position: [2, 0, 0.05],
    span: 4,
    leftOverhang: 0.15,
    rightOverhang: 0.15,
  })
  const right = LeanToExtensionNode.parse({
    id: 'leanto_linear_right',
    parentId: wall.id,
    position: [6.3, 0, 0.05],
    span: 4,
    leftOverhang: 0.15,
    rightOverhang: 0.15,
    ...overrides,
  })
  const nodes = {
    [wall.id]: { ...wall, children: [left.id, right.id] },
    [left.id]: left,
    [right.id]: right,
  } as Record<string, AnyNode>
  return { wall, left, right, nodes }
}

describe('lean-to linear joints', () => {
  test('turns two edge-snapped extensions into one reciprocal structural joint', () => {
    const { wall, left, right, nodes } = linearFixture()
    const leftJoint = resolveLeanToCornerJoints(left, wall, nodes).right
    const rightJoint = resolveLeanToCornerJoints(right, wall, nodes).left

    expect(leftJoint).toMatchObject({
      kind: 'linear',
      neighborId: right.id,
      neighborSide: 'left',
      gutterMitre: 0,
    })
    expect(rightJoint).toMatchObject({
      kind: 'linear',
      neighborId: left.id,
      neighborSide: 'right',
      gutterMitre: 0,
    })
    expect(Number(leftJoint?.sharedPostOwner) + Number(rightJoint?.sharedPostOwner)).toBe(1)
    expect(left.position[0] + (leftJoint?.sharedPostPosition[0] ?? 0)).toBeCloseTo(
      right.position[0] + (rightJoint?.sharedPostPosition[0] ?? 0),
      6,
    )
  })

  test('opens the internal roof and gutter ends and generates one joint pillar', () => {
    const { left, right, nodes } = linearFixture()
    const leftAssembly = createLeanToAssembly(left, undefined, nodes)
    const rightAssembly = createLeanToAssembly(right, undefined, nodes)

    expect(leftAssembly.segment.shedOpenEndSides).toContain('right')
    expect(rightAssembly.segment.shedOpenEndSides).toContain('left')
    expect(leftAssembly.gutter.endCapRight).toBe(false)
    expect(rightAssembly.gutter.endCapLeft).toBe(false)
    expect(leftAssembly.gutter.endCapLeft).toBe(true)
    expect(rightAssembly.gutter.endCapRight).toBe(true)

    const posts = [...leftAssembly.posts, ...rightAssembly.posts]
    const sharedPosts = posts.filter((post) => {
      const index = managedLeanToPostIndex(post)
      return index === leanToCornerPostIndex('left') || index === leanToCornerPostIndex('right')
    })
    const ordinaryCount =
      resolveLeanToLayout(left).postXs.length + resolveLeanToLayout(right).postXs.length
    expect(sharedPosts).toHaveLength(1)
    expect(posts).toHaveLength(ordinaryCount - 1)
  })

  test('does not connect roofs whose edge profiles do not meet', () => {
    const heightMismatch = linearFixture({ highEdgeHeight: 3.2 })
    expect(
      resolveLeanToCornerJoints(heightMismatch.left, heightMismatch.wall, heightMismatch.nodes)
        .right,
    ).toBeUndefined()

    const separated = linearFixture({ position: [6.6, 0, 0.05] })
    expect(
      resolveLeanToCornerJoints(separated.left, separated.wall, separated.nodes).right,
    ).toBeUndefined()
  })

  test('keeps straight snap connectivity independent from corner-miter preference', () => {
    const { wall, left, right, nodes } = linearFixture({ autoMiterCorners: false })
    const leftWithoutCornerMitres = { ...left, autoMiterCorners: false }
    const resolvedNodes = {
      ...nodes,
      [left.id]: leftWithoutCornerMitres,
      [right.id]: right,
    }

    expect(
      resolveLeanToCornerJoints(leftWithoutCornerMitres, wall, resolvedNodes).right?.kind,
    ).toBe('linear')
  })
})
