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
import { buildTurbineVentGeometry, turbineVentDefinition } from './index'

test('turbine-vent placement matches its preview, honors grid mode and blocks unsupported drops', async () => {
  const restoreRegistry = nodeRegistry._snapshot()
  if (!nodeRegistry.get('turbine-vent')) registerNode(turbineVentDefinition)
  const savedEditor = useEditor.getState()
  useEditor.setState({ mode: 'build', tool: 'turbine-vent', gridSnapStep: 0.25 })
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
  const { default: Tool } = await turbineVentDefinition.tool!()
  const renderer = await create(<Tool />)
  try {
    const event = {
      node: roof,
      position: [0.13, 3, 3.13] as [number, number, number],
      stopPropagation: () => {},
    }
    await act(async () => emitter.emit('roof:move', event))
    const preview = usePlacementPreview.getState().node
    expect(preview?.type).toBe('turbine-vent')
    if (preview?.type !== 'turbine-vent') throw new Error('Missing turbine-vent preview')
    await act(async () => emitter.emit('roof:click', event))
    const placed = Object.values(useScene.getState().nodes).find(
      (node) => node.type === 'turbine-vent',
    )
    expect(placed).toBeDefined()
    if (placed?.type !== 'turbine-vent') throw new Error('Missing turbine vent')
    expect(preview.position).toEqual(placed.position)
    expect(placed.position[0]).toBe(0.25)
    expect(placed.position[2]).toBe(3.25)
    expect(placed.baseOverhang).toBe(0.05)
    expect(preview.id).not.toBe(placed.id)
    const previewGeometry = buildTurbineVentGeometry(preview)!
    const placedGeometry = buildTurbineVentGeometry(placed)!
    previewGeometry.computeBoundingBox()
    placedGeometry.computeBoundingBox()
    expect(previewGeometry.boundingBox!.equals(placedGeometry.boundingBox!)).toBe(true)
    previewGeometry.dispose()
    placedGeometry.dispose()
    expect(usePlacementPreview.getState().node).toBeNull()
    const outside = { ...event, position: [30, 3, 3] as [number, number, number] }
    await act(async () => emitter.emit('roof:click', outside))
    expect(
      Object.values(useScene.getState().nodes).filter((n) => n.type === 'turbine-vent'),
    ).toHaveLength(1)
    await act(async () =>
      emitter.emit('roof:click', { ...outside, nativeEvent: { altKey: true } as never }),
    )
    expect(
      Object.values(useScene.getState().nodes).filter((n) => n.type === 'turbine-vent'),
    ).toHaveLength(2)
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
