import { expect, spyOn, test } from 'bun:test'
import {
  BuildingNode,
  createSceneApi,
  emitter,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { RegistryToolProvider, usePlacementPreview } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import * as THREE from 'three'
import { buildSolarPanelGeometry, solarPanelDefinition } from './index'

test('roof hover previews the same full array that clicking creates', async () => {
  const defaults = solarPanelDefinition.defaults()
  const defaultsSpy = spyOn(solarPanelDefinition, 'defaults').mockImplementation(() => ({
    ...defaults,
    rows: 4,
    columns: 5,
  }))
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
  const { default: Tool } = await solarPanelDefinition.tool!()
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
      position: [0, 3, 3] as [number, number, number],
      stopPropagation: () => {},
    }
    await act(async () => emitter.emit('roof:move', event))
    const preview = usePlacementPreview.getState().node
    expect(preview?.type).toBe('solar-panel')
    if (preview?.type !== 'solar-panel') throw new Error('Missing solar preview')
    await act(async () => emitter.emit('roof:click', event))
    const placed = Object.values(useScene.getState().nodes).find(
      (node) => node.type === 'solar-panel',
    )
    expect(placed).toBeDefined()
    if (placed?.type !== 'solar-panel') throw new Error('Missing solar array')
    expect([preview.rows, preview.columns]).toEqual([placed.rows, placed.columns])
    expect(preview.rows * preview.columns).toBe(20)
    expect(preview.id).not.toBe(placed.id)
    const previewGeometry = buildSolarPanelGeometry(preview)!
    const placedGeometry = buildSolarPanelGeometry(placed)!
    previewGeometry.computeBoundingBox()
    placedGeometry.computeBoundingBox()
    expect(previewGeometry.boundingBox!.equals(placedGeometry.boundingBox!)).toBe(true)
    previewGeometry.dispose()
    placedGeometry.dispose()
    expect(usePlacementPreview.getState().node).toBeNull()
  } finally {
    defaultsSpy.mockRestore()
    await renderer.unmount()
    sceneRegistry.nodes.delete(segment.id)
    useScene.setState(savedScene)
    useViewer.getState().setSelection(savedSelection)
    usePlacementPreview.getState().clear()
  }
})
