import { describe, expect, test } from 'bun:test'
import { AssemblyNode } from './assembly'

describe('AssemblyNode', () => {
  test('parses a static generated assembly', () => {
    const node = AssemblyNode.parse({
      id: 'assembly_static',
      position: [1, 0, 2],
      children: ['box_child'],
    })

    expect(node.position).toEqual([1, 0, 2])
    expect(node.children).toEqual(['box_child'])
  })

  test('defaults children to an empty array', () => {
    const node = AssemblyNode.parse({ id: 'assembly_empty' })

    expect(node.children).toEqual([])
  })
})
