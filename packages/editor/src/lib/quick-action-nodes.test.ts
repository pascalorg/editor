import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { collectQuickActionNodeFamily } from './quick-action-nodes'

function fixtureNode({
  id,
  parentId,
  children = [],
}: {
  id: string
  parentId?: string
  children?: string[]
}) {
  return {
    id,
    type: 'item',
    parentId,
    children,
  } as unknown as AnyNode
}

describe('collectQuickActionNodeFamily', () => {
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

    const collected = collectQuickActionNodeFamily(nodes, selectedBase.id)

    expect(collected?.[expandedWall.id as AnyNodeId]).toBe(expandedWall)
  })
})
