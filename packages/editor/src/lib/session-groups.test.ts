import { describe, expect, test } from 'bun:test'
import {
  canCreateSessionGroup,
  createSessionGroup,
  expandSessionGroupMembers,
  nextSessionGroupId,
  pruneSessionGroups,
  removeMembersFromSessionGroups,
  resetSessionGroupIdSerial,
  selectionIntersectsSessionGroup,
  selectionMatchesSessionGroup,
  type SessionSelectionGroup,
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

  test('removeMembersFromSessionGroups prunes weak groups', () => {
    const groups = [group('g1', ['a', 'b', 'c'], 'Suite')]
    expect(removeMembersFromSessionGroups(groups, ['b', 'c'])).toEqual([])
    expect(removeMembersFromSessionGroups(groups, ['c'])).toEqual([
      group('g1', ['a', 'b'], 'Suite'),
    ])
  })

  test('prune and id serial', () => {
    resetSessionGroupIdSerial(0)
    expect(nextSessionGroupId()).toBe('session-group-1')
    expect(
      pruneSessionGroups([group('g1', ['a', 'gone'])], new Set(['a'])),
    ).toEqual([])
    expect(selectionIntersectsSessionGroup([group('g1', ['a', 'b'])], ['b'])).toBe(true)
  })
})
