import { expect, test } from 'bun:test'
import { DoorNode, sceneRegistry, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import { act, create } from '@react-three/test-renderer'
import DoorRenderer from './renderer'

test('door pose follows live overrides without changing scene data and resets on cancel', async () => {
  const node = DoorNode.parse({ position: [1, 1.05, 0] })
  const originalNodes = useScene.getState().nodes
  useScene.setState({ nodes: { [node.id]: node } })
  const renderer = await create(<DoorRenderer node={node} />)
  try {
    const storedNodes = useScene.getState().nodes
    await act(async () => {
      useLiveNodeOverrides.getState().set(node.id, {
        position: [3, 1.05, 0],
        rotation: [0, Math.PI, 0],
      })
    })
    expect(useScene.getState().nodes).toBe(storedNodes)
    expect(sceneRegistry.nodes.get(node.id)?.position.x).toBe(3)
    expect(sceneRegistry.nodes.get(node.id)?.rotation.y).toBeCloseTo(Math.PI)

    await act(async () => useLiveNodeOverrides.getState().clear(node.id))
    expect(sceneRegistry.nodes.get(node.id)?.position.x).toBe(1)
    expect(sceneRegistry.nodes.get(node.id)?.rotation.y).toBe(0)
  } finally {
    await renderer.unmount()
    useLiveNodeOverrides.getState().clear(node.id)
    useScene.setState({ nodes: originalNodes })
  }
})
