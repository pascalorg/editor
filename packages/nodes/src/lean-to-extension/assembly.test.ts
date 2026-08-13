import { describe, expect, test } from 'bun:test'
import { getRoofSegmentVisibleTopBounds, LeanToExtensionNode } from '@pascal-app/core'
import { createLeanToAssembly, isManagedLeanToNode, isManagedLeanToPost } from './assembly'
import { resolveLeanToLayout } from './layout'

describe('lean-to assembly', () => {
  test('composes a standard shed roof, gutter, downspout, and pillar children', () => {
    const leanTo = LeanToExtensionNode.parse({
      postCount: 4,
      postWidth: 0.18,
      postDepth: 0.14,
      span: 4,
      projection: 2.5,
      eaveOverhang: 0.25,
      sideOverhang: 0.15,
    })
    const layout = resolveLeanToLayout(leanTo)
    const assembly = createLeanToAssembly(leanTo)

    expect(assembly.extension.children).toEqual([
      assembly.roof.id,
      ...assembly.posts.map((post) => post.id),
    ])
    expect(assembly.roof.type).toBe('roof')
    expect(assembly.roof.parentId).toBe(leanTo.id)
    expect(assembly.roof.children).toEqual([assembly.segment.id])
    expect(isManagedLeanToNode(assembly.roof, leanTo.id, 'roof')).toBe(true)

    expect(assembly.segment.type).toBe('roof-segment')
    expect(assembly.segment.parentId).toBe(assembly.roof.id)
    expect(assembly.segment.roofType).toBe('shed')
    expect(assembly.segment.position).toEqual([0, layout.lowEdgeHeight, 1.25])
    expect(assembly.segment.width + 2 * assembly.segment.overhang).toBeCloseTo(4.3)
    const roofBounds = getRoofSegmentVisibleTopBounds(assembly.segment)
    expect(assembly.segment.position[2] + roofBounds.minZ).toBeGreaterThanOrEqual(0)
    expect(assembly.segment.children).toEqual([assembly.gutter.id, assembly.downspout.id])

    expect(assembly.gutter.type).toBe('gutter')
    expect(assembly.gutter.parentId).toBe(assembly.segment.id)
    expect(assembly.gutter.roofSegmentId).toBe(assembly.segment.id)
    expect(assembly.gutter.profile).toBe('k-style')
    expect(assembly.gutter.outlets).toHaveLength(1)

    expect(assembly.downspout.type).toBe('downspout')
    expect(assembly.downspout.parentId).toBe(assembly.segment.id)
    expect(assembly.downspout.gutterId).toBe(assembly.gutter.id)
    expect(assembly.downspout.outletId).toBe(assembly.gutter.outlets[0]?.id)
    expect(assembly.downspout.strapStyle).toBe('none')
    expect(assembly.downspout.terminal).toBe('straight')

    expect(assembly.posts).toHaveLength(4)
    for (const [index, post] of assembly.posts.entries()) {
      expect(post.type).toBe('column')
      expect(post.parentId).toBe(leanTo.id)
      expect(post.position).toEqual([layout.postXs[index], 0, leanTo.projection])
      expect(post.height).toBe(layout.postHeight)
      expect(post.width).toBe(0.18)
      expect(post.depth).toBe(0.14)
      expect(isManagedLeanToPost(post, leanTo.id)).toBe(true)
    }
  })
})
