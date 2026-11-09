/**
 * What a move, a Duplicate and a fresh placement promise, whatever the kind, the view or the way
 * the gesture ends:
 * - the drop lands where the preview was;
 * - a committed gesture is one undo step, and undo/redo round-trip the scene with the same ids;
 * - a cancelled or refused gesture writes nothing;
 * - a reload of the committed scene renders the same pose;
 * - tearing down the view that owns a move cancels it rather than committing it elsewhere.
 */
import { expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  getEffectiveNode,
  ItemNode,
  nodeRegistry,
  registerNode,
  ShelfNode,
  subscribeSceneCommits,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { ProceduralItemNode } from '@pascal-app/core/procedural-items'
import {
  applySceneGraphToEditor,
  getMovingNode,
  useEditor,
  usePlacementPreview,
} from '@pascal-app/editor'
import { act } from '@react-three/test-renderer'
import { Vector3 } from 'three'
import {
  duplicate,
  genericHost,
  genericPlanDOM,
  installEditorScene,
  key,
  level,
  lifecycleFixture,
  menuAction,
  panesFor,
  planPointer,
  pointerDispatcher,
  Scene,
  seed,
  select,
  snapshot,
  world,
} from './editor-scene'
import { boxAsset as asset, mount, boxRecipe as recipe, settle } from './harness'

installEditorScene()

const history = () => useScene.temporal.getState()
const created = (before: string) => {
  const original = JSON.parse(before).nodes
  return Object.values(useScene.getState().nodes).filter((node) => !original[node.id])
}
function expectSamePoint(actual: Vector3, expected: Vector3) {
  expect(actual.distanceTo(expected)).toBeLessThan(1e-6)
}
/** The pose a moving node shows right now: stored fields, live overrides and live transforms. */
function livePose(id: AnyNodeId) {
  const node = getEffectiveNode(useScene.getState().nodes[id]!) as AnyNode & {
    position?: number[]
    start?: number[]
    end?: number[]
  }
  const transform = useLiveTransforms.getState().get(id)
  return {
    position: transform?.position ?? node.position,
    start: node.start,
    end: node.end,
  }
}

for (const view of ['3d', '2d'] as const)
  for (const kind of ['item', 'shelf', 'procedural-item'] as const)
    for (const outcome of ['commit', 'Escape'] as const)
      test(`Duplicate ${kind} in ${view}, ${outcome}: ${
        outcome === 'commit'
          ? 'drops where the preview was as one undo step and reloads in place'
          : 'leaves the scene as it was'
      }`, async () => {
        const root =
          kind === 'item'
            ? ItemNode.parse({ parentId: level.id, asset, position: [-2, 0, 0] })
            : kind === 'shelf'
              ? ShelfNode.parse({ parentId: level.id, position: [-2, 0, 0] })
              : ProceduralItemNode.parse({ parentId: level.id, recipe, position: [-2, 0, 0] })
        seed([root])
        select(root, view)
        const before = snapshot()
        const commits: unknown[] = []
        const unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))
        const renderer = await mount(<Scene menu />)
        try {
          await duplicate(renderer)
          // The copy on screen is the one new node (a catalog item's draft replaces the moving
          // node's id as soon as its mover takes over).
          const copy = () => {
            const nodes = created(before)
            expect(nodes).toHaveLength(1)
            return nodes[0]!
          }
          const start = world(copy().id).clone()
          expect(commits).toHaveLength(0)
          expect(history().pastStates).toHaveLength(0)

          const pointer = view === '3d' ? pointerDispatcher() : null
          const target = new Vector3(6, 0, 5)
          if (pointer) await pointer.send(new Vector3(3, 0, 3), 'grid first')
          else await planPointer(3, 3)
          await settle(renderer)
          if (pointer) await pointer.send(target, 'grid first')
          else await planPointer(target.x, target.z)
          await settle(renderer)
          const preview = world(copy().id).clone()
          expect(preview.distanceTo(start)).toBeGreaterThan(1)

          if (outcome === 'Escape') {
            await key('Escape')
            await settle(renderer)
            expect(getMovingNode()).toBeNull()
            expect(snapshot()).toBe(before)
            expect(history().pastStates).toHaveLength(0)
            return
          }
          if (pointer) await pointer.send(target, 'grid first', true)
          else await planPointer(target.x, target.z, true)
          await settle(renderer)
          expect(getMovingNode()).toBeNull()
          const placed = created(before)
          expect(placed.map((node) => node.type)).toEqual([kind])
          expectSamePoint(world(placed[0]!.id), preview)
          expect(commits).toHaveLength(1)
          expect(history().pastStates).toHaveLength(1)

          const after = snapshot()
          await act(async () => history().undo())
          await settle(renderer)
          expect(snapshot()).toBe(before)
          await act(async () => history().redo())
          await settle(renderer)
          expect(snapshot()).toBe(after)

          await act(async () => applySceneGraphToEditor(JSON.parse(after)))
          await settle(renderer)
          expect(created(before).map((node) => node.id)).toEqual([placed[0]!.id])
          expectSamePoint(world(placed[0]!.id), preview)
        } finally {
          unsubscribe()
        }
      })

for (const kind of ['item', 'shelf', 'procedural-item'] as const)
  for (const producer of ['3d', '2d'] as const)
    for (const outcome of ['Escape', 'commit', 'unmount'] as const)
      test(`tearing down the ${producer} view mid-move cancels the ${kind} move; ${outcome} afterwards keeps it in place`, async () => {
        const { root } = lifecycleFixture(kind, true, false)
        usePlacementPreview.getState().clear()
        select(root, producer)
        const before = snapshot()
        const renderer = await mount(<Scene menu panes={{ plan: true, spatial: true }} />)
        await settle(renderer)
        const start = world(root.id).clone()
        await act(async () => menuAction('onMove')!({ stopPropagation() {} }))
        await settle(renderer)
        const pointer = pointerDispatcher()
        if (producer === '3d')
          await pointer.sendFrame([new Vector3(1, 0, 0), new Vector3(4, 0, 4)], 'grid first')
        else {
          await planPointer(1, 0)
          await planPointer(4, 4)
        }
        await settle(renderer)

        await renderer.update(
          <Scene menu panes={{ plan: producer === '3d', spatial: producer === '2d' }} />,
        )
        await settle(renderer)
        expect(snapshot()).toBe(before)
        expectSamePoint(world(root.id), start)
        expect(useLiveTransforms.getState().transforms.size).toBe(0)
        expect(useLiveNodeOverrides.getState().overrides.size).toBe(0)

        if (outcome === 'Escape') await key('Escape')
        else if (outcome === 'commit') {
          if (producer === '3d') {
            await planPointer(6, 5)
            await planPointer(6, 5, true)
          } else {
            await pointer.send(new Vector3(6, 0, 5), 'grid first')
            await pointer.send(new Vector3(6, 0, 5), 'grid first', true)
          }
        } else await renderer.update(<Scene menu panes={{ plan: false, spatial: false }} />)
        await settle(renderer)
        expect(useScene.getState().nodes[root.id]).toMatchObject({ position: root.position })
        expectSamePoint(world(root.id), start)
        expect(usePlacementPreview.getState().node).toBeNull()
        expect(useLiveTransforms.getState().transforms.size).toBe(0)
        expect(useLiveNodeOverrides.getState().overrides.size).toBe(0)
        expect(history().pastStates.length).toBeLessThanOrEqual(1)
        await act(async () => history().undo())
        expect(snapshot()).toBe(before)
      })

for (const kind of ['item', 'fence', 'lean-to-extension', 'spawn', 'plugin'] as const)
  for (const outcome of ['Escape', 'commit', 'unmount'] as const)
    test(`fresh ${kind} placed through the 2D overlay, ${outcome}: ${
      outcome === 'commit'
        ? 'lands at the preview as one undo step'
        : outcome === 'Escape'
          ? 'removes the draft without history'
          : 'keeps the draft and the gesture alive'
    }`, async () => {
      genericPlanDOM()
      const pluginRoot = kind === 'plugin' ? genericHost() : null
      if (pluginRoot) {
        const definition = nodeRegistry.get(pluginRoot.type)!
        registerNode({ ...definition, floorplan: nodeRegistry.get('shelf')!.floorplan } as never)
      }
      const definition = nodeRegistry.get(kind === 'plugin' ? pluginRoot!.type : kind)!
      const root = definition.schema.parse({
        ...definition.defaults(),
        ...(kind === 'item' ? { asset } : {}),
        ...(kind === 'lean-to-extension'
          ? { hostKind: 'freestanding', hostRoofId: 'roof_fixture', hostSlabId: 'slab_fixture' }
          : {}),
        ...(pluginRoot ?? {}),
        parentId: level.id,
        position: [-1, 0, 0],
        metadata: { isNew: true },
      }) as AnyNode
      seed([root])
      usePlacementPreview.getState().clear()
      history().resume()
      select(root, '2d')
      await act(async () => useEditor.getState().setMovingNode(root))
      const renderer = await mount(<Scene panes={panesFor('2d')} />)
      await settle(renderer)
      const initial = livePose(root.id)
      await planPointer(1, 0)
      await planPointer(3, 4)
      await settle(renderer)
      // A kind the overlay previews only as plan geometry keeps its stored pose; it lands under
      // the pointer instead.
      const live = livePose(root.id)
      const preview =
        JSON.stringify(live) === JSON.stringify(initial) ? { position: [3, 0, 4] } : live
      const withoutDraft = Object.keys(useScene.getState().nodes).filter((id) => id !== root.id)

      if (outcome === 'unmount') {
        await renderer.update(<Scene panes={{ plan: false, spatial: false }} />)
        await settle(renderer)
        expect(getMovingNode()?.id).toBe(root.id)
        expect(useScene.getState().nodes[root.id]?.metadata).toEqual({ isNew: true })
        expect(history().pastStates).toHaveLength(0)
        return
      }
      if (outcome === 'Escape') {
        await key('Escape')
        await settle(renderer)
        expect(getMovingNode()).toBeNull()
        expect(Object.keys(useScene.getState().nodes).sort()).toEqual(withoutDraft.sort())
        expect(history().pastStates).toHaveLength(0)
        expect(history().isTracking).toBe(true)
        return
      }
      await planPointer(3, 4, true)
      await settle(renderer)
      expect(getMovingNode()).toBeNull()
      expect(useScene.getState().nodes[root.id]).toBeUndefined()
      const placed = Object.values(useScene.getState().nodes).filter(
        (node) => !withoutDraft.includes(node.id),
      ) as (AnyNode & { position?: number[]; start?: number[]; end?: number[] })[]
      expect(placed.map((node) => node.type)).toEqual([root.type])
      expect(placed[0]!.metadata?.isNew).toBeUndefined()
      for (const [field, value] of Object.entries(preview))
        if (value) expect(placed[0]![field as 'position']).toEqual(value)
      expect(history().pastStates).toHaveLength(1)
      const after = snapshot()
      await act(async () => history().undo())
      expect(Object.keys(useScene.getState().nodes).sort()).toEqual(withoutDraft.sort())
      await act(async () => history().redo())
      expect(snapshot()).toBe(after)
    })
