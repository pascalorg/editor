import { describe, expect, test } from 'bun:test'
import { LeanToExtensionNode } from '@pascal-app/core'
import { buildLeanToExtensionGeometry } from './geometry'

describe('lean-to extension geometry', () => {
  test('builds a placement preview with structure and a roof proxy', () => {
    const node = LeanToExtensionNode.parse({ postCount: 3, span: 4 })
    const group = buildLeanToExtensionGeometry(node)
    const names = group.children.map((child) => child.name)
    expect(names).toContain('lean-to-preview-roof')
    expect(names).toContain('lean-to-ledger')
    expect(names).toContain('lean-to-front-beam')
    expect(names).toContain('lean-to-wall-flashing')
    expect(names.some((name) => name.includes('gutter'))).toBe(false)
    expect(names.some((name) => name.includes('downspout'))).toBe(false)
    expect(names.filter((name) => name.startsWith('lean-to-post-'))).toHaveLength(3)
    expect(
      names.filter((name) => name.startsWith('lean-to-rafter-')).length,
    ).toBeGreaterThanOrEqual(3)
  })

  test('leaves the roof and posts to real child nodes in scene geometry', () => {
    const node = LeanToExtensionNode.parse({ postCount: 3 })
    const group = buildLeanToExtensionGeometry(node, {} as never)
    expect(
      group.children.map((child) => child.name).filter((name) => name.startsWith('lean-to-post-')),
    ).toEqual([])
    expect(group.children.map((child) => child.name)).not.toContain('lean-to-preview-roof')
  })
})
