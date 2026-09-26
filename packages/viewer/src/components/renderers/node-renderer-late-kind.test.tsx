import { afterEach, expect, test } from 'bun:test'
import { type AnyNode, nodeRegistry, registerNode, useScene } from '@pascal-app/core'
import { act, create } from '@react-three/test-renderer'
import { z } from 'zod'
import { NodeRenderer } from './node-renderer'

const restoreRegistry = nodeRegistry._snapshot()
const savedScene = useScene.getState()
afterEach(() => {
  restoreRegistry()
  useScene.setState(savedScene)
})

function LateRenderer() {
  return <mesh name="late-kind-mesh" />
}

test('a node whose kind registers after it mounted renders once the kind arrives', async () => {
  const node = {
    id: 'late_1',
    type: 'probe:late',
    object: 'node',
    parentId: null,
  } as unknown as AnyNode
  useScene.setState({ nodes: { [node.id]: node } as never, rootNodeIds: [node.id] as never })
  const renderer = await create(<NodeRenderer nodeId={node.id} />)
  try {
    expect(renderer.scene.findAllByProps({ name: 'late-kind-mesh' })).toHaveLength(0)
    await act(async () => {
      registerNode({
        kind: 'probe:late',
        schemaVersion: 1,
        schema: z.object({ id: z.string(), type: z.literal('probe:late') }),
        capabilities: {},
        renderer: { kind: 'parametric', module: async () => ({ default: LateRenderer }) },
      } as never)
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(renderer.scene.findAllByProps({ name: 'late-kind-mesh' })).toHaveLength(1)
  } finally {
    await renderer.unmount()
  }
})
