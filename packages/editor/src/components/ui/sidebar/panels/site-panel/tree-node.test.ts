import { describe, expect, test } from 'bun:test'
import { getTreeNodeComponent } from './tree-node'

describe('site tree node routing', () => {
  test('renders plugin node kinds through the generic tree row', () => {
    expect(getTreeNodeComponent('lean-to-extension')).toBe(getTreeNodeComponent('plugin-kind'))
  })
})
