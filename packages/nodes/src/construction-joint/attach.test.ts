import { describe, expect, test } from 'bun:test'
import type { AnyNode, WallNode } from '@pascal-app/core'
import { buildSolverJointNodes } from './attach'

function makeWall(overrides: Partial<WallNode> = {}): WallNode {
  return {
    object: 'node',
    id: 'wall_test',
    type: 'wall',
    parentId: 'level_test',
    visible: true,
    metadata: {},
    children: [],
    start: [0, 0],
    end: [40, 0],
    thickness: 0.3,
    height: 3,
    frontSide: 'unknown',
    backSide: 'unknown',
    formworkType: 'plywood',
    ...overrides,
  } as WallNode
}

function joint(overrides: Record<string, unknown>): AnyNode {
  return {
    object: 'node',
    id: 'construction-joint_existing',
    type: 'construction-joint',
    parentId: 'level_test',
    visible: true,
    metadata: {},
    children: [],
    kind: 'construction',
    elementIds: ['wall_test'],
    treatments: [],
    solverPlaced: true,
    ...overrides,
  } as unknown as AnyNode
}

describe('buildSolverJointNodes', () => {
  test('an unsplit wall implies no joints', () => {
    expect(buildSolverJointNodes(makeWall())).toEqual([])
  })

  test('a lift split emits one horizontal joint per boundary', () => {
    const joints = buildSolverJointNodes(makeWall({ height: 9, maxLiftHeight: 3 }))
    expect(joints.map((j) => j.elevation)).toEqual([3, 6])
    expect(joints.every((j) => j.along === undefined)).toBe(true)
  })

  test('a lift joint carries roughening and starters', () => {
    // The lift above bears across it, so the interface needs both bond and
    // continuity.
    const [first] = buildSolverJointNodes(makeWall({ height: 9, maxLiftHeight: 3 }))
    expect(first?.treatments.map((t) => t.kind).sort()).toEqual(['roughening', 'starter-bars'])
  })

  test('a pour break emits one vertical joint per soft cut', () => {
    const joints = buildSolverJointNodes(makeWall({ maxPourLength: 12 }))
    expect(joints.map((j) => j.along)).toEqual([10, 20, 30])
    expect(joints.every((j) => j.elevation === undefined)).toBe(true)
  })

  test('a pour break takes starters without roughening', () => {
    // A vertical face is formed rather than screeded, so it is already keyed
    // enough to bond.
    const [first] = buildSolverJointNodes(makeWall({ maxPourLength: 12 }))
    expect(first?.treatments.map((t) => t.kind)).toEqual(['starter-bars'])
  })

  test('parents to the level, not the wall', () => {
    // A joint is an interface. Hanging it off one element would make the other
    // side's shutter wrong for the element-to-element case that shares the kind.
    const [first] = buildSolverJointNodes(makeWall({ height: 9, maxLiftHeight: 3 }))
    expect(first?.parentId).toBe('level_test')
    expect(first?.elementIds).toEqual(['wall_test'])
  })

  test('marks every emitted joint as solver-placed', () => {
    const joints = buildSolverJointNodes(makeWall({ height: 9, maxLiftHeight: 3 }))
    expect(joints.every((j) => j.solverPlaced && j.kind === 'construction')).toBe(true)
  })

  test('does not stack a duplicate onto a joint that already exists', () => {
    const wall = makeWall({ height: 9, maxLiftHeight: 3 })
    const existing = joint({ elevation: 3 })
    const joints = buildSolverJointNodes(wall, [wall as AnyNode, existing])
    expect(joints.map((j) => j.elevation)).toEqual([6])
  })

  test('leaves an edited joint alone rather than replacing it', () => {
    // The user added a waterstop. A regenerate that swapped in a default joint
    // would silently drop it.
    const wall = makeWall({ height: 9, maxLiftHeight: 3 })
    const edited = joint({ elevation: 3, treatments: [{ kind: 'waterstop' }] })
    const joints = buildSolverJointNodes(wall, [wall as AnyNode, edited])
    expect(joints.some((j) => j.elevation === 3)).toBe(false)
  })

  test('does not re-emit a hard cut it was given as input', () => {
    const wall = makeWall()
    const expansion = joint({ id: 'construction-joint_x', kind: 'expansion', along: 15 })
    expect(buildSolverJointNodes(wall, [wall as AnyNode, expansion])).toEqual([])
  })

  test('emits only its own soft cuts around a hard one', () => {
    const wall = makeWall({ maxPourLength: 12 })
    const expansion = joint({ id: 'construction-joint_x', kind: 'expansion', along: 15 })
    const joints = buildSolverJointNodes(wall, [wall as AnyNode, expansion])
    // Bay 0–15 cut once at 7.5; bay 15–40 cut twice. The joint at 15 is input.
    expect(joints.map((j) => j.along)).toHaveLength(3)
    expect(joints.some((j) => j.along === 15)).toBe(false)
  })

  test('ignores a joint on a different wall', () => {
    const wall = makeWall({ height: 9, maxLiftHeight: 3 })
    const other = joint({ elevation: 3, elementIds: ['wall_other'] })
    const joints = buildSolverJointNodes(wall, [wall as AnyNode, other])
    expect(joints.map((j) => j.elevation)).toEqual([3, 6])
  })

  test('a wall split both ways emits joints for each axis', () => {
    const joints = buildSolverJointNodes(
      makeWall({ height: 9, maxLiftHeight: 3, maxPourLength: 12 }),
    )
    // A joint is shared by the units either side, so it is one per boundary —
    // 2 horizontal and 3 vertical, not one per pour unit.
    expect(joints.filter((j) => j.elevation !== undefined)).toHaveLength(2)
    expect(joints.filter((j) => j.along !== undefined)).toHaveLength(3)
  })
})
