import { expect, test } from 'bun:test'
import {
  BuildingNode,
  emitter,
  GutterNode,
  LevelNode,
  nodeRegistry,
  RoofNode,
  RoofSegmentNode,
  registerNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useEditor, usePlacementPreview } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import * as THREE from 'three'
import { downspoutDefinition } from './index'

test('downspout placement creates its outlet atomically and rejects overlap', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: Object.assign(new EventTarget(), {
      requestAnimationFrame: () => 0,
      cancelAnimationFrame: () => {},
    }),
  })
  const restoreRegistry = nodeRegistry._snapshot()
  if (!nodeRegistry.get('downspout')) registerNode(downspoutDefinition)
  const savedEditor = useEditor.getState()
  useEditor.setState({ mode: 'build', tool: 'downspout', gridSnapStep: 0.25 })
  useEditor.getState().setSnappingMode('item', 'grid')
  const savedScene = useScene.getState()
  const savedSelection = useViewer.getState().selection
  const building = BuildingNode.parse({})
  const level = LevelNode.parse({ parentId: building.id })
  const roof = RoofNode.parse({ parentId: level.id })
  const segment = RoofSegmentNode.parse({ parentId: roof.id, width: 20, depth: 20 })
  const gutter = GutterNode.parse({ parentId: segment.id, roofSegmentId: segment.id })
  segment.children = [gutter.id]
  roof.children = [segment.id]
  level.children = [roof.id]
  building.children = [level.id]
  useScene.setState({
    nodes: {
      [building.id]: building,
      [level.id]: level,
      [roof.id]: roof,
      [segment.id]: segment,
      [gutter.id]: gutter,
    },
    rootNodeIds: [building.id],
    dirtyNodes: new Set(),
    readOnly: false,
  })
  useViewer.getState().setSelection({ buildingId: building.id, levelId: level.id })
  sceneRegistry.nodes.set(segment.id, new THREE.Group())
  sceneRegistry.nodes.set(gutter.id, new THREE.Group())
  const { default: Tool } = await downspoutDefinition.tool!()
  const renderer = await create(<Tool />)
  try {
    const event = {
      node: gutter,
      position: [0.13, 3, 3.13] as [number, number, number],
      stopPropagation: () => {},
    }
    await act(async () => emitter.emit('gutter:move', event))
    let writes = 0
    const unsubscribe = useScene.subscribe((state, previous) => {
      if (state.nodes !== previous.nodes) writes++
    })
    await act(async () => emitter.emit('gutter:click', event))
    unsubscribe()
    expect(writes).toBe(1)
    const placed = Object.values(useScene.getState().nodes).find(
      (node) => node.type === 'downspout',
    )
    if (placed?.type !== 'downspout') throw new Error('Missing downspout')
    expect(placed.gutterId).toBe(gutter.id)
    expect(placed.lengthMode).toBe('to-ground')
    const updated = useScene.getState().nodes[gutter.id] as typeof gutter
    expect(updated.outlets).toHaveLength(1)
    expect(updated.outlets[0]!.offset).toBe(0.25)
    expect(placed.outletId).toBe(updated.outlets[0]!.id)
    await act(async () => emitter.emit('gutter:click', { ...event, node: updated }))
    expect(
      Object.values(useScene.getState().nodes).filter((node) => node.type === 'downspout'),
    ).toHaveLength(1)
  } finally {
    restoreRegistry()
    useEditor.setState(savedEditor)
    await renderer.unmount()
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    sceneRegistry.nodes.delete(segment.id)
    sceneRegistry.nodes.delete(gutter.id)
    sceneRegistry.nodes.delete(building.id)
    useScene.setState(savedScene)
    useViewer.getState().setSelection(savedSelection)
    usePlacementPreview.getState().clear()
  }
})
