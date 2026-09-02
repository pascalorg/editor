import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import { persistResolvedMarks, resolveMarkDetail, resolveMarks } from './marks'

/**
 * Fixture: a rectangular level, walls running clockwise on screen from the
 * north-west corner.
 *
 *   north  [0,0] → [6,0]      doors d_n1 @1, d_n2 @4
 *   east   [6,0] → [6,4]      window w_e1 @2
 *   south  [6,4] → [0,4]      door d_s1 @2
 *   west   [0,4] → [0,0]      (interior partition, no openings)
 */
function fixture(levelOrdinal = 0): Record<string, AnyNode> {
  const nodes: Record<string, AnyNode> = {}
  const node = (value: Record<string, unknown>) => {
    nodes[value.id as string] = {
      object: 'node',
      parentId: null,
      visible: true,
      metadata: {},
      children: [],
      ...value,
    } as unknown as AnyNode
  }

  node({ id: 'level_1', type: 'level', level: levelOrdinal, children: ['w_n', 'w_e', 'w_s', 'w_w'] })
  node({
    id: 'w_n',
    type: 'wall',
    parentId: 'level_1',
    start: [0, 0],
    end: [6, 0],
    thickness: 0.15,
    frontSide: 'exterior',
    backSide: 'interior',
    children: ['d_n1', 'd_n2'],
  })
  node({
    id: 'w_e',
    type: 'wall',
    parentId: 'level_1',
    start: [6, 0],
    end: [6, 4],
    thickness: 0.15,
    frontSide: 'exterior',
    backSide: 'interior',
    children: ['win_e1'],
  })
  node({
    id: 'w_s',
    type: 'wall',
    parentId: 'level_1',
    start: [6, 4],
    end: [0, 4],
    thickness: 0.15,
    frontSide: 'exterior',
    backSide: 'interior',
    children: ['d_s1'],
  })
  node({
    id: 'w_w',
    type: 'wall',
    parentId: 'level_1',
    start: [0, 4],
    end: [0, 0],
    thickness: 0.1,
    frontSide: 'interior',
    backSide: 'interior',
    children: [],
  })

  const door = (id: string, wallId: string, along: number) =>
    node({
      id,
      type: 'door',
      parentId: wallId,
      wallId,
      width: 0.9,
      height: 2.1,
      position: [along, 1.05, 0],
    })
  door('d_n1', 'w_n', 1)
  door('d_n2', 'w_n', 4)
  door('d_s1', 'w_s', 2)
  node({
    id: 'win_e1',
    type: 'window',
    parentId: 'w_e',
    wallId: 'w_e',
    width: 1.2,
    height: 1.2,
    position: [2, 1.1, 0],
  })
  return nodes
}

describe('resolveMarks', () => {
  test('doors are D101…, windows W101… on level 0', () => {
    const marks = resolveMarks(fixture(), 'level_1' as AnyNodeId)
    expect(marks.get('d_n1')).toBe('D101')
    expect(marks.get('d_n2')).toBe('D102')
    expect(marks.get('d_s1')).toBe('D103')
    expect(marks.get('win_e1')).toBe('W101')
  })

  test('level ordinal shifts the base by 100', () => {
    const marks = resolveMarks(fixture(1), 'level_1' as AnyNodeId)
    expect(marks.get('d_n1')).toBe('D201')
    expect(marks.get('win_e1')).toBe('W201')
  })

  test('openings are ordered clockwise from the north-west, exterior walls first', () => {
    const nodes = fixture()
    // Move the west partition's opening onto it to prove interior comes last.
    ;(nodes.w_w as unknown as { children: string[] }).children = ['d_w1']
    nodes.d_w1 = {
      object: 'node',
      id: 'd_w1',
      type: 'door',
      parentId: 'w_w',
      wallId: 'w_w',
      visible: true,
      metadata: {},
      width: 0.8,
      height: 2.1,
      position: [2, 1.05, 0],
      children: [],
    } as unknown as AnyNode
    const marks = resolveMarks(nodes, 'level_1' as AnyNodeId)
    // North (exterior) first, then the other exterior walls, interior last.
    expect(marks.get('d_w1')).toBe('D104')
  })

  test('an explicit mark wins and is never reassigned', () => {
    const nodes = fixture()
    ;(nodes.d_n2 as unknown as { mark: string }).mark = 'D-GARAGE'
    const marks = resolveMarks(nodes, 'level_1' as AnyNodeId)
    expect(marks.get('d_n2')).toBe('D-GARAGE')
    expect(marks.get('d_n1')).toBe('D101')
    expect(marks.get('d_s1')).toBe('D102')
  })

  test('duplicate explicit marks are reported, not silently renumbered', () => {
    const nodes = fixture()
    ;(nodes.d_n1 as unknown as { mark: string }).mark = 'D101'
    ;(nodes.d_n2 as unknown as { mark: string }).mark = 'D101'
    const resolution = resolveMarkDetail(nodes, 'level_1' as AnyNodeId)
    expect(resolution.issues).toEqual(['Duplicate door mark D101 (2 instances)'])
  })

  test('numbering is stable under insertion once persisted', () => {
    const nodes = fixture()
    const first = resolveMarkDetail(nodes, 'level_1' as AnyNodeId)
    expect([...first.assignments.values()]).toEqual(['D101', 'D102', 'D103', 'W101'])

    // Persist, the way an edit session does the first time it resolves.
    const written = persistResolvedMarks(first, (id, data) => {
      ;(nodes[id] as unknown as Record<string, unknown>).mark = data.mark
    })
    expect(written).toBe(4)

    // Insert a door BETWEEN d_n1 and d_n2 on the same wall.
    ;(nodes.w_n as unknown as { children: string[] }).children = ['d_n1', 'd_new', 'd_n2']
    nodes.d_new = {
      object: 'node',
      id: 'd_new',
      type: 'door',
      parentId: 'w_n',
      wallId: 'w_n',
      visible: true,
      metadata: {},
      width: 0.8,
      height: 2.1,
      position: [2.5, 1.05, 0],
      children: [],
    } as unknown as AnyNode

    const second = resolveMarkDetail(nodes, 'level_1' as AnyNodeId)
    // Existing doors keep their marks; the new one takes the next free number.
    expect(second.marks.get('d_n1')).toBe('D101')
    expect(second.marks.get('d_n2')).toBe('D102')
    expect(second.marks.get('d_s1')).toBe('D103')
    expect(second.marks.get('d_new')).toBe('D104')
    expect([...second.assignments.keys()]).toEqual(['d_new'])
  })

  test('WITHOUT persisting, inserting mid-wall renumbers — which is why we persist', () => {
    const nodes = fixture()
    ;(nodes.w_n as unknown as { children: string[] }).children = ['d_n1', 'd_new', 'd_n2']
    nodes.d_new = {
      object: 'node',
      id: 'd_new',
      type: 'door',
      parentId: 'w_n',
      wallId: 'w_n',
      visible: true,
      metadata: {},
      width: 0.8,
      height: 2.1,
      position: [2.5, 1.05, 0],
      children: [],
    } as unknown as AnyNode
    const marks = resolveMarks(nodes, 'level_1' as AnyNodeId)
    expect(marks.get('d_new')).toBe('D102')
    expect(marks.get('d_n2')).toBe('D103')
  })
})
