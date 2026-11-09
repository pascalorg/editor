import { expect, spyOn, test } from 'bun:test'
import * as core from '@pascal-app/core'
import {
  type AnyNode,
  type ItemEvent,
  ItemNode,
  nodeRegistry,
  registerNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { Group } from 'three'
import { createRegistryItemSurfaceMove } from './item-surface-move'

test('a surface-local provider writes full rotation even when the original rotation was scalar', () => {
  const restoreRegistry = nodeRegistry._snapshot()
  const savedNodes = useScene.getState().nodes
  const savedRaf = globalThis.requestAnimationFrame
  const savedCancelRaf = globalThis.cancelAnimationFrame
  const resolver = spyOn(core, 'resolveSurfacePlacement')
  const asset = {
    id: 'host',
    name: 'Host',
    category: 'furniture',
    thumbnail: '',
    src: '/host.glb',
  }
  const host = ItemNode.parse({ id: 'item_scalar-frame-host', asset })
  const child = {
    ...ItemNode.parse({ id: 'item_scalar-frame-child', asset }),
    rotation: 0.3,
  } as unknown as AnyNode
  try {
    globalThis.requestAnimationFrame = (callback) => {
      callback(0)
      return 0
    }
    globalThis.cancelAnimationFrame = () => {}
    nodeRegistry._reset()
    registerNode({
      kind: 'item',
      schemaVersion: 1,
      schema: ItemNode,
      category: 'furnish',
      defaults: () => ({}),
      capabilities: {
        hostable: { parents: ['item'], align: 'face' },
        floorPlaced: {},
      },
    })
    useScene.setState({ nodes: { [host.id]: host, [child.id]: child } })
    const object = new Group()
    sceneRegistry.nodes.set(host.id, object)
    resolver.mockReturnValue({
      position: [0.25, 1.5, -0.75],
      rotationY: 0.4,
      surfaceId: 'test-surface',
      childFrame: 'surface-local',
      surfaceLocal: { position: [-0.5, 0, 0.25], rotationY: -0.2, rotation: [0.7, -0.2, 0.8] },
    })
    const session = createRegistryItemSurfaceMove(child)!
    expect(
      session.enter(
        {
          node: host,
          object,
          position: [0, 1, 0],
          localPosition: [0, 1, 0],
          normal: [0, 1, 0],
          nativeEvent: {} as ItemEvent['nativeEvent'],
          stopPropagation() {},
        } as ItemEvent,
        [0.5, 1, 0.5],
        0.3,
      ),
    ).not.toBeNull()
    expect(useScene.getState().nodes[child.id]).toMatchObject({
      parentId: host.id,
      position: [-0.5, 0, 0.25],
      rotation: [0.7, -0.2, 0.8],
    })
  } finally {
    resolver.mockRestore()
    restoreRegistry()
    sceneRegistry.nodes.delete(host.id)
    useScene.setState({ nodes: savedNodes })
    globalThis.requestAnimationFrame = savedRaf
    globalThis.cancelAnimationFrame = savedCancelRaf
  }
})
