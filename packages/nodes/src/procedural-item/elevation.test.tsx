import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  ItemNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  resolveSupportSlabPatch,
  SlabNode,
  sceneRegistry,
  spatialGridManager,
  useLiveTransforms,
  useScene,
  WallNode,
} from '@pascal-app/core'
import {
  ProceduralItemNode,
  proceduralLocalPose,
  radiatorRecipe,
  shelfRecipe,
} from '@pascal-app/core/procedural-items'
import { act, create } from '@react-three/test-renderer'
import { FloorElevationSystem } from '../../../viewer/src/systems/floor-elevation/floor-elevation-system'
import { proceduralItemDefinition } from './definition'
import ProceduralRenderer from './renderer'

const level = LevelNode.parse({ id: 'level_procedural-elevation' })
const slab = SlabNode.parse({
  id: 'slab_procedural-elevation',
  parentId: level.id,
  polygon: [
    [-5, -5],
    [5, -5],
    [5, 5],
    [-5, 5],
  ],
  elevation: 0.6,
})
let restoreRegistry: () => void
let oldNodes: ReturnType<typeof useScene.getState>['nodes']

beforeEach(() => {
  restoreRegistry = nodeRegistry._snapshot()
  oldNodes = useScene.getState().nodes
  registerNode(proceduralItemDefinition)
  spatialGridManager.clear()
  spatialGridManager.handleNodeCreated(slab, level.id)
})
afterEach(() => {
  useLiveTransforms.getState().clearAll()
  spatialGridManager.clear()
  useScene.setState({ nodes: oldNodes })
  restoreRegistry()
})

function install(node: ProceduralItemNode, parent: AnyNode = level) {
  const nodes = Object.fromEntries([level, slab, parent, node].map((n) => [n.id, n])) as Record<
    AnyNodeId,
    AnyNode
  >
  useScene.setState({ nodes })
  return nodes
}
function scene(node: ProceduralItemNode) {
  return (
    <>
      <ProceduralRenderer node={node} />
      <FloorElevationSystem />
    </>
  )
}

test('slab lift survives preview commit, React rebuilds and remount with root yaw intact', async () => {
  const draft = ProceduralItemNode.parse({
    recipe: shelfRecipe,
    parentId: level.id,
    position: [1, 0.1, 2],
    rotation: [0, Math.PI / 3, 0],
  })
  const nodes = install(draft)
  const patch = resolveSupportSlabPatch(draft as unknown as AnyNode, nodes, {
    preferredSlabId: slab.id,
    maxElevation: slab.elevation,
    pinSupport: true,
  })
  expect(patch).toEqual({ supportSlabId: slab.id })
  const node = { ...draft, ...patch }
  install(node)
  useLiveTransforms.getState().set(node.id as AnyNodeId, {
    position: node.position,
    rotation: node.rotation[1],
    supportElevationCap: slab.elevation,
  })
  const renderer = await create(scene(node))
  try {
    await renderer.advanceFrames(1, 1 / 60)
    expect(sceneRegistry.nodes.get(node.id)!.position.y).toBeCloseTo(0.7)
    await act(async () => useLiveTransforms.getState().clear(node.id as AnyNodeId))
    await renderer.advanceFrames(1, 1 / 60)
    expect(sceneRegistry.nodes.get(node.id)!.position.y).toBeCloseTo(0.7)
    expect(sceneRegistry.nodes.get(node.id)!.rotation.y).toBeCloseTo(Math.PI / 3)
    const resized = { ...node, parameters: { width: 2 } }
    install(resized)
    await renderer.update(scene(resized))
    await renderer.advanceFrames(1, 1 / 60)
    expect(sceneRegistry.nodes.get(node.id)!.position.y).toBeCloseTo(0.7)
    expect(useScene.getState().dirtyNodes.has(node.id as AnyNodeId)).toBe(false)
  } finally {
    await renderer.unmount()
  }
  const reloaded = await create(scene(node))
  try {
    await reloaded.advanceFrames(1, 1 / 60)
    expect(sceneRegistry.nodes.get(node.id)!.position.y).toBeCloseTo(0.7)
    expect(node.position[1]).toBe(0.1)
  } finally {
    await reloaded.unmount()
  }
})

test('wall-mounted and item-hosted procedural nodes keep host-local height and drain dirty work', async () => {
  const wall = WallNode.parse({ parentId: level.id, start: [-4, 0], end: [4, 0] })
  const host = ItemNode.parse({
    parentId: level.id,
    asset: {
      id: 'table',
      name: 'Table',
      category: 'furniture',
      src: '/table.glb',
      thumbnail: '',
      dimensions: [4, 1, 4],
    },
  })
  for (const parent of [wall, host]) {
    const node = ProceduralItemNode.parse({
      recipe: parent === wall ? radiatorRecipe : shelfRecipe,
      parentId: parent.id,
      wallId: parent === wall ? wall.id : undefined,
      position: [0, 1.2, 0],
    })
    const nodes = install(node, parent)
    expect(
      resolveSupportSlabPatch(node as unknown as AnyNode, nodes, {
        preferredSlabId: slab.id,
        pinSupport: true,
      }),
    ).toEqual({ supportSlabId: undefined })
    const renderer = await create(scene(node))
    try {
      await renderer.advanceFrames(1, 1 / 60)
      expect(sceneRegistry.nodes.get(node.id)!.position.y).toBeCloseTo(
        proceduralLocalPose(node, nodes).position[1],
      )
      expect(useScene.getState().dirtyNodes.has(node.id as AnyNodeId)).toBe(false)
    } finally {
      await renderer.unmount()
    }
  }
})
