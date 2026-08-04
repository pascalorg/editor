import { describe, expect, test } from 'bun:test'
import {
  canCreateSessionGroup,
  createSessionGroup,
  expandSessionGroupMembers,
  liveSessionGroups,
  nextSessionGroupId,
  resetSessionGroupIdSerial,
  type SessionSelectionGroup,
  selectionIntersectsSessionGroup,
  selectionMatchesSessionGroup,
  ungroupSessionSelection,
} from './session-groups'

function group(id: string, memberIds: string[], label = id): SessionSelectionGroup {
  return { id, memberIds, label }
}

describe('session-groups', () => {
  test('createSessionGroup requires two live members', () => {
    resetSessionGroupIdSerial()
    expect(
      createSessionGroup([], ['a'], { idFactory: () => 'g1', labelFactory: () => 'G1' }).created,
    ).toBeNull()
  })

  test('create and expand and ungroup', () => {
    resetSessionGroupIdSerial(0)
    const { groups, created } = createSessionGroup([], ['a', 'b', 'c'], {
      idFactory: () => 'g1',
      labelFactory: () => 'Group 1',
    })
    expect(created?.memberIds).toEqual(['a', 'b', 'c'])
    expect(expandSessionGroupMembers(groups, 'b')).toEqual(['b', 'a', 'c'])
    expect(selectionMatchesSessionGroup(groups, ['a', 'b', 'c'])?.label).toBe('Group 1')
    expect(canCreateSessionGroup(groups, ['a', 'b', 'c'])).toBe(false)
    expect(canCreateSessionGroup(groups, ['a', 'b'])).toBe(true)
    expect(ungroupSessionSelection(groups, ['a']).groups).toEqual([])
  })

  test('liveSessionGroups hides groups that fall under two live members', () => {
    resetSessionGroupIdSerial(0)
    expect(nextSessionGroupId()).toBe('session-group-1')
    expect(liveSessionGroups([group('g1', ['a', 'gone'])], new Set(['a']))).toEqual([])
    expect(liveSessionGroups([group('g1', ['a', 'b', 'gone'])], new Set(['a', 'b']))).toEqual([
      group('g1', ['a', 'b']),
    ])
    expect(selectionIntersectsSessionGroup([group('g1', ['a', 'b'])], ['b'])).toBe(true)
  })

  test('a deleted member is excluded from reads but kept in membership for undo', () => {
    const groups = [group('g1', ['a', 'b', 'c'], 'Suite')]

    // `a` deleted: reads narrow to the survivors...
    expect(expandSessionGroupMembers(groups, 'b', new Set(['b', 'c']))).toEqual(['b', 'c'])
    // ...and `a` and `b` deleted drops the group below the floor, so it goes inert.
    expect(expandSessionGroupMembers(groups, 'c', new Set(['c']))).toBeNull()
    expect(selectionIntersectsSessionGroup(groups, ['c'], new Set(['c']))).toBe(false)

    // Undo restores the nodes, and membership was never rewritten — so the whole
    // group comes back. A destructive prune would have lost `a` (or the group).
    expect(expandSessionGroupMembers(groups, 'a', new Set(['a', 'b', 'c']))).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  test('ungroup leaves inert groups alone so undo can revive them', () => {
    const groups = [group('g1', ['a', 'b'], 'Pair')]
    // Only `a` is live, so the group is invisible to the user — Ctrl+Shift+G on
    // `a` must not dissolve what it cannot see.
    const result = ungroupSessionSelection(groups, ['a'], new Set(['a']))
    expect(result.dissolved).toEqual([])
    expect(result.groups).toEqual(groups)
  })

  test('grouping a member of an existing group dissolves that group whole', () => {
    resetSessionGroupIdSerial(0)
    const groups = [group('g1', ['a', 'b', 'c'], 'Suite')]
    const { groups: next, created } = createSessionGroup(groups, ['c', 'd'], {
      idFactory: () => 'g2',
      labelFactory: () => 'Group 2',
    })
    expect(created?.memberIds).toEqual(['c', 'd'])
    expect(next).toEqual([group('g2', ['c', 'd'], 'Group 2')])
  })
})
