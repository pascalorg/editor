import { describe, it, expect } from 'bun:test'
import { healSceneCycles } from '../heal-scene-cycles'
import type { AnyNode, AnyNodeId } from '../../schema/types'

describe('Deterministic Hierarchy Cycle & Orphan Healer', () => {
  it('should detect and break 2-node cycle (A -> B -> A) at lexicographically smallest ID', () => {
    const nodes: Record<AnyNodeId, AnyNode> = {
      bldg_b: {
        id: 'bldg_b' as any,
        type: 'building' as any,
        object: 'node' as any,
        parentId: 'bldg_a' as any,
        children: [] as any,
      } as AnyNode,
      bldg_a: {
        id: 'bldg_a' as any,
        type: 'building' as any,
        object: 'node' as any,
        parentId: 'bldg_b' as any,
        children: [] as any,
      } as AnyNode,
    }

    const result = healSceneCycles(nodes, 'site_root' as any)
    expect(result.brokenCycleNodes).toContain('bldg_a' as any)
    expect(result.nodes.bldg_a.parentId).toBe('site_root' as any)
    expect(result.nodes.bldg_b.parentId).toBe('bldg_a' as any)
  })

  it('should detect and break 3-node cycle (A -> B -> C -> A)', () => {
    const nodes: Record<AnyNodeId, AnyNode> = {
      node_c: {
        id: 'node_c' as any,
        type: 'building' as any,
        object: 'node' as any,
        parentId: 'node_b' as any,
        children: [] as any,
      } as AnyNode,
      node_b: {
        id: 'node_b' as any,
        type: 'building' as any,
        object: 'node' as any,
        parentId: 'node_a' as any,
        children: [] as any,
      } as AnyNode,
      node_a: {
        id: 'node_a' as any,
        type: 'building' as any,
        object: 'node' as any,
        parentId: 'node_c' as any,
        children: [] as any,
      } as AnyNode,
    }

    const result = healSceneCycles(nodes, null)
    expect(result.brokenCycleNodes).toContain('node_a' as any)
    expect(result.nodes.node_a.parentId).toBeNull()
  })

  it('should detect and break self-referencing cycle (A -> A)', () => {
    const nodes: Record<AnyNodeId, AnyNode> = {
      node_self: {
        id: 'node_self' as any,
        type: 'building' as any,
        object: 'node' as any,
        parentId: 'node_self' as any,
        children: [] as any,
      } as AnyNode,
    }

    const result = healSceneCycles(nodes, 'site_1' as any)
    expect(result.brokenCycleNodes).toContain('node_self' as any)
    expect(result.nodes.node_self.parentId).toBe('site_1' as any)
  })

  it('should auto-heal orphaned nodes whose parent does not exist', () => {
    const nodes: Record<AnyNodeId, AnyNode> = {
      orphan_1: {
        id: 'orphan_1' as any,
        type: 'wall' as any,
        object: 'node' as any,
        parentId: 'deleted_parent' as any,
        children: [] as any,
      } as AnyNode,
      site_root: {
        id: 'site_root' as any,
        type: 'site' as any,
        object: 'node' as any,
        parentId: null,
        children: [] as any,
      } as AnyNode,
    }

    const result = healSceneCycles(nodes, 'site_root' as any)
    expect(result.orphanedNodesRepaired).toContain('orphan_1' as any)
    expect(result.nodes.orphan_1.parentId).toBe('site_root' as any)
    expect(result.nodes.site_root.children).toContain('orphan_1' as any)
  })

  it('should preserve valid acyclic hierarchy without modifying parentId', () => {
    const nodes: Record<AnyNodeId, AnyNode> = {
      site_1: {
        id: 'site_1' as any,
        type: 'site' as any,
        object: 'node' as any,
        parentId: null,
        children: ['bldg_1'] as any,
      } as AnyNode,
      bldg_1: {
        id: 'bldg_1' as any,
        type: 'building' as any,
        object: 'node' as any,
        parentId: 'site_1' as any,
        children: ['level_1'] as any,
      } as AnyNode,
      level_1: {
        id: 'level_1' as any,
        type: 'level' as any,
        object: 'node' as any,
        parentId: 'bldg_1' as any,
        children: [] as any,
      } as AnyNode,
    }

    const result = healSceneCycles(nodes, 'site_1' as any)
    expect(result.brokenCycleNodes).toHaveLength(0)
    expect(result.orphanedNodesRepaired).toHaveLength(0)
    expect(result.nodes.site_1.children).toEqual(['bldg_1' as any])
    expect(result.nodes.bldg_1.children).toEqual(['level_1' as any])
  })
})
