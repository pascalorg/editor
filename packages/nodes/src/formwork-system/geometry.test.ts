import { describe, expect, test } from 'bun:test'
import type { GeometryContext, WallNode } from '@pascal-app/core'
import { buildFormworkGeometry } from './geometry'
import type { FormworkSystemNode } from './schema'

function makeWall(overrides: Partial<WallNode> = {}): WallNode {
  return {
    object: 'node',
    id: 'wall_test',
    type: 'wall',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    start: [0, 0],
    end: [3, 0],
    thickness: 0.2,
    height: 2.4,
    frontSide: 'unknown',
    backSide: 'unknown',
    formworkType: 'plywood',
    tieSpacing: 0.6,
    walerSpacing: 0.9,
    ...overrides,
  } as WallNode
}

function makeNode(): FormworkSystemNode {
  return {
    object: 'node',
    id: 'formwork-system_test',
    type: 'formwork-system',
    parentId: 'wall_test',
    visible: true,
    metadata: {},
    children: [],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    panelWidth: 0.6,
  }
}

describe('buildFormworkGeometry', () => {
  test('no host wall -> empty group', () => {
    const ctx = { parent: null } as GeometryContext
    const group = buildFormworkGeometry(makeNode(), ctx)
    expect(group.children.length).toBe(0)
  })

  test('formworkType none -> empty group', () => {
    const ctx = { parent: makeWall({ formworkType: 'none' }) } as unknown as GeometryContext
    const group = buildFormworkGeometry(makeNode(), ctx)
    expect(group.children.length).toBe(0)
  })

  test('tiles panels across wall length, generates ties + walers', () => {
    const ctx = { parent: makeWall() } as unknown as GeometryContext
    const group = buildFormworkGeometry(makeNode(), ctx)
    const panels = group.children.filter((c) => c.name.startsWith('panel-'))
    const ties = group.children.filter((c) => c.name.startsWith('tie-'))
    const walers = group.children.filter((c) => c.name.startsWith('waler-'))
    expect(panels.length).toBe(5) // 3m / 0.6m
    expect(ties.length).toBeGreaterThan(0)
    expect(walers.length).toBeGreaterThan(0)
  })
})
