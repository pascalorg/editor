import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  type GridEvent,
  getFloorPlacedElevation,
  getFloorPlacedFootprints,
  type ItemEvent,
  ItemNode,
  LevelNode,
  nodeRegistry,
  resolveSupportSlabPatch,
  sceneRegistry,
  spatialGridManager,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import {
  ProceduralItemNode,
  proceduralFootprint,
  shelfRecipe,
} from '@pascal-app/core/procedural-items'
import { Group, Vector3 } from 'three'
import { commitFreshPlacementSubtree } from '../../../lib/fresh-planar-placement'
import { registerHostingTestNode } from '../__fixtures__/hosting'
import {
  createItemSurfaceGridDispatch,
  createItemSurfacePointerArbitration,
  createRegistryItemSurfaceMove,
  resolveItemSurfaceGrab,
} from './item-surface-move'

const originalRaf = globalThis.requestAnimationFrame
const originalCancelRaf = globalThis.cancelAnimationFrame

const dimensions: [number, number, number] = [1, 1, 0.5]
const original = ProceduralItemNode.parse({
  id: 'procedural-item_moving',
  parentId: 'level_surface-move',
  recipe: shelfRecipe,
  position: [1, 0, 2],
  rotation: [0.1, 0.3, 0.2],
  supportSlabId: 'ground',
}) as unknown as AnyNode & {
  position: [number, number, number]
  rotation: [number, number, number]
}
const host = ItemNode.parse({
  id: 'item_surface-move',
  parentId: 'level_surface-move',
  position: [4, 0, 5],
  rotation: [0, 0.6, 0],
  asset: {
    id: 'table',
    name: 'Table',
    category: 'furniture',
    thumbnail: '',
    src: '/table.glb',
    dimensions: [3, 1, 3],
  },
})
let restoreRegistry: () => void
let oldNodes: ReturnType<typeof useScene.getState>['nodes']
let oldRoots: AnyNodeId[]

beforeEach(() => {
  globalThis.requestAnimationFrame = (callback) => {
    callback(0)
    return 0
  }
  globalThis.cancelAnimationFrame = () => {}
  restoreRegistry = nodeRegistry._snapshot()
  oldNodes = useScene.getState().nodes
  oldRoots = useScene.getState().rootNodeIds
  nodeRegistry._reset()
  registerHostingTestNode({
    kind: 'item',
    schemaVersion: 1,
    schema: ItemNode,
    category: 'furnish',
    defaults: () => ({}),
    capabilities: {},
  })
  registerHostingTestNode({
    kind: 'procedural-item',
    schemaVersion: 1,
    schema: ProceduralItemNode,
    category: 'furnish',
    defaults: () => ({}),
    capabilities: {
      hostable: { parents: ['level', 'item'], align: 'face' },
      floorPlaced: {
        applies: (n) => !(n as unknown as ProceduralItemNode).wallId,
        footprint: (n) => proceduralFootprint(n as unknown as ProceduralItemNode),
        collides: true,
      },
    },
  })
  const level = LevelNode.parse({ id: 'level_surface-move', children: [original.id, host.id] })
  useScene.setState({
    nodes: { [level.id]: level, [original.id]: original, [host.id]: host },
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
})

afterEach(() => {
  globalThis.requestAnimationFrame = originalRaf
  globalThis.cancelAnimationFrame = originalCancelRaf
  restoreRegistry()
  useLiveTransforms.getState().clear(original.id)
  for (const id of ['level_surface-move', host.id, 'item_second-host'])
    sceneRegistry.nodes.delete(id)
  useScene.setState({ nodes: oldNodes, rootNodeIds: oldRoots })
  useScene.temporal.getState().clear()
  useScene.temporal.getState().resume()
})

function eventFor(item = host, local: [number, number, number] = [0.2, 1, 0.3]) {
  const mesh = sceneRegistry.nodes.get(item.id)!
  let stopped = false
  const event = {
    node: item,
    object: mesh,
    normal: [0, 1, 0],
    localPosition: local,
    position: mesh.localToWorld(new Vector3(...local)).toArray(),
    stopPropagation: () => {
      stopped = true
    },
    nativeEvent: {},
  } as ItemEvent
  return { event, stopped: () => stopped }
}

describe('registry item-surface move session', () => {
  test('a hidden fresh draft survives effect replay and can still host and commit', async () => {
    useScene.getState().updateNode(original.id, { metadata: { isNew: true }, visible: false })
    const draft = useScene.getState().nodes[original.id]!
    const session = createRegistryItemSurfaceMove(draft)!
    session.restore()
    await Promise.resolve()
    expect(useScene.getState().nodes[draft.id]).toBe(draft)
    const pose = session.enter(eventFor().event, dimensions, 0.3)!
    expect(session.hosted).toBe(true)
    const finalId = commitFreshPlacementSubtree(draft.id, { visible: true })!
    expect(useScene.getState().nodes[finalId]).toMatchObject({
      parentId: host.id,
      position: pose.position,
    })
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })

  test('cleanup restores a fresh hosted draft without deleting it or recording history', async () => {
    useScene.getState().updateNode(original.id, { metadata: { isNew: true }, visible: false })
    const draft = useScene.getState().nodes[original.id]!
    const session = createRegistryItemSurfaceMove(draft)!
    session.enter(eventFor().event, dimensions, 0.3)
    session.restore()
    await Promise.resolve()
    expect(useScene.getState().nodes[original.id]).toEqual(draft)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    expect((useScene.getState().nodes[host.id] as ItemNode).children as string[]).not.toContain(
      original.id,
    )
    expect(
      (useScene.getState().nodes['level_surface-move'] as LevelNode).children as string[],
    ).toContain(original.id)
    expect(session.enter(eventFor().event, dimensions, 0.3)).not.toBeNull()
  })

  test('grid arbitration matches the native pointer event', () => {
    const pointer = createItemSurfacePointerArbitration()
    const native = {}
    expect(pointer.blocksGrid(native)).toBe(false)
    pointer.hit(host.id, native)
    expect(pointer.blocksGrid(native)).toBe(true)
    expect(pointer.blocksGrid({})).toBe(false)
    pointer.clear()
    expect(pointer.blocksGrid(native)).toBe(false)
  })

  test('canvas grid waits for wrapper host dispatch, including spaced moves; an unmatched grid detaches', async () => {
    const session = createRegistryItemSurfaceMove(original)!
    let yaw = 0.3
    let applied = 0
    const dispatch = createItemSurfaceGridDispatch((grid) => {
      applied += 1
      if (!session.blocksGrid(grid)) session.detach(grid.position, yaw)
    })
    for (let move = 0; move < 3; move += 1) {
      const hit = eventFor().event
      const native = {}
      const grid = { position: hit.position, nativeEvent: native } as GridEvent
      hit.nativeEvent = { nativeEvent: native } as ItemEvent['nativeEvent']
      dispatch.schedule(grid)
      const before = applied
      await Promise.resolve()
      expect(applied).toBe(before)
      const pose = session.enter(hit, dimensions, yaw)!
      yaw = pose.rotationY
      await new Promise((resolve) => setTimeout(resolve, 5))
      expect(session.hosted).toBe(true)
      expect(useScene.getState().nodes[original.id]?.parentId).toBe(host.id)
    }
    expect(applied).toBe(3)
    dispatch.schedule({ position: [0, 0, 0], nativeEvent: {} } as GridEvent)
    dispatch.flush()
    expect(session.hosted).toBe(false)
    expect(applied).toBe(4)
    dispatch.schedule({ position: [0, 0, 0], nativeEvent: {} } as GridEvent)
    dispatch.cancel()
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(applied).toBe(4)
  })

  test('grid after a host hit preserves hosting; a real leave immediately detaches', () => {
    const session = createRegistryItemSurfaceMove(original)!
    const hit = eventFor()
    const pose = session.enter(hit.event, dimensions, 0.3)!
    if (!session.blocksGrid(hit.event as unknown as GridEvent))
      session.detach([0, 0, 0], pose.rotationY)
    expect(useScene.getState().nodes[original.id]?.parentId).toBe(host.id)
    expect(
      session.leave({ ...hit.event, node: { ...host, id: 'item_other' } }, pose.rotationY),
    ).toBeNull()
    expect(session.hosted).toBe(true)
    expect(session.leave(hit.event, pose.rotationY)).not.toBeNull()
    expect(session.hosted).toBe(false)
    expect(session.blocksGrid(hit.event as unknown as GridEvent)).toBe(false)
  })

  test('a rejected surface hit permits the paired grid to detach without stopping propagation', () => {
    const session = createRegistryItemSurfaceMove(original)!
    const pose = session.enter(eventFor().event, dimensions, 0.3)!
    const hit = eventFor()
    hit.event.normal = [1, 0, 0]
    expect(session.enter(hit.event, dimensions, pose.rotationY)).toBeNull()
    expect(hit.stopped()).toBe(false)
    expect(session.blocksGrid(hit.event as unknown as GridEvent)).toBe(false)
    session.detach(hit.event.position, pose.rotationY)
    expect(session.hosted).toBe(false)
  })

  test('hosted R/T rotates around the stored local position under a translated and rotated host', () => {
    const session = createRegistryItemSurfaceMove(original)!
    const pose = session.enter(eventFor().event, dimensions, 0.3)!
    const initialPlan = session.planPose(pose.position, pose.rotationY)
    for (const yaw of [pose.rotationY + Math.PI / 4, pose.rotationY]) {
      const rotated = session.rotate(yaw)!
      expect(rotated.position).toEqual(pose.position)
      expect(session.planPose(rotated.position, yaw).position).toEqual(initialPlan.position)
      expect(useScene.getState().nodes[original.id]).toMatchObject({
        parentId: host.id,
        position: pose.position,
        rotation: [0.1, yaw, 0.2],
      })
    }
  })

  test('pure grab math preserves offset on the original host and forgets it on a host switch', () => {
    const first = resolveItemSurfaceGrab(
      { hostId: host.id, start: [0.5, 1, -0.5], anchor: null },
      host.id,
      [0.2, 1, 0.3],
    )
    expect(first.position).toEqual([0.5, 1, -0.5])
    const moved = resolveItemSurfaceGrab(first.grab, host.id, [0.4, 1, 0.6])
    expect(moved.position[0]).toBeCloseTo(0.7)
    expect(moved.position[2]).toBeCloseTo(-0.2)
    const switched = resolveItemSurfaceGrab(moved.grab, 'item_second-host', [1, 1, 2])
    expect(switched).toEqual({ grab: null, position: [1, 1, 2] })
    expect(resolveItemSurfaceGrab(switched.grab, host.id, [0.2, 1, 0.3]).position).toEqual([
      0.2, 1, 0.3,
    ])
  })

  test('moving an existing hosted design preserves its grab until detach, then centers on return', () => {
    useScene
      .getState()
      .updateNode(original.id, { parentId: host.id, position: [0.5, 1, -0.5] } as Partial<AnyNode>)
    const session = createRegistryItemSurfaceMove(useScene.getState().nodes[original.id]!)!
    let pose = session.enter(eventFor().event, dimensions, 0.3)!
    expect(pose.position[0]).toBeCloseTo(0.5)
    expect(pose.position[2]).toBeCloseTo(-0.5)
    pose = session.enter(eventFor(host, [0.4, 1, 0.6]).event, dimensions, pose.rotationY)!
    expect(pose.position[0]).toBeCloseTo(0.7)
    expect(pose.position[2]).toBeCloseTo(-0.2)
    const floor = session.detach(eventFor().event.position, pose.rotationY)!
    pose = session.enter(eventFor().event, dimensions, floor.rotationY)!
    expect(pose.position[0]).toBeCloseTo(0.2)
    expect(pose.position[2]).toBeCloseTo(0.3)
  })

  test('reparents previews, keeps the box in the level frame, and clears floor support and live transforms', () => {
    const session = createRegistryItemSurfaceMove(original)!
    useLiveTransforms.getState().set(original.id, { position: [7, 0, 9], rotation: 0.3 })
    const hit = eventFor()
    const pose = session.enter(hit.event, dimensions, 0.3)!
    expect(hit.stopped()).toBe(true)
    expect(session.hosted).toBe(true)
    expect(useLiveTransforms.getState().get(original.id)).toBeUndefined()
    const live = useScene.getState().nodes[original.id]!
    expect(live.parentId).toBe(host.id)
    expect((useScene.getState().nodes[host.id] as ItemNode).children as string[]).toContain(
      original.id,
    )
    expect((useScene.getState().nodes['level_surface-move'] as LevelNode).children).not.toContain(
      original.id,
    )
    expect(session.worldYaw(pose.rotationY)).toBeCloseTo(0.7)
    const plan = session.planPose(pose.position, pose.rotationY)
    expect(plan.rotationY).toBeCloseTo(0.3)
    expect(plan.position[0]).toBeCloseTo(4 + 0.2 * Math.cos(0.6) + 0.3 * Math.sin(0.6))
    expect(plan.position[1]).toBeCloseTo(1)
    expect(
      getFloorPlacedElevation({
        node: live,
        nodes: useScene.getState().nodes,
        position: pose.position,
      }),
    ).toBe(0)
    expect(
      resolveSupportSlabPatch(live, useScene.getState().nodes, {
        preferredSlabId: 'slab_above',
        pinSupport: true,
      }),
    ).toEqual({ supportSlabId: undefined })
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  })

  test('invalid hosts leave propagation and the scene untouched', () => {
    const session = createRegistryItemSurfaceMove(original)!
    expect(session.enter(eventFor().event, [4, 1, 4], 0.3)).not.toBeNull()
    session.restore()
    const restored = useScene.getState().nodes[original.id]
    const hit = eventFor(host, [2, 1, 0])
    expect(session.enter(hit.event, [4, 1, 4], 0.3)).toBeNull()
    expect(hit.stopped()).toBe(false)
    expect(useScene.getState().nodes[original.id]).toBe(restored)
    expect(
      createRegistryItemSurfaceMove({ ...original, wallId: 'wall_test' } as AnyNode),
    ).toBeNull()
    expect(createRegistryItemSurfaceMove(host)).toBeNull()
  })

  test('moves across and between hosts, then detaches at the level-local cursor without rotating', () => {
    const session = createRegistryItemSurfaceMove(original)!
    let pose = session.enter(eventFor().event, dimensions, 0.3)!
    pose = session.enter(eventFor(host, [0.7, 1, -0.4]).event, dimensions, pose.rotationY)!
    expect(pose.position[0]).toBeCloseTo(0.7)
    const second = {
      ...host,
      id: 'item_second-host',
      rotation: [0, -0.8, 0],
      position: [-2, 0, 1],
      children: [],
    } as ItemNode
    useScene.getState().createNode(second, host.parentId as AnyNodeId)
    const mesh = new Group()
    mesh.rotation.set(...second.rotation)
    mesh.position.set(...second.position)
    sceneRegistry.nodes.get('level_surface-move')!.add(mesh)
    sceneRegistry.nodes.set(second.id, mesh)
    pose = session.enter(eventFor(second).event, dimensions, pose.rotationY)!
    expect(session.worldYaw(pose.rotationY)).toBeCloseTo(0.7)
    const world = sceneRegistry.nodes.get('level_surface-move')!.localToWorld(new Vector3(8, 2, 9))
    const floor = session.detach(world.toArray(), pose.rotationY)!
    expect(floor.position[0]).toBeCloseTo(8)
    expect(floor.position[1]).toBe(0)
    expect(floor.position[2]).toBeCloseTo(9)
    expect(floor.rotationY).toBeCloseTo(0.3)
    expect(session.hosted).toBe(false)
    expect(useScene.getState().nodes[original.id]?.parentId).toBe('level_surface-move')
  })

  test('restores parent and full pose for cancellation, including a drag that starts hosted', () => {
    const session = createRegistryItemSurfaceMove(original)!
    session.enter(eventFor().event, dimensions, 0.3)
    const hosted = useScene.getState().nodes[original.id]!
    const hostedSession = createRegistryItemSurfaceMove(hosted)!
    hostedSession.detach([0, 0, 0], -0.3)
    hostedSession.restore()
    expect(useScene.getState().nodes[original.id]).toEqual(hosted)
    session.restore()
    expect(useScene.getState().nodes[original.id]).toEqual(original)
    expect((useScene.getState().nodes[host.id] as ItemNode).children as string[]).not.toContain(
      original.id,
    )
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  })

  test('restoring before the tracked commit makes hosting one undo step with the original parent and pose', () => {
    const session = createRegistryItemSurfaceMove(original)!
    session.enter(eventFor().event, dimensions, 0.3)
    const final = useScene.getState().nodes[original.id]!
    session.restore()
    useScene.temporal.getState().resume()
    useScene.getState().updateNodes([
      {
        id: original.id,
        data: { ...final, ...resolveSupportSlabPatch(final, useScene.getState().nodes) },
      },
    ])
    useScene.temporal.getState().pause()
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[original.id]).toEqual(original)
    expect((useScene.getState().nodes[host.id] as ItemNode).children as string[]).not.toContain(
      original.id,
    )
    useScene.temporal.getState().redo()
    expect(useScene.getState().nodes[original.id]).toEqual(final)
  })

  test('fresh procedural placements commit directly to a host and undo removes the entire placement', () => {
    useScene.getState().updateNode(original.id, { metadata: { isNew: true } })
    const session = createRegistryItemSurfaceMove(useScene.getState().nodes[original.id]!)!
    const pose = session.enter(eventFor().event, dimensions, 0.3)!
    const finalId = commitFreshPlacementSubtree(original.id, { parentId: host.id, visible: true })!
    expect(finalId).toBeTruthy()
    expect(useScene.getState().nodes[finalId]?.parentId).toBe(host.id)
    expect(useScene.getState().nodes[finalId]).toMatchObject({
      position: pose.position,
      rotation: [0.1, pose.rotationY, 0.2],
    })
    expect((useScene.getState().nodes[host.id] as ItemNode).children as string[]).toContain(finalId)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[finalId]).toBeUndefined()
    expect(useScene.getState().nodes[original.id]).toBeUndefined()
    expect((useScene.getState().nodes[host.id] as ItemNode).children as string[]).toEqual([])
  })

  test.each([
    'floor',
    'same host',
    'floor then host',
  ])('a hosted move to %s commits once and undo restores the original parent and pose', (destination) => {
    const initial = createRegistryItemSurfaceMove(original)!
    const hostedPose = initial.enter(eventFor().event, dimensions, 0.3)!
    const hosted = useScene.getState().nodes[original.id]!
    const session = createRegistryItemSurfaceMove(hosted)!
    let pose: { position: [number, number, number]; rotationY: number } = session.enter(
      eventFor().event,
      dimensions,
      hostedPose.rotationY,
    )!
    if (destination !== 'same host') {
      const world = sceneRegistry.nodes
        .get('level_surface-move')!
        .localToWorld(new Vector3(8, 0, 9))
      pose = session.detach(world.toArray(), pose.rotationY)!
      const detached = useScene.getState().nodes[original.id]!
      expect(
        getFloorPlacedElevation({
          node: detached,
          nodes: useScene.getState().nodes,
          position: pose.position,
          maxElevation: 0,
        }),
      ).toBe(0)
      const footprints = getFloorPlacedFootprints(
        nodeRegistry.get(original.type)!.capabilities.floorPlaced!,
        detached,
        { nodes: useScene.getState().nodes },
      ).map((footprint) => ({ ...footprint, position: footprint.position ?? pose.position }))
      expect(
        spatialGridManager.canPlaceOnFloorFootprints('level_surface-move', footprints, [
          original.id,
        ]).valid,
      ).toBe(true)
    }
    if (destination !== 'floor') {
      pose = session.enter(eventFor(host, [0.6, 1, -0.4]).event, dimensions, pose.rotationY)!
    }
    const final = useScene.getState().nodes[original.id]!
    const patch = {
      ...final,
      ...resolveSupportSlabPatch(final, useScene.getState().nodes, { maxElevation: 0 }),
    }
    session.restore()
    useScene.temporal.getState().resume()
    useScene.getState().updateNodes([{ id: original.id, data: patch }])
    useScene.temporal.getState().pause()
    expect(useScene.getState().nodes[original.id]?.parentId).toBe(
      destination === 'floor' ? 'level_surface-move' : host.id,
    )
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[original.id]).toEqual(hosted)
    expect((useScene.getState().nodes[host.id] as ItemNode).children as string[]).toContain(
      original.id,
    )
    useScene.temporal.getState().redo()
    expect(useScene.getState().nodes[original.id]).toEqual(patch)
  })
})
