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

  test('tiles panels on both faces, generates ties + walers on both faces', () => {
    const ctx = { parent: makeWall() } as unknown as GeometryContext
    const group = buildFormworkGeometry(makeNode(), ctx)
    const frontPanels = group.children.filter((c) => c.name.startsWith('panel-front-'))
    const backPanels = group.children.filter((c) => c.name.startsWith('panel-back-'))
    const ties = group.children.filter((c) => c.name.startsWith('tie-'))
    const frontWalers = group.children.filter((c) => c.name.startsWith('waler-front-'))
    const backWalers = group.children.filter((c) => c.name.startsWith('waler-back-'))
    expect(frontPanels.length).toBe(5) // 3m / 0.6m
    expect(backPanels.length).toBe(5)
    expect(ties.length).toBeGreaterThan(0)
    expect(frontWalers.length).toBeGreaterThan(0)
    expect(backWalers.length).toBeGreaterThan(0)
  })

  test('scaffoldRequired false -> no scaffold members', () => {
    const ctx = { parent: makeWall({ scaffoldRequired: false }) } as unknown as GeometryContext
    const group = buildFormworkGeometry(makeNode(), ctx)
    expect(group.children.some((c) => c.name.startsWith('scaffold-'))).toBe(false)
  })

  test('scaffoldRequired true -> scaffold posts/ledgers/braces on both faces', () => {
    const ctx = { parent: makeWall({ scaffoldRequired: true, height: 4 }) } as unknown as GeometryContext
    const group = buildFormworkGeometry(makeNode(), ctx)
    const posts = group.children.filter((c) => c.name.startsWith('scaffold-post-'))
    const ledgers = group.children.filter((c) => c.name.startsWith('scaffold-ledger-'))
    const braces = group.children.filter((c) => c.name.startsWith('scaffold-brace-'))
    expect(posts.some((c) => c.name.includes('front'))).toBe(true)
    expect(posts.some((c) => c.name.includes('back'))).toBe(true)
    expect(ledgers.length).toBeGreaterThan(0)
    expect(braces.length).toBeGreaterThan(0)
  })
})
