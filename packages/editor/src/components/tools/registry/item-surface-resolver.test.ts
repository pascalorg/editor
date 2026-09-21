import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import * as core from '@pascal-app/core'
import {
  type AnyNodeId,
  type GridEvent,
  type ItemEvent,
  ItemNode,
  LevelNode,
  nodeRegistry,
  type SurfacePlacement,
  sceneRegistry,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { Group, Vector3 } from 'three'
import { commitFreshPlacementSubtree } from '../../../lib/fresh-planar-placement'
import useEditor from '../../../store/use-editor'
import useInteractionScope from '../../../store/use-interaction-scope'
import { registerHostingTestNode } from '../__fixtures__/hosting'
import { createRegistryItemSurfaceMove } from './item-surface-move'

const level = LevelNode.parse({ id: 'level_resolver' })
const asset = {
  id: 'table',
  name: 'Table',
  category: 'furniture',
  thumbnail: '',
  src: '/table.glb',
  dimensions: [3, 1, 3],
}
const host = ItemNode.parse({
  id: 'item_resolver-host',
  parentId: level.id,
  asset,
  position: [4, 0, 5],
  rotation: [0, 0.6, 0],
})
const child = ItemNode.parse({
  id: 'item_resolver-child',
  parentId: level.id,
  asset,
  position: [1, 0, 2],
  rotation: [0.1, 0.3, 0.2],
  metadata: { isNew: true },
  visible: false,
})
const dimensions: [number, number, number] = [1, 1, 0.5]
const savedRaf = globalThis.requestAnimationFrame
const savedCancelRaf = globalThis.cancelAnimationFrame
let savedNodes: ReturnType<typeof useScene.getState>['nodes']
let savedRoots: AnyNodeId[]
let savedEditor: ReturnType<typeof useEditor.getState>
let savedScope: ReturnType<typeof useInteractionScope.getState>
let restoreRegistry: () => void
let resolver: ReturnType<typeof spyOn<typeof core, 'resolveSurfacePlacement'>>

beforeEach(() => {
  globalThis.requestAnimationFrame = (callback) => {
    callback(0)
    return 0
  }
  globalThis.cancelAnimationFrame = () => {}
  savedEditor = useEditor.getState()
  savedScope = useInteractionScope.getState()
  useInteractionScope.setState({ scope: { kind: 'idle' } })
  useEditor.setState({ mode: 'build', tool: 'item' })
  useEditor.getState().setSnappingMode('item', 'off')
  savedNodes = useScene.getState().nodes
  savedRoots = useScene.getState().rootNodeIds
  restoreRegistry = nodeRegistry._snapshot()
  nodeRegistry._reset()
  registerHostingTestNode({
    kind: 'item',
    schemaVersion: 1,
    schema: ItemNode,
    category: 'furnish',
    defaults: () => ({}),
    capabilities: {
      hostable: { parents: ['level', 'item'], align: 'face' },
      floorPlaced: {},
    },
  })
  useScene.setState({
    nodes: {
      [level.id]: { ...level, children: [host.id, child.id] },
      [host.id]: host,
      [child.id]: child,
    },
    rootNodeIds: [level.id],
  })
  useScene.temporal.getState().clear()
  useScene.temporal.getState().pause()
  const levelMesh = new Group()
  levelMesh.position.set(10, 3, 20)
  levelMesh.rotation.y = 0.4
  const hostMesh = new Group()
  hostMesh.position.set(...host.position)
  hostMesh.rotation.set(...host.rotation)
  levelMesh.add(hostMesh)
  levelMesh.updateMatrixWorld(true)
  sceneRegistry.nodes.set(level.id, levelMesh)
  sceneRegistry.nodes.set(host.id, hostMesh)
  resolver = spyOn(core, 'resolveSurfacePlacement')
})

afterEach(() => {
  resolver.mockRestore()
  useEditor.setState(savedEditor)
  useInteractionScope.setState(savedScope)
  restoreRegistry()
  useLiveTransforms.getState().clear(child.id)
  sceneRegistry.nodes.delete(level.id)
  sceneRegistry.nodes.delete(host.id)
  useScene.setState({ nodes: savedNodes, rootNodeIds: savedRoots })
  useScene.temporal.getState().clear()
  useScene.temporal.getState().resume()
  globalThis.requestAnimationFrame = savedRaf
  globalThis.cancelAnimationFrame = savedCancelRaf
})

function hit(local: [number, number, number] = [0.2, 1, 0.3]): ItemEvent {
  const object = sceneRegistry.nodes.get(host.id)!
  return {
    node: host,
    object,
    normal: [0, 1, 0],
    localPosition: local,
    position: object.localToWorld(new Vector3(...local)).toArray(),
    nativeEvent: {},
    stopPropagation() {},
  } as ItemEvent
}

test('the registry asks the shared resolver with host-local input and keeps the frozen live output', () => {
  const event = hit()
  const session = createRegistryItemSurfaceMove(child)!
  // Captured from resolveItemSurfacePlacement at ad2a57b8 with snapping off.
  const expected: {
    position: [number, number, number]
    worldPosition: [number, number, number]
    rotationY: number
  } = {
    position: [0.20000000000000284, 1, 0.29999999999999716],
    worldPosition: [15.991837444170788, 4, 23.04142809557868],
    rotationY: -0.30000000000000004,
  }
  expect(session.enter(event, dimensions, 0.3)).toEqual(expected)
  expect(resolver).toHaveBeenCalledTimes(1)
  const args = resolver.mock.calls[0]![0]
  expect(args.host).toBe(host)
  expect(args.childKind).toBe(child.type)
  expect(args.childFootprint.size).toEqual(dimensions)
  expect(args.childFootprint.rotationY).toBe(expected!.rotationY)
  expect(args.hit.normalWorldY).toBe(1)
  expect(args.scene.get(host.id)).toBe(useScene.getState().nodes[host.id])
  expect(args.snapScalar).toBeFunction()
  expect(args.checkFootprint).toBe(true)
})

test('a null resolver result leaves the fresh floor draft and live transform untouched', () => {
  resolver.mockReturnValue(null)
  const session = createRegistryItemSurfaceMove(child)!
  const event = hit()
  const stopped = spyOn(event, 'stopPropagation')
  useLiveTransforms.getState().set(child.id, { position: [8, 0, 9], rotation: 0.3 })
  const before = useScene.getState().nodes
  expect(session.enter(event, dimensions, 0.3)).toBeNull()
  expect(resolver).toHaveBeenCalledTimes(1)
  expect(session.hosted).toBe(false)
  expect(session.blocksGrid(event as unknown as GridEvent)).toBe(false)
  expect(stopped).not.toHaveBeenCalled()
  expect(useScene.getState().nodes).toBe(before)
  expect(useLiveTransforms.getState().get(child.id)?.position).toEqual([8, 0, 9])
  session.restore()
  expect(useScene.getState().nodes[child.id]).toBe(child)
})

test('registry entry and subsequent moves keep checking fit; commit uses the accepted stored pose', () => {
  const session = createRegistryItemSurfaceMove(child)!
  const first = session.enter(hit(), dimensions, 0.3)!
  const moved = session.enter(hit([0.7, 1, -0.4]), dimensions, first.rotationY)!
  expect(moved).not.toBeNull()
  const oversized = session.enter(hit(), [4, 1, 4], moved.rotationY)!
  expect(oversized).not.toBeNull()
  const accepted = useScene.getState().nodes[child.id]
  expect(session.enter(hit([2, 1, 0]), [4, 1, 4], moved.rotationY)).toBeNull()
  expect(useScene.getState().nodes[child.id]).toBe(accepted)
  expect(resolver.mock.calls.map(([args]) => args.checkFootprint)).toEqual([true, true, true, true])
  const finalId = commitFreshPlacementSubtree(child.id, { visible: true })!
  expect(useScene.getState().nodes[finalId]).toMatchObject({
    parentId: host.id,
    position: oversized.position,
    rotation: [0.1, oversized.rotationY, 0.2],
  })
  expect(resolver).toHaveBeenCalledTimes(4)
})

test('the mover rejects itself before asking the resolver', () => {
  const session = createRegistryItemSurfaceMove(host)!
  const before = useScene.getState().nodes
  expect(session.enter(hit(), dimensions, 0.6)).toBeNull()
  expect(resolver).not.toHaveBeenCalled()
  expect(useScene.getState().nodes).toBe(before)
})

test('the mover rejects an indirect descendant before asking the resolver', () => {
  const intermediate = ItemNode.parse({ id: 'item_resolver-middle', parentId: child.id, asset })
  useScene.setState({
    nodes: {
      ...useScene.getState().nodes,
      [intermediate.id]: intermediate,
      [host.id]: { ...host, parentId: intermediate.id },
    },
  })
  const session = createRegistryItemSurfaceMove(child)!
  const before = useScene.getState().nodes
  expect(session.enter(hit(), dimensions, 0.3)).toBeNull()
  expect(resolver).not.toHaveBeenCalled()
  expect(useScene.getState().nodes).toBe(before)
})

test.each([
  'host-local',
  'surface-local',
] as const)('writes the resolver pose in its %s child frame', (childFrame) => {
  const placement: SurfacePlacement = {
    position: [0.25, 1.5, -0.75],
    rotationY: 0.4,
    surfaceId: 'test-surface',
    childFrame,
    surfaceLocal: { position: [-0.5, 0, 0.25], rotationY: -0.2, rotation: [0.7, -0.2, 0.8] },
  }
  resolver.mockReturnValue(placement)
  const session = createRegistryItemSurfaceMove(child)!
  const pose = session.enter(hit(), dimensions, 0.3)!
  const expected = childFrame === 'surface-local' ? placement.surfaceLocal! : placement
  expect(pose.position).toEqual([...expected.position])
  expect(pose.rotationY).toBe(expected.rotationY)
  expect(useScene.getState().nodes[child.id]).toMatchObject({
    parentId: host.id,
    position: expected.position,
    rotation:
      childFrame === 'surface-local'
        ? placement.surfaceLocal!.rotation
        : [0.1, placement.rotationY, 0.2],
  })
})

test('non-item events never reach the resolver', () => {
  const session = createRegistryItemSurfaceMove(child)!
  const before = useScene.getState().nodes
  expect(
    session.enter({ ...hit(), node: level } as unknown as ItemEvent, dimensions, 0.3),
  ).toBeNull()
  expect(resolver).not.toHaveBeenCalled()
  expect(useScene.getState().nodes).toBe(before)
})
