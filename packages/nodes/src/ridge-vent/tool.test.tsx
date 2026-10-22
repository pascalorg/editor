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
import { useEditor, usePlacementPreview } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import * as THREE from 'three'
import { buildRidgeVentGeometry, ridgeVentDefinition } from './index'

test('ridge-vent placement matches its preview, honors grid mode and blocks unsupported drops', async () => {
  const restoreRegistry = nodeRegistry._snapshot()
  if (!nodeRegistry.get('ridge-vent')) registerNode(ridgeVentDefinition)
  const savedEditor = useEditor.getState()
  useEditor.setState({ mode: 'build', tool: 'ridge-vent', gridSnapStep: 0.25 })
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
  const { default: Tool } = await ridgeVentDefinition.tool!()
  const renderer = await create(<Tool />)
  try {
    const event = {
      node: roof,
      position: [0.13, 3, 3.13] as [number, number, number],
      stopPropagation: () => {},
    }
    await act(async () => emitter.emit('roof:move', event))
    const preview = usePlacementPreview.getState().node
    expect(preview?.type).toBe('ridge-vent')
    if (preview?.type !== 'ridge-vent') throw new Error('Missing ridge-vent preview')
    await act(async () => emitter.emit('roof:click', event))
    const placed = Object.values(useScene.getState().nodes).find(
      (node) => node.type === 'ridge-vent',
    )
    expect(placed).toBeDefined()
    if (placed?.type !== 'ridge-vent') throw new Error('Missing ridge vent')
    expect(preview.position).toEqual(placed.position)
    expect(placed.position[0]).toBe(0.25)
    expect(placed.position[2]).toBe(0)
    expect(preview.id).not.toBe(placed.id)
    const previewGeometry = buildRidgeVentGeometry(preview, segment)!
    const placedGeometry = buildRidgeVentGeometry(placed, segment)!
    previewGeometry.computeBoundingBox()
    placedGeometry.computeBoundingBox()
    expect(previewGeometry.boundingBox!.equals(placedGeometry.boundingBox!)).toBe(true)
    previewGeometry.dispose()
    placedGeometry.dispose()
    expect(usePlacementPreview.getState().node).toBeNull()
    useScene.setState({
      nodes: { ...useScene.getState().nodes, [segment.id]: { ...segment, roofType: 'flat' } },
    })
    await act(async () => emitter.emit('roof:click', event))
    expect(
      Object.values(useScene.getState().nodes).filter((n) => n.type === 'ridge-vent'),
    ).toHaveLength(1)
  } finally {
    restoreRegistry()
    useEditor.setState(savedEditor)
    await renderer.unmount()
    sceneRegistry.nodes.delete(segment.id)
    useScene.setState(savedScene)
    useViewer.getState().setSelection(savedSelection)
    usePlacementPreview.getState().clear()
  }
})
