import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { collectQuickActionNodeScope } from './quick-action-nodes'

function fixtureNode({
  id,
  parentId,
  children = [],
  type = 'item',
}: {
  id: string
  parentId?: string
  children?: string[]
  type?: string
}) {
  return {
    id,
    type,
    parentId,
    children,
  } as unknown as AnyNode
}

describe('collectQuickActionNodeScope', () => {
  test('includes nested children of a selected node sibling', () => {
    const run = fixtureNode({
      id: 'run',
      children: ['left-base', 'selected-base'],
    })
    const leftBase = fixtureNode({
      id: 'left-base',
      parentId: run.id,
      children: ['expanded-wall'],
    })
    const selectedBase = fixtureNode({ id: 'selected-base', parentId: run.id })
    const expandedWall = fixtureNode({ id: 'expanded-wall', parentId: leftBase.id })
    const nodes = Object.fromEntries(
      [run, leftBase, selectedBase, expandedWall].map((node) => [node.id, node]),
    ) as Record<AnyNodeId, AnyNode>

    const collected = collectQuickActionNodeScope(nodes, selectedBase.id)

    expect(collected?.[expandedWall.id as AnyNodeId]).toBe(expandedWall)
  })

  test('includes other run subtrees when the provider declares level scope', () => {
    const level = fixtureNode({
      id: 'level',
      type: 'level',
      children: ['selected-run', 'other-run'],
    })
    const selectedRun = fixtureNode({
      id: 'selected-run',
      parentId: level.id,
      children: ['selected-base'],
    })
    const selectedBase = fixtureNode({ id: 'selected-base', parentId: selectedRun.id })
    const otherRun = fixtureNode({
      id: 'other-run',
      parentId: level.id,
      children: ['other-base'],
    })
    const otherBase = fixtureNode({
      id: 'other-base',
      parentId: otherRun.id,
      children: ['expanded-wall'],
    })
    const expandedWall = fixtureNode({ id: 'expanded-wall', parentId: otherBase.id })
    const nodes = Object.fromEntries(
      [level, selectedRun, selectedBase, otherRun, otherBase, expandedWall].map((node) => [
        node.id,
        node,
      ]),
    ) as Record<AnyNodeId, AnyNode>

    expect(
      collectQuickActionNodeScope(nodes, selectedBase.id)?.[expandedWall.id as AnyNodeId],
    ).toBeUndefined()
    expect(
      collectQuickActionNodeScope(nodes, selectedBase.id, 'level')?.[expandedWall.id as AnyNodeId],
    ).toBe(expandedWall)
  })
})
