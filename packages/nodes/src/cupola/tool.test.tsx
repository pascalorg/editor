import { expect, test } from 'bun:test'
import {
  BuildingNode,
  createSceneApi,
  emitter,
  LevelNode,
  nodeRegistry,
  RoofNode,
  RoofSegmentNode,
  registerNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { RegistryToolProvider, useEditor, usePlacementPreview } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import * as THREE from 'three'
import { buildCupolaGeometry, cupolaDefinition } from './index'

test('cupola placement matches its preview, honors grid mode and blocks unsupported drops', async () => {
  const restoreRegistry = nodeRegistry._snapshot()
  if (!nodeRegistry.get('cupola')) registerNode(cupolaDefinition)
  const savedEditor = useEditor.getState()
  useEditor.setState({ mode: 'build', tool: 'cupola', gridSnapStep: 0.25 })
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
  const { default: Tool } = await cupolaDefinition.tool!()
  const renderer = await create(
    <RegistryToolProvider
      value={{
        activeLevelId: level.id,
        isCameraDragging: () => false,
        sceneApi: createSceneApi(useScene),
        selectNode: () => {},
        unit: 'metric',
      }}
    >
      <Tool />
    </RegistryToolProvider>,
  )
  try {
    const event = {
      node: roof,
      position: [0.13, 3, 3.13] as [number, number, number],
      stopPropagation: () => {},
    }
    await act(async () => emitter.emit('roof:move', event))
    const preview = usePlacementPreview.getState().node
    expect(preview?.type).toBe('cupola')
    if (preview?.type !== 'cupola') throw new Error('Missing cupola preview')
    await act(async () => emitter.emit('roof:click', event))
    const placed = Object.values(useScene.getState().nodes).find((node) => node.type === 'cupola')
    expect(placed).toBeDefined()
    if (placed?.type !== 'cupola') throw new Error('Missing cupola')
    expect(preview.position).toEqual(placed.position)
    expect(placed.position[0]).toBe(0.25)
    expect(placed.position[2]).toBe(3.25)
    expect(preview.id).not.toBe(placed.id)
    const previewGeometry = buildCupolaGeometry(preview, segment)!
    const placedGeometry = buildCupolaGeometry(placed, segment)!
    previewGeometry.computeBoundingBox()
    placedGeometry.computeBoundingBox()
    expect(previewGeometry.boundingBox!.equals(placedGeometry.boundingBox!)).toBe(true)
    previewGeometry.dispose()
    placedGeometry.dispose()
    expect(usePlacementPreview.getState().node).toBeNull()
    const outside = { ...event, position: [30, 3, 3] as [number, number, number] }
    await act(async () => emitter.emit('roof:click', outside))
    expect(
      Object.values(useScene.getState().nodes).filter((n) => n.type === 'cupola'),
    ).toHaveLength(1)
    await act(async () =>
      emitter.emit('roof:click', { ...outside, nativeEvent: { altKey: true } as never }),
    )
    expect(
      Object.values(useScene.getState().nodes).filter((n) => n.type === 'cupola'),
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
