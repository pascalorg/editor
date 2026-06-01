import { beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, AssemblyNode, BoxNode } from '../../schema'
import useScene from '../use-scene'

describe('node delete actions', () => {
  beforeEach(() => {
    useScene.setState({ nodes: {}, rootNodeIds: [], collections: {} } as never)
    useScene.temporal.getState().clear()
  })

  test('does not delete a child id referenced by a non-owning container', () => {
    const owner = AssemblyNode.parse({ id: 'assembly_owner', children: ['box_shared'] })
    const corruptReference = AssemblyNode.parse({
      id: 'assembly_corrupt',
      children: ['box_shared'],
    })
    const sharedBox = BoxNode.parse({ id: 'box_shared', parentId: owner.id })

    useScene.setState({
      nodes: {
        [owner.id]: owner,
        [corruptReference.id]: corruptReference,
        [sharedBox.id]: sharedBox,
      } as Record<AnyNodeId, AnyNode>,
      rootNodeIds: [owner.id, corruptReference.id] as AnyNodeId[],
      collections: {},
    } as never)

    useScene.getState().deleteNode(corruptReference.id as AnyNodeId)

    expect(useScene.getState().nodes[corruptReference.id as AnyNodeId]).toBeUndefined()
    expect(useScene.getState().nodes[owner.id as AnyNodeId]).toBeDefined()
    expect(useScene.getState().nodes[sharedBox.id as AnyNodeId]).toBeDefined()
  })
})
