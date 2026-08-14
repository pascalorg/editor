import { describe, expect, test } from 'bun:test'
import { hasTreeNodeComponent } from './tree-node'

describe('site tree node routing', () => {
  test('renders lean-to extensions in the editor tree', () => {
    expect(hasTreeNodeComponent('lean-to-extension')).toBe(true)
  })
})
