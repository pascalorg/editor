import { describe, expect, test } from 'bun:test'
import { StructuralGridNode } from '@pascal-app/core'
import {
  collectStructuralGridAxes,
  resolveStructuralGridReference,
  resolveStructuralGridSnap,
} from './coordination'

const vertical = StructuralGridNode.parse({
  id: 'structural-grid_1',
  parentId: 'level_main',
  start: [2, 0],
  end: [2, 8],
  label: '1',
})
const horizontal = StructuralGridNode.parse({
  id: 'structural-grid_a',
  parentId: 'level_main',
  start: [0, 3],
  end: [8, 3],
  label: 'A',
})

describe('structural-grid coordination', () => {
  test('snaps columns to a nearby grid intersection before an individual axis', () => {
    expect(resolveStructuralGridSnap([2.18, 3.12], [vertical, horizontal])).toMatchObject({
      point: [2, 3],
      kind: 'intersection',
      reference: 'A-1',
    })
  })

  test('projects onto one axis when no intersection is within range', () => {
    expect(resolveStructuralGridSnap([2.12, 6], [vertical, horizontal])).toMatchObject({
      point: [2, 6],
      kind: 'line',
      reference: '1',
    })
  })

  test('does not snap beyond the configured distance or past an axis endpoint', () => {
    expect(resolveStructuralGridSnap([2.4, 6], [vertical, horizontal])).toBeNull()
    expect(resolveStructuralGridSnap([2.05, 8.4], [vertical], 0.25)).toBeNull()
  })

  test('derives an associative alphabetic-numeric reference at the column center', () => {
    expect(resolveStructuralGridReference([2, 3], [vertical, horizontal])).toBe('A-1')
    expect(resolveStructuralGridReference([2, 3], [vertical, { ...horizontal, label: 'B' }])).toBe(
      'B-1',
    )
  })

  test('collects only visible axes from the active level', () => {
    const hidden = StructuralGridNode.parse({
      ...horizontal,
      id: 'structural-grid_hidden',
      visible: false,
    })
    const nodes = { [vertical.id]: vertical, [horizontal.id]: horizontal, [hidden.id]: hidden }
    expect(collectStructuralGridAxes(nodes, 'level_main').map((axis) => axis.id)).toEqual([
      vertical.id,
      horizontal.id,
    ])
    expect(collectStructuralGridAxes(nodes, 'level_other')).toEqual([])
  })
})
