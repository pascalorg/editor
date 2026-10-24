import { expect, test } from 'bun:test'
import {
  BuildingNode,
  emitter,
  LevelNode,
  nodeRegistry,
  RoofNode,
  RoofSegmentNode,
  registerNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { getMovingNode, useEditor, usePlacementPreview } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import * as THREE from 'three'
import { gutterDefinition } from './index'

test('gutter placement commits a grid-snapped gutter and cancels a move without changing the scene', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: Object.assign(new EventTarget(), {
      requestAnimationFrame: () => 0,
      cancelAnimationFrame: () => {},
    }),
  })
  const restoreRegistry = nodeRegistry._snapshot()
  if (!nodeRegistry.get('gutter')) registerNode(gutterDefinition)
  const savedEditor = useEditor.getState()
  useEditor.setState({ mode: 'build', tool: 'gutter', gridSnapStep: 0.25 })
  useEditor.getState().setSnappingMode('item', 'grid')
  const savedScene = useScene.getState()
  const savedSelection = useViewer.getState().selection
  const building = BuildingNode.parse({})
  const level = LevelNode.parse({ parentId: building.id })
  const roof = RoofNode.parse({ parentId: level.id })
  const segment = RoofSegmentNode.parse({ parentId: roof.id, width: 20, depth: 20 })
  roof.children = [segment.id]
  level.children = [roof.id]
  building.children = [level.id]
  useScene.setState({
    nodes: { [building.id]: building, [level.id]: level, [roof.id]: roof, [segment.id]: segment },
    rootNodeIds: [building.id],
    dirtyNodes: new Set(),
    readOnly: false,
  })
  useViewer.getState().setSelection({ buildingId: building.id, levelId: level.id })
  sceneRegistry.nodes.set(segment.id, new THREE.Group())
  const { default: Tool } = await gutterDefinition.tool!()
  let renderer = await create(<Tool />)
  try {
    const event = {
      node: roof,
      position: [0.13, 3, 3.13] as [number, number, number],
      stopPropagation: () => {},
    }
    await act(async () => emitter.emit('roof:move', event))
    await act(async () => emitter.emit('roof:click', event))
    const placed = Object.values(useScene.getState().nodes).find((node) => node.type === 'gutter')
    expect(placed).toBeDefined()
    if (placed?.type !== 'gutter') throw new Error('Missing gutter')
    expect(placed.position[0]).toBe(0.25)
    expect(placed.position[2]).toBeGreaterThan(10)
    expect(useScene.getState().nodes[segment.id]?.children).toContain(placed.id)
    await renderer.unmount()
    const object = new THREE.Group()
    sceneRegistry.nodes.set(placed.id, object)
    useEditor.getState().setMovingNode(placed)
    const { default: Move } = await gutterDefinition.affordanceTools!.move!()
    renderer = await create(<Move node={placed} />)
    expect(object.visible).toBe(false)
    await act(async () => emitter.emit('tool:cancel'))
    expect(getMovingNode()).toBeNull()
    await renderer.unmount()
    expect(object.visible).toBe(true)
    expect(useScene.getState().nodes[placed.id]).toEqual(placed)
    sceneRegistry.nodes.delete(placed.id)
  } finally {
    restoreRegistry()
    useEditor.setState(savedEditor)
    await renderer.unmount()
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    sceneRegistry.nodes.delete(segment.id)
    sceneRegistry.nodes.delete(building.id)
    useScene.setState(savedScene)
    useViewer.getState().setSelection(savedSelection)
    usePlacementPreview.getState().clear()
  }
})
