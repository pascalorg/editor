import { expect, spyOn, test } from 'bun:test'
import * as Core from '@pascal-app/core'
import {
  type AnyNode,
  type AnyNodeId,
  BlockNode,
  CabinetModuleNode,
  CabinetNode,
  ColumnNode,
  createBoxBlockTopology,
  emitter,
  getEffectiveNode,
  ItemNode,
  MeasurementNode,
  nodeRegistry,
  registerNode,
  ShelfNode,
  sceneRegistry,
  spatialGridManager,
  subscribeSceneCommits,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
  WallNode,
  ZoneNode,
} from '@pascal-app/core'
import { nodeLevelFrame, ProceduralItemNode } from '@pascal-app/core/procedural-items'
import { MoveRegistryNodeTool, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { Component, type ReactNode, StrictMode } from 'react'
import { Euler, Mesh, Vector3 } from 'three'
import gridTableRecipe from '../../../core/src/procedural-items/__fixtures__/grid-table.json'
import { counterRecipe } from '../../../core/src/procedural-items/fixtures'
import { CATALOG_ITEMS } from '../../../editor/src/components/ui/item-catalog/catalog-items'
import {
  createFreshPlacementSubtree,
  duplicatesAsFreshSubtree,
} from '../../../editor/src/lib/fresh-planar-placement'
import { applySceneGraphToEditor } from '../../../editor/src/lib/scene'
import { surfaceAttachmentId } from '../../../editor/src/lib/surface-attachment'
import useInteractionScope, { getMovingNode } from '../../../editor/src/store/use-interaction-scope'
import usePlacementPreview from '../../../editor/src/store/use-placement-preview'
import MoveProceduralItem from '../procedural-item/move-tool'
import {
  duplicate,
  genericHost,
  genericPlanDOM,
  installEditorScene,
  interactionFixture,
  key,
  level,
  lifecycleFixture,
  menuAction,
  namedFixture,
  panesFor,
  planPointer,
  pointerDispatcher,
  Scene,
  seed,
  select,
  site,
  snapshot,
  world,
} from './editor-scene'
import { advance, boxAsset as asset, boxRecipe as recipe, settle } from './harness'

installEditorScene()

for (const view of ['3d', '2d'])
  for (const childless of [false, true])
    for (const outcome of [
      'commit',
      'Escape',
      'unmount',
      'floor',
      ...(view === '3d' ? ['other host'] : []),
    ])
      test(`named external surface ${view} ${childless ? 'childless' : 'subtree'} ${outcome}`, async () => {
        const { host, root, other } = namedFixture(childless)
        select(root, view)
        const before = snapshot()
        const commits: unknown[] = []
        const unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))
        const renderer = await create(<Scene menu />)
        let unmounted = false
        try {
          await duplicate(renderer, () => {
            const draft = useScene.getState().nodes[getMovingNode()!.id]!
            expect(surfaceAttachmentId(draft)).toBe('top')
            expect(world(draft.id).y).toBeCloseTo(2)
          })
          const copy = Object.values(useScene.getState().nodes).find(
            (n) => n.id !== root.id && n.parentId === host.id,
          )!
          expect(copy).toBeDefined()
          expect(surfaceAttachmentId(copy)).toBe('top')
          expect(nodeLevelFrame(copy.id, useScene.getState().nodes).position[1]).toBeCloseTo(2)
          expect(world(copy.id).y).toBeCloseTo(2)
          expect(commits).toHaveLength(0)
          const pointer = view === '3d' ? pointerDispatcher() : null
          const point =
            outcome === 'floor'
              ? new Vector3(10, 0, 4)
              : outcome === 'other host'
                ? new Vector3(7, 2, 0)
                : new Vector3(1, 2, 0)
          if (pointer && (outcome === 'floor' || outcome === 'other host')) {
            await pointer.send(new Vector3(1, 2, 0), 'grid first')
            await settle(renderer)
          }
          if (pointer) await pointer.send(point, 'grid first')
          else await planPointer(point.x, point.z)
          await settle(renderer)
          if (outcome === 'Escape') {
            await key('Escape')
            await settle(renderer)
            expect(snapshot()).toBe(before)
          } else if (outcome === 'unmount') {
            await renderer.unmount()
            unmounted = true
            expect(useScene.getState().nodes[copy.id]).toBeDefined()
            await act(async () => useEditor.getState().setMovingNode(null))
            expect(snapshot()).toBe(before)
          } else {
            const live = getEffectiveNode(useScene.getState().nodes[copy.id]!)
            expect(
              nodeLevelFrame(copy.id, { ...useScene.getState().nodes, [copy.id]: live })
                .position[1],
            ).toBeCloseTo(outcome === 'floor' ? 0 : 2)
            if (pointer) await pointer.send(point, 'grid first', true)
            else await planPointer(point.x, point.z, true)
            await settle(renderer)
            expect(getMovingNode()).toBeNull()
            const placed = Object.values(useScene.getState().nodes).find(
              (n) =>
                n.type === 'item' &&
                n.id !== root.id &&
                n.parentId ===
                  (outcome === 'floor' ? level.id : outcome === 'other host' ? other.id : host.id),
            )!
            expect(placed).toBeDefined()
            expect(surfaceAttachmentId(placed)).toBe(outcome === 'floor' ? null : 'top')
            expect(nodeLevelFrame(placed.id, useScene.getState().nodes).position[1]).toBeCloseTo(
              outcome === 'floor' ? 0 : 2,
            )
            expect(
              (useScene.getState().nodes[host.id] as ProceduralItemNode).attachments[copy.id],
            ).toBeUndefined()
            expect(commits).toHaveLength(1)
            const after = snapshot()
            await act(async () => useScene.temporal.getState().undo())
            await settle(renderer)
            expect(snapshot()).toBe(before)
            await act(async () => useScene.temporal.getState().redo())
            await settle(renderer)
            expect(snapshot()).toBe(after)
          }
        } finally {
          unsubscribe()
          if (!unmounted) await renderer.unmount()
        }
      })
for (const mover of ['catalog', 'registry'] as const)
  for (const route of [
    'shelf',
    'cabinet',
    'item',
    'generated',
    'generic',
    ...(mover === 'catalog' ? ['face'] : []),
  ])
    for (const targetRelation of [
      'descendant',
      ...((mover === 'catalog' && route === 'item') || (mover === 'registry' && route === 'shelf')
        ? ['self']
        : []),
    ])
      test(`cycle rejection ${mover} ${route} via mounted Duplicate and ${targetRelation} pointer hit`, async () => {
        const root =
          mover === 'catalog'
            ? ItemNode.parse({
                parentId: level.id,
                asset: { ...asset, ...(route === 'face' ? { attachTo: 'wall-side' } : {}) },
              })
            : ShelfNode.parse({ parentId: level.id, style: 'bookshelf' })
        const descendant =
          route === 'shelf'
            ? ShelfNode.parse({ parentId: root.id, style: 'bookshelf', width: 2, depth: 1 })
            : route === 'cabinet'
              ? CabinetNode.parse({ parentId: root.id, withCountertop: true })
              : route === 'item'
                ? ItemNode.parse({ parentId: root.id, asset })
                : route === 'generated'
                  ? ProceduralItemNode.parse({
                      parentId: root.id,
                      recipe: {
                        ...recipe,
                        surfaces: [
                          { id: 'top', label: 'Top', position: [0, 0.2, 0], size: [1, 1] },
                        ],
                      },
                    })
                  : route === 'face'
                    ? BlockNode.parse({
                        parentId: root.id,
                        topology: createBoxBlockTopology(2, 2, 2),
                      })
                    : { ...genericHost(true), parentId: root.id }
        const module =
          route === 'cabinet'
            ? CabinetModuleNode.parse({
                ...nodeRegistry.get('cabinet-module')!.defaults(),
                parentId: descendant.id,
                width: 1,
                depth: 0.65,
                stack: [{ id: 'door', type: 'door', height: 0.8 }],
              })
            : null
        descendant.position = [3, 0, 0]
        seed([root, descendant, ...(module ? [module] : [])])
        select(root)
        const renderer = await create(<Scene menu />)
        let writes: ReturnType<typeof spyOn> | undefined
        const invalid: string[] = []
        const eventIds: string[] = []
        const observe = (event: { node: AnyNode }) => eventIds.push(event.node.id)
        const channel =
          route === 'generic' || route === 'generated' || route === 'face'
            ? 'node:enter'
            : `${route}:enter`
        emitter.on(channel as never, observe as never)
        try {
          const copy = await duplicate(renderer)
          const target =
            targetRelation === 'self'
              ? useScene.getState().nodes[copy.id]!
              : useScene.getState().nodes[copy.children[0]!]!
          const targets = new Set([copy.id, target.id, ...target.children])
          const update = useScene.getState().updateNodes
          // Capture an attempted cycle before it can hang renderer/store ancestor walks.
          writes = spyOn(useScene.getState(), 'updateNodes').mockImplementation((updates) => {
            if (
              updates.some(
                (u) => u.id === copy.id && u.data.parentId && targets.has(u.data.parentId),
              )
            ) {
              invalid.push(...updates.filter((u) => u.id === copy.id).map((u) => u.data.parentId!))
              return
            }
            update(updates)
          })
          sceneRegistry.nodes.get(root.id)?.traverse((o) => {
            o.raycast = () => {}
          })
          const targetMesh = sceneRegistry.nodes.get(target.id)!
          // A queued hit can precede per-frame draft raycast suppression.
          targetMesh.traverse((o) => {
            if ((o as Mesh).isMesh) o.raycast = Mesh.prototype.raycast
          })
          const local =
            route === 'shelf'
              ? new Vector3(0.1, 1.85, 0.1)
              : route === 'cabinet'
                ? new Vector3(0.2, 0.92, 0.1)
                : route === 'generic'
                  ? new Vector3(0.1, 1, 0.1)
                  : route === 'face'
                    ? new Vector3(0.2, 1, 1)
                    : new Vector3(0, 0.2, 0)
          const point = targetMesh.localToWorld(local)
          const pointer = pointerDispatcher(route === 'face')
          await pointer.send(point, 'host first')
          expect(eventIds).toContain(target.id)
          expect(invalid).toEqual([])
          expect(useScene.getState().nodes[copy.id]!.parentId).toBe(root.parentId)
        } finally {
          writes?.mockRestore()
          emitter.off(channel as never, observe as never)
          await renderer.unmount()
        }
      })
test('registry owns conditional subtree policy, including plugin kinds', () => {
  for (const kind of ['item', 'shelf', 'procedural-item'])
    expect(nodeRegistry.get(kind)!.capabilities.duplicable).toEqual({ subtree: 'with-children' })
  const host = genericHost()
  const def = nodeRegistry.get(host.type)!
  def.capabilities.duplicable = { subtree: 'with-children' }
  expect(duplicatesAsFreshSubtree(host)).toBe(false)
  expect(duplicatesAsFreshSubtree({ ...host, children: ['item_child'] } as AnyNode)).toBe(true)
  for (const kind of ['cabinet', 'column', 'block']) {
    const definition = nodeRegistry.get(kind)!
    expect(duplicatesAsFreshSubtree(definition.schema.parse(definition.defaults()))).toBe(true)
  }
})
test('ordinary shelf move with 40 items caches descendant traversal between pointer ticks', async () => {
  const root = ShelfNode.parse({ parentId: level.id, width: 3, style: 'bookshelf' })
  const items = Array.from({ length: 40 }, (_, i) =>
    ItemNode.parse({
      parentId: root.id,
      asset,
      position: [(i % 10) / 4 - 1, 0.05 + Math.floor(i / 10) * 0.6, 0],
    }),
  )
  seed([root, ...items])
  select(root, '2d')
  const renderer = await create(<Scene menu />)
  const counts: number[] = []
  try {
    await act(async () => useEditor.getState().setMovingNode(useScene.getState().nodes[root.id]!))
    await settle(renderer)
    const committed = useScene.getState().nodes
    let reads = 0
    const nodes = new Proxy(committed, {
      get(target, key, receiver) {
        if (typeof key === 'string' && key in target) reads++
        return Reflect.get(target, key, receiver)
      },
    })
    const def = nodeRegistry.get('shelf')!
    for (let tick = 0; tick < 6; tick++) {
      await planPointer(5 + tick / 10, 3)
      await settle(renderer)
      expect(useScene.getState().nodes).toBe(committed)
      reads = 0
      const ids =
        def.floorplanAffectedIds?.({
          nodeId: root.id,
          node: root,
          nodes,
          liveTransforms: useLiveTransforms.getState().transforms,
          liveOverrides: useLiveNodeOverrides.getState().overrides,
        }) ?? []
      counts.push(reads)
      expect(ids.length).toBe(def.floorplanAffectedIds ? 40 : 0)
    }
    console.log(`ordinary shelf 40: descendant reads per pointer tick ${counts.join(', ')}`)
    expect(counts.slice(1)).toEqual([0, 0, 0, 0, 0])
    const extra = ItemNode.parse({ parentId: root.id, asset })
    const changed = {
      ...committed,
      [extra.id]: extra,
      [root.id]: { ...committed[root.id], children: [...items.map((n) => n.id), extra.id] },
    } as typeof committed
    if (def.floorplanAffectedIds)
      expect(
        def.floorplanAffectedIds({
          nodeId: root.id,
          node: changed[root.id]!,
          nodes: changed,
          liveTransforms: new Map(),
          liveOverrides: new Map(),
        }),
      ).toContain(extra.id)
  } finally {
    await renderer.unmount()
  }
})
for (const view of ['3d', '2d'])
  test(`Strict Mode ${view} keeps one subtree through view unmount until interaction end`, async () => {
    const { root, host } = namedFixture(false)
    select(root, view)
    const before = snapshot()
    const commits: unknown[] = []
    const unsubscribe = subscribeSceneCommits((c) => commits.push(c))
    const changes = spyOn(useScene.getState(), 'applyNodeChanges')
    const renderer = await create(
      <StrictMode>
        <Scene menu />
      </StrictMode>,
    )
    try {
      const copy = await duplicate(renderer)
      expect(useScene.getState().nodes[copy.id]).toBeDefined()
      expect(copy.children).toHaveLength(1)
      expect(
        changes.mock.calls.filter(([batch]) =>
          batch.create?.some((entry) => entry.node.id === copy.id),
        ).length,
      ).toBe(1)
      expect(useScene.getState().nodes[copy.children[0]!]?.parentId).toBe(copy.id)
      expect((useScene.getState().nodes[host.id] as ProceduralItemNode).attachments[copy.id]).toBe(
        'top',
      )
      expect(world(copy.id).y).toBeCloseTo(2)
      if (view === '3d') await pointerDispatcher().send(new Vector3(1, 2, 0), 'grid first')
      else await planPointer(1, 0)
      await settle(renderer)
    } finally {
      await renderer.unmount()
      expect(getMovingNode()).not.toBeNull()
      await act(async () => useEditor.getState().setMovingNode(null))
      unsubscribe()
      changes.mockRestore()
    }
    expect(snapshot()).toBe(before)
    expect(commits).toHaveLength(0)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  })
for (const view of ['3d', '2d'])
  for (const hostKind of ['wall', 'block', ...(view === '3d' ? ['block-side'] : [])])
    test(`external ${hostKind} bookkeeping and original references ${view} through Duplicate and pointer commit`, async () => {
      const host =
        hostKind === 'wall'
          ? WallNode.parse({ parentId: level.id, start: [-2, 0], end: [2, 0], height: 3 })
          : BlockNode.parse({ parentId: level.id, topology: createBoxBlockTopology(4, 3, 2) })
      const root = ItemNode.parse({
        parentId: host.id,
        position: hostKind === 'wall' ? [1, 0.8, 0] : [-1, 0.8, 0],
        asset: { ...asset, ...(hostKind !== 'block' ? { attachTo: 'wall-side' } : {}) },
        side: 'front',
        ...(hostKind === 'wall'
          ? { wallId: host.id }
          : { blockFaceId: hostKind === 'block-side' ? 'f-front' : 'f-top' }),
      })
      const leaf = ItemNode.parse({ parentId: root.id, asset, position: [0, 0.2, 0] })
      const measurement = MeasurementNode.parse({
        parentId: level.id,
        measurement: {
          kind: 'distance',
          points: [
            {
              kind: 'feature',
              reference: { nodeId: root.id, featureId: 'center' },
              fallback: [0, 0, 0],
            },
            [2, 0, 0],
          ],
        },
      })
      const zone = ZoneNode.parse({
        parentId: level.id,
        name: 'Original grouping',
        polygon: [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
        ],
        metadata: { nodeIds: [root.id, leaf.id] },
      })
      seed([host, root, leaf, measurement, zone])
      if (host.type === 'wall') spatialGridManager.handleNodeCreated(host, level.id)
      useScene.setState({
        collections: {
          collection_original: {
            id: 'collection_original',
            name: 'Original',
            nodeIds: [root.id, leaf.id],
            controlNodeId: root.id,
          },
        },
      })
      select(root, view)
      const before = snapshot()
      const references = () =>
        JSON.stringify({
          measurement: useScene.getState().nodes[measurement.id],
          zone: useScene.getState().nodes[zone.id],
          collections: useScene.getState().collections,
        })
      const originals = references()
      const renderer = await create(<Scene menu />)
      try {
        const copy = await duplicate(renderer)
        expect(useScene.getState().nodes[copy.id]?.children).toHaveLength(1)
        expect(useScene.getState().nodes[host.id]?.children).toEqual([root.id, copy.id])
        expect(references()).toBe(originals)
        const childId = (useScene.getState().nodes[copy.id] as ItemNode).children[0]!
        const pointer = view === '3d' ? pointerDispatcher(hostKind !== 'block') : null
        const point =
          hostKind === 'wall'
            ? new Vector3(1, 1, 0.1)
            : hostKind === 'block-side'
              ? new Vector3(0.7, 1, 1)
              : new Vector3(0.7, 3, 0)
        if (pointer) await pointer.send(point, 'host first')
        else await planPointer(1, hostKind === 'wall' ? 0 : 1)
        await settle(renderer)
        expect(
          world(childId).distanceTo(
            sceneRegistry.nodes.get(copy.id)!.localToWorld(new Vector3(...leaf.position)),
          ),
        ).toBeLessThan(1e-6)
        if (pointer) await pointer.send(point, 'host first', true)
        else await planPointer(1, hostKind === 'wall' ? 0 : 1, true)
        await settle(renderer)
        expect(getMovingNode()).toBeNull()
        const placed = Object.values(useScene.getState().nodes).find(
          (n) => n.type === 'item' && n.id !== root.id && n.parentId === host.id,
        ) as ItemNode
        expect(placed.children).toHaveLength(1)
        expect(useScene.getState().nodes[host.id]?.children).toEqual([root.id, placed.id])
        expect(references()).toBe(originals)
        const after = snapshot()
        await act(async () => useScene.temporal.getState().undo())
        await settle(renderer)
        expect(snapshot()).toBe(before)
        expect(references()).toBe(originals)
        await act(async () => useScene.temporal.getState().redo())
        await settle(renderer)
        expect(snapshot()).toBe(after)
        expect(references()).toBe(originals)
      } finally {
        await renderer.unmount()
      }
    })
for (const kind of ['item', 'cabinet'])
  test(`abandonment probe ${kind}`, async () => {
    const root =
      kind === 'item'
        ? ItemNode.parse({ parentId: level.id, asset })
        : CabinetNode.parse({ ...nodeRegistry.get('cabinet')!.defaults(), parentId: level.id })
    const child = CabinetModuleNode.parse({
      ...nodeRegistry.get('cabinet-module')!.defaults(),
      parentId: root.id,
    })
    seed([root, ...(kind === 'cabinet' ? [child] : [])])
    select(root)
    const originalIds = new Set(Object.keys(useScene.getState().nodes))
    const renderer = await create(<Scene menu />)
    await duplicate(renderer)
    await pointerDispatcher().send(new Vector3(6, 0, 5), 'grid first')
    await settle(renderer)
    const report = (stage: string) =>
      console.log(
        `abandonment ${kind} ${stage}: ${
          Object.values(useScene.getState().nodes)
            .filter((n) => !originalIds.has(n.id))
            .map((n) => `${n.type}:${JSON.stringify(n.metadata)}`)
            .join(', ') || 'none'
        }`,
      )
    report('preview')
    await renderer.update(<Scene menu panes={{ plan: false, spatial: false }} />)
    await settle(renderer)
    report('unmount')
    expect(
      Object.values(useScene.getState().nodes).filter((n) => !originalIds.has(n.id)),
    ).toHaveLength(kind === 'cabinet' ? 2 : 0)
    await act(async () => useEditor.getState().armToolMode({ mode: 'build', tool: 'wall' }))
    await act(async () => useViewer.getState().setSelection({ selectedIds: [root.id] }))
    report('switch and selection')
    await key('Escape')
    report('Escape after unmount')
    const raw = structuredClone(useScene.getState().nodes)
    await act(async () => useScene.getState().setScene(raw, [site.id]))
    report('raw reload')
    expect(
      Object.values(useScene.getState().nodes).filter((n) => !originalIds.has(n.id)),
    ).toHaveLength(0)
    await renderer.unmount()
  })

for (const kind of ['item', 'shelf', 'procedural-item'])
  for (const childless of [false, true]) {
    for (const named of kind === 'shelf' ? [false] : [false, true])
      for (const owner of ['3d', '2d'])
        test(`pane teardown ${owner} owns ${kind} ${childless ? 'childless' : 'subtree'} named=${named}`, async () => {
          const { root, host } = lifecycleFixture(kind, childless, named)
          select(root, owner)
          const before = snapshot()
          const renderer = await create(<Scene menu panes={{ plan: true, spatial: true }} />)
          try {
            const moving = await duplicate(renderer)
            const copy =
              useScene.getState().nodes[moving.id] ??
              Object.values(useScene.getState().nodes).find(
                (n) => n.type === root.type && n.id !== root.id && n.metadata?.isTransient,
              )!
            const pointer = owner === '3d' ? pointerDispatcher() : null
            if (pointer) await pointer.send(new Vector3(0.5, 2, 0), 'grid first')
            else await planPointer(0.5, 0)
            await settle(renderer)
            const pose = world(copy.id).clone()
            await act(async () => {
              for (const type of ['pointermove', 'pointerup']) {
                const event = Object.assign(new Event(type), {
                  clientX: 50,
                  clientY: 50,
                  button: 0,
                })
                Object.defineProperty(event, 'target', {
                  value: { closest: () => ({ tagName: 'BUTTON' }) },
                })
                window.dispatchEvent(event)
              }
            })
            expect(getMovingNode()?.id).toBe(moving.id)
            await renderer.update(
              <Scene menu panes={{ plan: owner === '2d', spatial: owner === '3d' }} />,
            )
            await settle(renderer)
            expect(getMovingNode()?.id).toBe(moving.id)
            expect(useScene.getState().nodes[copy.id]).toBeDefined()
            expect(surfaceAttachmentId(useScene.getState().nodes[copy.id]!)).toBe(
              kind === 'shelf' || !named ? null : 'top',
            )
            if (childless && !named) {
              const mainPose =
                kind === 'item' ? [-1, 0, 0] : owner === '3d' ? [0, 0, 1] : [0.5, 0, 0]
              expect(world(copy.id).toArray()).toEqual(mainPose)
            } else expect(world(copy.id).distanceTo(pose)).toBeLessThan(1e-6)
            if (pointer) await pointer.send(new Vector3(1, 2, 0), 'grid first')
            else await planPointer(1, 0)
            await settle(renderer)
            expect(world(copy.id).x).not.toBeCloseTo(pose.x)
            if (pointer) await pointer.send(new Vector3(1, 2, 0), 'grid first', true)
            else await planPointer(1, 0, true)
            await settle(renderer)
            expect(getMovingNode()).toBeNull()
            const placed = Object.values(useScene.getState().nodes).find(
              (n) =>
                n.id !== root.id &&
                n.id !== host.id &&
                n.type === root.type &&
                n.parentId === root.parentId,
            )!
            expect(placed.children).toHaveLength(childless ? 0 : 1)
            expect(surfaceAttachmentId(placed)).toBe(kind === 'shelf' || !named ? null : 'top')
            const after = snapshot()
            await act(async () => useScene.temporal.getState().undo())
            expect(snapshot()).toBe(before)
            await act(async () => useScene.temporal.getState().redo())
            expect(snapshot()).toBe(after)
          } finally {
            await renderer.unmount()
          }
        })
    for (const strict of [false, true])
      test(`abandoned named draft ${kind} ${childless ? 'childless' : 'subtree'} strict=${strict}`, async () => {
        const { root, host } = lifecycleFixture(kind, childless)
        select(root)
        const renderer = await create(
          strict ? (
            <StrictMode>
              <Scene menu />
            </StrictMode>
          ) : (
            <Scene menu />
          ),
        )
        let copy: AnyNode
        try {
          copy = await duplicate(renderer)
          expect(surfaceAttachmentId(useScene.getState().nodes[copy.id]!)).toBe(
            kind === 'shelf' ? null : 'top',
          )
          expect(world(copy.id).y).toBeCloseTo(kind === 'shelf' ? 0 : 2)
          await pointerDispatcher().send(new Vector3(1, 2, 0), 'grid first')
          await settle(renderer)
        } finally {
          await renderer.unmount()
        }
        await advance(0)
        if (!childless || kind !== 'item') expect(useScene.getState().nodes[copy!.id]).toBeDefined()
        await act(async () => useEditor.getState().setMovingNode(null))
        expect((useScene.getState().nodes[host.id] as ProceduralItemNode).attachments).toEqual(
          kind === 'shelf' ? {} : { [root.id]: 'top' },
        )
        expect(useScene.temporal.getState().pastStates).toHaveLength(0)
        if (childless && kind === 'shelf')
          expect(useScene.getState().nodes[copy!.id]?.metadata?.isNew).toBe(true)
        else expect(useScene.getState().nodes[copy!.id]).toBeUndefined()
        for (const id of copy!.children) expect(useScene.getState().nodes[id]).toBeUndefined()
      })
    for (const view of ['3d', '2d'])
      test(`explicit cancellation ${view} ${kind} childless=${childless}`, async () => {
        const { root, host } = lifecycleFixture(kind, childless)
        select(root, view)
        const before = snapshot()
        const renderer = await create(<Scene menu />)
        try {
          await duplicate(renderer)
          if (view === '3d') await pointerDispatcher().send(new Vector3(1, 2, 0), 'grid first')
          else await planPointer(1, 0)
          await settle(renderer)
          await key('Escape')
          await settle(renderer)
          expect(getMovingNode()).toBeNull()
          expect(snapshot()).toBe(before)
          expect((useScene.getState().nodes[host.id] as ProceduralItemNode).attachments).toEqual(
            kind === 'shelf' ? {} : { [root.id]: 'top' },
          )
        } finally {
          await renderer.unmount()
        }
      })
  }

// Split view mounts both movers for a 3D-started move, and the 2D overlay pauses history for
// the whole gesture too. The two co-own that pause, so the 3D drop still records one step.
test('split view item 3d drop records one undo step', async () => {
  const { root } = lifecycleFixture('item', true, false)
  select(root)
  const before = snapshot()
  const renderer = await create(<Scene menu panes={{ plan: true, spatial: true }} />)
  try {
    await settle(renderer)
    await act(async () => menuAction('onMove')!({ stopPropagation() {} }))
    await settle(renderer)
    const pointer = pointerDispatcher()
    await pointer.send(new Vector3(6, 0, 5), 'grid first')
    await settle(renderer)
    await pointer.send(new Vector3(6, 0, 5), 'grid first', true)
    await settle(renderer)
    expect(getMovingNode()).toBeNull()
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    const after = snapshot()
    expect(after).not.toBe(before)
    await act(async () => useScene.temporal.getState().undo())
    expect(snapshot()).toBe(before)
    await act(async () => useScene.temporal.getState().redo())
    expect(snapshot()).toBe(after)
  } finally {
    await renderer.unmount()
  }
})

for (const kind of ['procedural-item', 'shelf', 'cabinet', 'column', 'block'])
  for (const strict of [false, true])
    test(`registry abandonment deletes ${kind} strict=${strict} before real reload`, async () => {
      const root =
        kind === 'procedural-item'
          ? lifecycleFixture(kind, false).root
          : kind === 'shelf'
            ? ShelfNode.parse({ parentId: level.id })
            : kind === 'cabinet'
              ? CabinetNode.parse({ ...nodeRegistry.get(kind)!.defaults(), parentId: level.id })
              : kind === 'column'
                ? ColumnNode.parse({ parentId: level.id })
                : BlockNode.parse({
                    parentId: level.id,
                    topology: createBoxBlockTopology(1, 1, 1),
                  })
      if (kind !== 'procedural-item') {
        const child =
          kind === 'cabinet'
            ? CabinetModuleNode.parse({
                ...nodeRegistry.get('cabinet-module')!.defaults(),
                parentId: root.id,
              })
            : ItemNode.parse({ parentId: root.id, asset, position: [0, 0.2, 0] })
        seed([root, child])
      }
      select(root)
      const before = JSON.parse(snapshot())
      const renderer = await create(
        strict ? (
          <StrictMode>
            <Scene menu />
          </StrictMode>
        ) : (
          <Scene menu />
        ),
      )
      let ids: AnyNodeId[] = []
      try {
        // Blocks are duplicated through preset placement; their production menu has no Duplicate action.
        let copy: AnyNode
        if (kind === 'block') {
          await act(async () => {
            useScene.temporal.getState().pause()
            const id = createFreshPlacementSubtree(root.id)!
            copy = useScene.getState().nodes[id]!
            useEditor.getState().setMovingNode(copy)
          })
          await settle(renderer)
        } else copy = await duplicate(renderer)
        ids = [copy!.id, ...copy!.children] as AnyNodeId[]
        expect(ids).toHaveLength(2)
        for (const id of ids) expect(useScene.getState().nodes[id]).toBeDefined()
        await pointerDispatcher().send(new Vector3(6, 0, 5), 'grid first')
        await settle(renderer)
      } finally {
        await renderer.unmount()
      }
      for (const id of ids) expect(useScene.getState().nodes[id]).toBeDefined()
      await act(async () => useEditor.getState().setMovingNode(null))
      for (const id of ids) expect(useScene.getState().nodes[id]).toBeUndefined()
      expect(JSON.parse(snapshot())).toEqual(before)
      await act(async () => applySceneGraphToEditor(JSON.parse(snapshot())))
      const reloaded = await create(<Scene />)
      try {
        await settle(reloaded)
        for (const id of ids) {
          expect(useScene.getState().nodes[id]).toBeUndefined()
          expect(sceneRegistry.nodes.has(id)).toBe(false)
        }
      } finally {
        await reloaded.unmount()
      }
    })

class SetupBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {}
  render() {
    return this.state.failed ? null : this.props.children
  }
}
for (const route of ['item', 'item-events', 'registry', '2d'])
  test(`failed ${route} setup cannot strand the interaction draft`, async () => {
    const { root } = lifecycleFixture(route.startsWith('item') ? 'item' : 'procedural-item', false)
    select(root, route === '2d' ? '2d' : '3d')
    const reported: unknown[] = []
    const report = spyOn(globalThis, 'reportError').mockImplementation((error) =>
      reported.push(error),
    )
    const renderer = await create(
      <SetupBoundary>
        <Scene menu panes={{ plan: false, spatial: false }} />
      </SetupBoundary>,
    )
    const copy = await duplicate(renderer)
    const target = route === 'item' ? usePlacementPreview.getState() : window
    const method = route === 'item' ? 'set' : 'addEventListener'
    const original = (target as any)[method].bind(target)
    const setup = spyOn(target as any, method).mockImplementation((...args: any[]) => {
      if (route === 'item' || args[0] === 'pointerup')
        throw new Error('injected mover setup failure')
      return original(...args)
    })
    const errors = spyOn(console, 'error').mockImplementation(() => {})
    const listeners = spyOn(emitter, 'on')
    try {
      await renderer.update(
        <SetupBoundary>
          <Scene menu panes={{ plan: route === '2d', spatial: route !== '2d' }} />
        </SetupBoundary>,
      )
      await renderer.unmount()
      expect(reported).toHaveLength(1)
      expect(useScene.getState().nodes[copy.id]).toBeDefined()
      await act(async () => useEditor.getState().setMovingNode(null))
      expect(useScene.getState().nodes[copy.id]).toBeUndefined()
    } finally {
      for (const [event, handler] of listeners.mock.calls) emitter.off(event, handler)
      listeners.mockRestore()
      report.mockRestore()
      setup.mockRestore()
      errors.mockRestore()
    }
  })

for (const strict of [false, true]) {
  for (const scenario of ['cabinet-handoff', 'named-replacement'])
    test(`interaction lifetime audit ${scenario} strict=${strict}`, async () => {
      const { root } = interactionFixture(
        scenario === 'cabinet-handoff' ? 'cabinet' : 'procedural-item',
      )
      select(root)
      const before = snapshot()
      const tree = (view: string) =>
        strict ? (
          <StrictMode>
            <Scene menu panes={panesFor(view)} />
          </StrictMode>
        ) : (
          <Scene menu panes={panesFor(view)} />
        )
      const renderer = await create(tree(scenario === 'cabinet-handoff' ? 'split' : '3d'))
      try {
        const copy = await duplicate(renderer)
        await pointerDispatcher().send(new Vector3(1, 2, 0), 'grid first')
        await settle(renderer)
        const live = structuredClone(useScene.getState().nodes[copy.id])
        await renderer.update(tree('2d'))
        await settle(renderer)
        expect(getMovingNode()?.id).toBe(copy.id)
        expect(useScene.getState().nodes[copy.id]).toEqual(live)
        for (const id of copy.children) expect(useScene.getState().nodes[id]).toBeDefined()
        if (scenario === 'named-replacement')
          expect(surfaceAttachmentId(useScene.getState().nodes[copy.id]!)).toBe('top')
        await planPointer(6, 5)
        await planPointer(6, 5, true)
        await settle(renderer)
        expect(getMovingNode()).toBeNull()
        const after = snapshot()
        const originalIds = new Set(Object.keys(JSON.parse(before).nodes))
        const created = Object.values(useScene.getState().nodes).filter(
          (n) => !originalIds.has(n.id),
        )
        expect(created).toHaveLength(2)
        expect(useScene.temporal.getState().pastStates).toHaveLength(1)
        await act(async () => useScene.temporal.getState().undo())
        expect(snapshot()).toBe(before)
        await act(async () => useScene.temporal.getState().redo())
        expect(snapshot()).toBe(after)
      } finally {
        await renderer.unmount()
      }
    })
  for (const kind of ['item', 'shelf', 'procedural-item', 'cabinet'])
    for (const terminalView of ['3d', '2d'])
      for (const outcome of ['commit', 'Escape', 'tool', 'end'])
        test(`interaction lifetime cycling ${kind} ${terminalView} ${outcome} strict=${strict}`, async () => {
          const { root } = interactionFixture(kind)
          select(root)
          const before = snapshot()
          const tree = (view: string, key = 'editor') =>
            strict ? (
              <StrictMode>
                <Scene key={key} menu panes={panesFor(view)} />
              </StrictMode>
            ) : (
              <Scene key={key} menu panes={panesFor(view)} />
            )
          const renderer = await create(tree('3d'))
          try {
            const copy = await duplicate(renderer)
            for (const view of [
              '2d',
              'split',
              '3d',
              'split',
              '2d',
              '3d',
              '2d',
              'split',
              terminalView,
            ]) {
              await renderer.update(tree(view))
              await settle(renderer)
              expect(getMovingNode()?.id).toBe(copy.id)
              expect(useScene.getState().nodes[copy.id]).toBeDefined()
              expect(useScene.getState().nodes[copy.children[0]!]?.parentId).toBe(copy.id)
            }
            // A whole editor remount leaves the interaction owner and scene intact.
            await renderer.update(tree(terminalView, 'replacement-editor'))
            await settle(renderer)
            expect(useScene.getState().nodes[copy.id]).toBeDefined()
            const pointer = pointerDispatcher()
            if (terminalView === '3d') {
              await pointer.send(new Vector3(1, 2, 0), 'grid first')
              await settle(renderer)
              await pointer.send(new Vector3(6, 0, 5), 'grid first')
            } else await planPointer(6, 5)
            await settle(renderer)
            if (outcome === 'commit') {
              if (terminalView === '3d')
                await pointer.send(new Vector3(6, 0, 5), 'grid first', true)
              else await planPointer(6, 5, true)
            } else if (outcome === 'Escape') await key('Escape')
            else if (outcome === 'tool') await key('p')
            else await act(async () => useEditor.getState().setMovingNode(null))
            await settle(renderer)
            await advance(20)
            expect(getMovingNode()).toBeNull()
            if (outcome === 'commit') {
              expect(usePlacementPreview.getState().node?.id).not.toBe(copy.id)
              for (const id of [copy.id, ...copy.children] as AnyNodeId[]) {
                expect(useLiveTransforms.getState().transforms.has(id)).toBe(false)
                expect(useLiveNodeOverrides.getState().overrides.has(id)).toBe(false)
              }
              const ids = new Set(Object.keys(JSON.parse(before).nodes))
              const copies = Object.values(useScene.getState().nodes).filter((n) => !ids.has(n.id))
              expect(copies).toHaveLength(2)
              for (const n of copies) expect(n.metadata?.isNew).not.toBe(true)
              const committed = snapshot()
              await renderer.update(tree(terminalView, 'after-commit'))
              await settle(renderer)
              expect(snapshot()).toBe(committed)
              expect(useScene.temporal.getState().pastStates).toHaveLength(1)
              await act(async () => useScene.temporal.getState().undo())
              expect(snapshot()).toBe(before)
              await act(async () => useScene.temporal.getState().redo())
              expect(snapshot()).toBe(committed)
            } else {
              expect(snapshot()).toBe(before)
              expect(useScene.temporal.getState().pastStates).toHaveLength(0)
            }
          } finally {
            await renderer.unmount()
          }
        })
}

for (const strict of [false, true])
  for (const kind of ['shelf', 'cabinet', 'procedural-item'])
    for (const outcome of ['commit', 'Escape'])
      test(`interaction lifetime two editor instances ${kind} ${outcome} strict=${strict}`, async () => {
        const { root } = interactionFixture(kind)
        select(root)
        const before = snapshot()
        const tree = (view: string) =>
          strict ? (
            <StrictMode>
              <Scene menu panes={panesFor(view)} />
            </StrictMode>
          ) : (
            <Scene menu panes={panesFor(view)} />
          )
        const first = await create(tree('3d'))
        const copy = await duplicate(first)
        const second = await create(tree('2d'))
        try {
          await settle(second)
          await first.unmount()
          expect(useScene.getState().nodes[copy.id]).toBeDefined()
          expect(surfaceAttachmentId(useScene.getState().nodes[copy.id]!)).toBe(
            kind === 'procedural-item' ? 'top' : null,
          )
          await planPointer(6, 5)
          if (outcome === 'commit') await planPointer(6, 5, true)
          else await key('Escape')
          await settle(second)
          expect(getMovingNode()).toBeNull()
          if (outcome === 'Escape') expect(snapshot()).toBe(before)
          else {
            const original = JSON.parse(before).nodes
            expect(
              Object.values(useScene.getState().nodes).filter((n) => !original[n.id]),
            ).toHaveLength(2)
            await act(async () => useScene.temporal.getState().undo())
            expect(snapshot()).toBe(before)
          }
        } finally {
          await second.unmount()
        }
      })

for (const view of ['3d', '2d'])
  for (const kind of ['item', 'procedural-item'])
    for (const childless of [true, false])
      test(`review bot occupied commit ${view} ${kind} childless=${childless}`, async () => {
        const { root, host } = lifecycleFixture(kind, childless)
        select(root, view)
        const before = snapshot()
        const renderer = await create(<Scene menu />)
        try {
          const copy = await duplicate(renderer)
          const pointer = view === '3d' ? pointerDispatcher() : null
          const send = async (x: number, click = false) => {
            if (pointer) await pointer.send(new Vector3(x, 2, 0), 'grid first', click)
            else await planPointer(x, 0, click)
            await settle(renderer)
          }
          // A release at the source pose must not finalize the overlapping copy.
          if (!pointer) await send(-1)
          await send(-1, true)
          expect(getMovingNode()?.id).toBe(copy.id)
          expect(useScene.getState().nodes[copy.id]).toBeDefined()
          expect(surfaceAttachmentId(useScene.getState().nodes[copy.id]!)).toBe('top')
          for (const id of copy.children) expect(useScene.getState().nodes[id]).toBeDefined()
          expect(useScene.temporal.getState().pastStates).toHaveLength(0)
          await send(1)
          if (!pointer) {
            const lastValidPose = getEffectiveNode(useScene.getState().nodes[copy.id]!).position
            await send(-1)
            await send(-1, true)
            expect(getMovingNode()?.id).toBe(copy.id)
            expect(getEffectiveNode(useScene.getState().nodes[copy.id]!).position).toEqual(
              lastValidPose,
            )
            await send(1)
          }
          // Validation must also observe occupancy acquired after the last pointer tick.
          const obstacle = ItemNode.parse({ parentId: host.id, asset, position: [1, 0, 0] })
          const tracking = useScene.temporal.getState().isTracking
          useScene.temporal.getState().pause()
          useScene.getState().applyNodeChanges({
            create: [{ node: obstacle }],
            update: [
              {
                id: host.id,
                data: {
                  attachments: {
                    ...(useScene.getState().nodes[host.id] as ProceduralItemNode).attachments,
                    [obstacle.id]: 'top',
                  },
                },
              },
            ],
          })
          if (tracking) useScene.temporal.getState().resume()
          const beforeRefusal = snapshot()
          await send(1, true)
          expect(snapshot()).toBe(beforeRefusal)
          expect(getMovingNode()?.id).toBe(copy.id)
          expect(useScene.getState().nodes[copy.id]).toBeDefined()
          expect(surfaceAttachmentId(useScene.getState().nodes[copy.id]!)).toBe('top')
          const attachments = {
            ...(useScene.getState().nodes[host.id] as ProceduralItemNode).attachments,
          }
          delete attachments[obstacle.id]
          useScene.temporal.getState().pause()
          useScene.getState().applyNodeChanges({
            delete: [obstacle.id],
            update: [{ id: host.id, data: { attachments } }],
          })
          if (tracking) useScene.temporal.getState().resume()
          await send(0.5)
          await send(0.5, true)
          expect(getMovingNode()).toBeNull()
          for (const id of [copy.id, ...copy.children])
            expect(useScene.getState().dirtyNodes.has(id as AnyNodeId)).toBe(false)
          expect(useScene.temporal.getState().pastStates).toHaveLength(1)
          const placed = snapshot()
          await act(async () => useScene.temporal.getState().undo())
          expect(snapshot()).toBe(before)
          await act(async () => useScene.temporal.getState().redo())
          expect(snapshot()).toBe(placed)
        } finally {
          await renderer.unmount()
        }
      })

for (const kind of ['item', 'procedural-item'])
  for (const childless of [false, true])
    test(`review bot surface shrinks before release ${kind} childless=${childless}`, async () => {
      const { root, host } = lifecycleFixture(kind, childless)
      select(root, '2d')
      const renderer = await create(<Scene menu />)
      try {
        const copy = await duplicate(renderer)
        await planPointer(1.5, 0)
        const tracking = useScene.temporal.getState().isTracking
        useScene.temporal.getState().pause()
        useScene.getState().updateNode(host.id, {
          recipe: {
            ...host.recipe,
            surfaces: [{ id: 'top', label: 'Top', position: [0, 2, 0], size: [2.5, 4] }],
          },
        })
        if (tracking) useScene.temporal.getState().resume()
        const before = snapshot()
        await planPointer(1.5, 0, true)
        await settle(renderer)
        expect(snapshot()).toBe(before)
        expect(getMovingNode()?.id).toBe(copy.id)
        expect(useScene.temporal.getState().pastStates).toHaveLength(0)
        await planPointer(0.5, 0)
        await planPointer(0.5, 0, true)
        await settle(renderer)
        expect(getMovingNode()).toBeNull()
        expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      } finally {
        await renderer.unmount()
      }
    })

for (const strict of [false, true])
  for (const kind of ['item', 'shelf', 'procedural-item', 'cabinet'])
    for (const pending of [false, true])
      for (const outcome of ['commit', 'replace'])
        test(`review bot repeat begin ${kind} pending=${pending} ${outcome} strict=${strict}`, async () => {
          const { root } = interactionFixture(kind)
          select(root)
          const before = snapshot()
          const tree = (view: string, key = 'editor') => {
            const scene = (
              <Scene
                key={key}
                menu
                panes={view === 'none' ? { plan: false, spatial: false } : panesFor(view)}
              />
            )
            return strict ? <StrictMode>{scene}</StrictMode> : scene
          }
          const renderer = await create(tree(pending ? 'none' : '3d'))
          try {
            // The pending case re-arms inside the menu gesture, before effects adopt it.
            await settle(renderer)
            await act(async () => {
              menuAction()!({ stopPropagation() {} })
              if (pending) {
                const initial = useInteractionScope.getState()
                useEditor.getState().setMovingNode(getMovingNode())
                expect(useInteractionScope.getState().gesture).toBe(initial.gesture)
                expect(useInteractionScope.getState().pendingSubtree).toBe(initial.pendingSubtree)
              }
            })
            await settle(renderer)
            const copy = getMovingNode()!
            const gesture = useInteractionScope.getState().gesture
            await act(async () => useEditor.getState().setMovingNode(copy))
            expect(useInteractionScope.getState().gesture).toBe(gesture)
            expect(useScene.getState().nodes[copy.id]).toBeDefined()
            await renderer.update(tree('2d', 'replay'))
            await settle(renderer)
            await act(async () =>
              useInteractionScope.getState().begin({
                kind: pending ? 'moving' : 'placing',
                node: copy,
                nodeId: copy.id,
                nodeType: copy.type,
                view: '2d',
                pressDrag: false,
                driver: 'move-tool',
              }),
            )
            expect(useInteractionScope.getState().gesture).toBe(gesture)
            expect(useInteractionScope.getState().adoptSubtree(copy.id)).toBe(true)
            for (const id of copy.children) expect(useScene.getState().nodes[id]).toBeDefined()
            if (outcome === 'replace') {
              await act(async () => useEditor.getState().setMovingNode(root))
              expect(useScene.getState().nodes[copy.id]).toBeUndefined()
              for (const id of copy.children) expect(useScene.getState().nodes[id]).toBeUndefined()
              await act(async () => useEditor.getState().setMovingNode(null))
              expect(snapshot()).toBe(before)
              expect(useScene.temporal.getState().pastStates).toHaveLength(0)
            } else {
              await planPointer(6, 5)
              await planPointer(6, 5, true)
              await settle(renderer)
              expect(getMovingNode()).toBeNull()
              expect(useScene.temporal.getState().pastStates).toHaveLength(1)
              const after = snapshot()
              await act(async () => useScene.temporal.getState().undo())
              expect(snapshot()).toBe(before)
              await act(async () => useScene.temporal.getState().redo())
              expect(snapshot()).toBe(after)
            }
          } finally {
            await renderer.unmount()
          }
        })

for (const view of ['3d', '2d'])
  for (const kind of ['item', 'procedural-item', ...(view === '2d' ? ['cabinet'] : [])])
    test(`audit7 subscriber error rolls back ${view} ${kind}`, async () => {
      const { root } = interactionFixture(kind)
      select(root, view)
      const listeners = spyOn(window, 'addEventListener')
      const renderer = await create(<Scene menu />)
      let unsubscribe = () => {}
      try {
        const copy = await duplicate(renderer)
        if (view === '3d') await pointerDispatcher().send(new Vector3(1, 2, 0), 'grid first')
        else await planPointer(kind === 'cabinet' ? 6 : 1, 0)
        await settle(renderer)
        const before = useScene.getState()
        const graph = snapshot()
        const scope = useInteractionScope.getState()
        const history = useScene.temporal.getState()
        const fault = new Error('injected post-publication scene subscriber failure')
        unsubscribe = useScene.subscribe((scene) => {
          if (!scene.nodes[copy.id]) throw fault
        })
        let caught: unknown
        await act(async () => {
          try {
            // Invoke the mounted event callback directly so EventTarget cannot defer the throw.
            if (view === '2d') {
              const handler = listeners.mock.calls
                .filter(([type]) => type === 'pointerup')
                .at(-1)![1]
              ;(handler as (event: PointerEvent) => void)({
                button: 0,
                clientX: 1,
                clientY: 0,
              } as PointerEvent)
            } else
              emitter.emit(kind === 'item' ? 'procedural-item:click' : 'grid:click', {
                node: useScene.getState().nodes[root.parentId!],
                stopPropagation() {},
                position: [1, 2, 0],
                localPosition: [1, 2, 0],
                nativeEvent: { button: 0, stopPropagation() {}, preventDefault() {} },
              } as never)
          } catch (error) {
            caught = error
          }
        })
        expect(snapshot()).toBe(graph)
        expect(useScene.getState().nodes).toBe(before.nodes)
        expect(useScene.temporal.getState().pastStates).toEqual(history.pastStates)
        expect(useScene.temporal.getState().futureStates).toEqual(history.futureStates)
        expect(useInteractionScope.getState().ownedSubtree).toBe(scope.ownedSubtree)
        expect(getMovingNode()?.id).toBe(copy.id)
        expect(caught).toBe(fault)
        unsubscribe()
        if (view === '3d') await pointerDispatcher().send(new Vector3(1, 2, 0), 'grid first', true)
        else await planPointer(1, 0, true)
        await settle(renderer)
        expect(getMovingNode()).toBeNull()
        expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      } finally {
        unsubscribe()
        listeners.mockRestore()
        await renderer.unmount()
      }
    })

for (const view of ['2d', '3d'])
  for (const kind of ['item', 'procedural-item'])
    for (const refusal of view === '2d' ? ['occupied', 'shrunk'] : ['occupied'])
      for (const check of view === '2d' ? ['unchanged', 'feedback'] : ['unchanged'])
        test(`audit7 unregistered preset ${view} ${kind} ${refusal} ${check}`, async () => {
          const { root, host } = lifecycleFixture(kind, false)
          genericPlanDOM()
          const indicators: any[] = []
          const createElement = document.createElementNS.bind(document)
          const elements = spyOn(document, 'createElementNS').mockImplementation(
            (...args: any[]) => {
              const element = createElement(...(args as [string, string]))
              const attributes: Record<string, string> = {}
              Object.assign(element, {
                setAttribute: (key: string, value: string) => {
                  attributes[key] = value
                },
                attributes,
              })
              indicators.push(element)
              return element
            },
          )
          useScene.getState().updateNode(root.id, { metadata: { isNew: true } })
          select(root, view)
          useEditor.getState().setMovingNode(useScene.getState().nodes[root.id]!)
          const renderer = await create(<Scene />)
          try {
            await settle(renderer)
            const pointer = view === '3d' ? pointerDispatcher() : null
            if (pointer) await pointer.send(new Vector3(1.5, 2, 0), 'grid first')
            else await planPointer(1.5, 0)
            await settle(renderer)
            useScene.temporal.getState().pause()
            if (refusal === 'shrunk')
              useScene.getState().updateNode(host.id, {
                recipe: {
                  ...host.recipe,
                  surfaces: [{ id: 'top', label: 'Top', position: [0, 2, 0], size: [2.5, 4] }],
                },
              })
            else {
              const obstacle = ItemNode.parse({ parentId: host.id, asset, position: [1.5, 0, 0] })
              useScene.getState().applyNodeChanges({
                create: [{ node: obstacle }],
                update: [
                  {
                    id: host.id,
                    data: {
                      attachments: {
                        ...(useScene.getState().nodes[host.id] as ProceduralItemNode).attachments,
                        [obstacle.id]: 'top',
                      },
                    },
                  },
                ],
              })
            }
            const before = snapshot()
            const node = useScene.getState().nodes[root.id]
            if (pointer) await pointer.send(new Vector3(1.5, 2, 0), 'grid first', true)
            else await planPointer(1.5, 0, true)
            await settle(renderer)
            if (check === 'feedback')
              expect(indicators.some((el) => el.attributes.stroke === '#ef4444')).toBe(true)
            else {
              expect(snapshot()).toBe(before)
              expect(useScene.getState().nodes[root.id]).toBe(node)
            }
            expect(getMovingNode()?.id).toBe(root.id)
            expect(useScene.temporal.getState().pastStates).toHaveLength(0)
          } finally {
            elements.mockRestore()
            await renderer.unmount()
          }
        })

for (const strict of [false, true])
  for (const kind of ['item', 'shelf', 'procedural-item', 'cabinet'])
    for (const outcome of ['replace', 'end'])
      test(`audit7 pending abandonment ${kind} ${outcome} strict=${strict}`, async () => {
        const { root } = interactionFixture(kind)
        select(root)
        const before = snapshot()
        const scene = <Scene menu panes={{ plan: false, spatial: false }} />
        const renderer = await create(strict ? <StrictMode>{scene}</StrictMode> : scene)
        try {
          const copy = await duplicate(renderer)
          expect(useInteractionScope.getState().pendingSubtree?.rootId).toBe(copy.id)
          expect(useInteractionScope.getState().ownedSubtree).toBeNull()
          await act(async () =>
            useEditor.getState().setMovingNode(outcome === 'replace' ? root : null),
          )
          expect(snapshot()).toBe(before)
          expect(useScene.temporal.getState().pastStates).toHaveLength(0)
          expect(useInteractionScope.getState().pendingSubtree).toBeNull()
        } finally {
          await renderer.unmount()
        }
      })

for (const continuation of ['single', 'repeat'] as const)
  test(`audit7 fresh catalog ${continuation}`, async () => {
    seed([])
    useEditor.getState().setSelectedItem(asset)
    useEditor.getState().setContinuation('point', continuation)
    const renderer = await create(<Scene fresh />)
    try {
      await settle(renderer)
      const pointer = pointerDispatcher()
      const count = continuation === 'repeat' ? 3 : 1
      for (let index = 0; index < count; index++) {
        const point = new Vector3(2 + index, 0, 3)
        await pointer.send(point, 'grid first')
        await settle(renderer)
        await pointer.send(point, 'grid first', true)
        await settle(renderer)
        const placed = Object.values(useScene.getState().nodes).filter(
          (node) => node.type === 'item' && !node.metadata?.isNew && !node.metadata?.isTransient,
        )
        expect(placed).toHaveLength(index + 1)
        expect(placed.at(-1)!.position[0]).toBeCloseTo(2 + index)
        expect(placed.at(-1)!.position[1]).toBeCloseTo(0)
        expect(placed.at(-1)!.position[2]).toBeCloseTo(3)
        expect(useScene.temporal.getState().pastStates).toHaveLength(index + 1)
      }
      if (continuation === 'repeat') await key('Escape')
      const placed = snapshot()
      await act(async () => useScene.temporal.getState().undo())
      expect(
        Object.values(useScene.getState().nodes).filter((node) => node.type === 'item'),
      ).toHaveLength(count - 1)
      await act(async () => useScene.temporal.getState().redo())
      expect(snapshot()).toBe(placed)
    } finally {
      await renderer.unmount()
    }
  })

for (const view of ['3d', '2d'])
  for (const kind of ['item', 'shelf', 'procedural-item', 'cabinet'])
    for (const adoption of ['unmounted', 'refused'])
      test(`review2 pending Escape ${view} ${kind} ${adoption}`, async () => {
        const { root } = interactionFixture(kind)
        select(root, view)
        const before = snapshot()
        const adopt =
          adoption === 'refused'
            ? spyOn(useInteractionScope.getState(), 'adoptSubtree').mockReturnValue(false)
            : null
        const renderer = await create(
          <Scene
            menu
            panes={adoption === 'unmounted' ? { plan: false, spatial: false } : panesFor(view)}
          />,
        )
        try {
          const copy = await duplicate(renderer)
          expect(useInteractionScope.getState().pendingSubtree?.rootId).toBe(copy.id)
          expect(useInteractionScope.getState().ownedSubtree).toBeNull()
          await key('Escape')
          await settle(renderer)
          expect(getMovingNode()).toBeNull()
          expect(snapshot()).toBe(before)
          expect(useScene.temporal.getState().pastStates).toHaveLength(0)
        } finally {
          adopt?.mockRestore()
          await renderer.unmount()
        }
      })

for (const kind of ['item', 'shelf', 'procedural-item', 'cabinet'])
  for (const cancel of kind === 'item'
    ? ['tool', 'selection', 'right-click']
    : ['tool', 'selection'])
    test(`review2 pending cancel ${kind} ${cancel}`, async () => {
      const { root } = interactionFixture(kind)
      select(root)
      const before = snapshot()
      const adopt = spyOn(useInteractionScope.getState(), 'adoptSubtree').mockReturnValue(false)
      const renderer = await create(<Scene menu panes={panesFor('3d')} />)
      try {
        const copy = await duplicate(renderer)
        expect(useInteractionScope.getState().pendingSubtree?.rootId).toBe(copy.id)
        if (cancel === 'tool') await key('p')
        else if (cancel === 'selection')
          await act(async () => useEditor.getState().setMovingNode(null))
        else
          await act(async () => {
            for (const type of ['pointerdown', 'pointerup'])
              window.dispatchEvent(
                Object.assign(new Event(type), {
                  button: 2,
                  clientX: 0,
                  clientY: 0,
                }),
              )
          })
        await settle(renderer)
        expect(getMovingNode()).toBeNull()
        expect(snapshot()).toBe(before)
        expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      } finally {
        adopt.mockRestore()
        await renderer.unmount()
      }
    })

for (const view of ['3d', '2d'])
  for (const snapping of ['off', 'grid'] as const)
    for (const childKind of [
      'catalog',
      'generated',
      'generated-no-footprint',
      'generated-recipe-fallback',
      'generated-no-drag-bounds',
    ])
      test(`review2 real named surface ${view} ${snapping} ${childKind}`, async () => {
        const host = ProceduralItemNode.parse({
          parentId: level.id,
          recipe: {
            ...counterRecipe,
            parameters: counterRecipe.parameters.map((p) =>
              p.id === 'width' || p.id === 'depth' ? { ...p, max: 6 } : p,
            ),
            surfaces: [
              {
                id: 'worktop',
                label: 'Worktop',
                position: [0.2, 0.9, -0.1],
                rotation: [0.2, 0.35, 0],
                size: [4, 3],
              },
            ],
          },
          parameters: { width: 4.5, depth: 3.5 },
        })
        const realAsset = CATALOG_ITEMS.find((a) => a.id === 'table-lamp')!
        const root =
          childKind === 'catalog'
            ? ItemNode.parse({ parentId: host.id, asset: realAsset, position: [-1, 0, 0] })
            : ProceduralItemNode.parse({
                parentId: host.id,
                position: [-1, -0.03, 0],
                recipe: {
                  ...gridTableRecipe,
                  parts: gridTableRecipe.parts.map((part) => ({
                    ...part,
                    shapes: part.shapes.map((shape) => ({
                      ...shape,
                      position: shape.position.map((v, i) => ({
                        op: 'add',
                        args: [v, [0.11, 0.03, 0.035][i]],
                      })),
                    })),
                  })),
                },
              })
        const leaf = ItemNode.parse({
          parentId: root.id,
          asset: CATALOG_ITEMS.find((a) => a.id === 'books')!,
          position: [0, 0.8, 0],
        })
        host.attachments[root.id] = 'worktop'
        seed([host, root, leaf])
        if (childKind === 'generated-no-footprint' || childKind === 'generated-recipe-fallback') {
          const definition = nodeRegistry.get('procedural-item')!
          registerNode({
            ...definition,
            capabilities: {
              ...definition.capabilities,
              floorPlaced: { ...definition.capabilities.floorPlaced, footprint: undefined },
            },
          } as never)
        }
        select(root, view)
        useEditor.getState().setSnappingMode('item', snapping)
        const before = snapshot()
        const renderer = await create(<Scene menu />)
        try {
          const copy = await duplicate(renderer)
          const point = (x: number) =>
            new Vector3(x, 0, 0)
              .applyEuler(new Euler(0.2, 0.35, 0))
              .add(new Vector3(0.2, 0.9, -0.1))
          const pointer = view === '3d' ? pointerDispatcher() : null
          const send = async (x: number, click = false) => {
            const p = point(x)
            if (pointer) await pointer.send(p, 'grid first', click)
            else await planPointer(p.x, p.z, click)
            await settle(renderer)
          }
          await send(1)
          expect(surfaceAttachmentId(useScene.getState().nodes[copy.id]!)).toBe('worktop')
          if (
            childKind === 'generated-recipe-fallback' ||
            childKind === 'generated-no-drag-bounds'
          ) {
            const definition = nodeRegistry.get('procedural-item')!
            registerNode({
              ...definition,
              capabilities: {
                ...definition.capabilities,
                dragBounds: undefined,
              },
            } as never)
          }
          await send(1, true)
          expect(getMovingNode()).toBeNull()
          expect(useScene.temporal.getState().pastStates).toHaveLength(1)
          const copied = Object.values(useScene.getState().nodes).filter(
            (n) => !(n.id in JSON.parse(before).nodes),
          )
          expect(copied).toHaveLength(2)
          const placed = copied.find((n) => n.parentId === host.id)!
          expect(surfaceAttachmentId(placed)).toBe('worktop')
          expect(copied.find((n) => n.id !== placed.id)?.parentId).toBe(placed.id)
        } finally {
          await renderer.unmount()
        }
      })

for (const kind of ['item', 'procedural-item', 'procedural-generic'])
  for (const outcome of ['Escape', 'commit'])
    test(`review3 refused 2d release then 3d ${kind} ${outcome}`, async () => {
      Core.resetSceneHistoryPauseDepth()
      const { root, host } = lifecycleFixture(
        kind === 'procedural-generic' ? 'procedural-item' : kind,
        false,
      )
      const usesRawMover = kind !== 'item'
      if (usesRawMover) {
        expect(root.type).toBe('procedural-item')
        const procedural = root as ProceduralItemNode
        expect(procedural.recipe.mounting).toBeUndefined()
        expect(MoveProceduralItem({ node: procedural }).type).toBe(MoveRegistryNodeTool)
      }
      if (kind === 'procedural-generic') {
        genericPlanDOM()
        const definition = nodeRegistry.get('procedural-item')!
        registerNode({ ...definition, floorplanMoveTarget: undefined } as never)
      }
      select(root)
      const before = snapshot()
      const renderer = await create(<Scene menu panes={{ plan: true, spatial: true }} />)
      try {
        const copy = await duplicate(renderer)
        expect(useScene.temporal.getState().isTracking).toBe(!usesRawMover)
        expect(Core.getSceneHistoryPauseDepth()).toBe(0)
        const origin = useEditor.getState().movingNodeOrigin
        await planPointer(1, 0)
        expect(useScene.temporal.getState().isTracking).toBe(!usesRawMover)
        const obstacle = ItemNode.parse({ parentId: host.id, asset, position: [1, 0, 0] })
        useScene.getState().applyNodeChanges({
          create: [{ node: obstacle }],
          update: [
            {
              id: host.id,
              data: {
                attachments: {
                  ...(useScene.getState().nodes[host.id] as ProceduralItemNode).attachments,
                  [obstacle.id]: 'top',
                },
              },
            },
          ],
        })
        const atRelease = snapshot()
        await planPointer(1, 0, true)
        await settle(renderer)
        expect(getMovingNode()?.id).toBe(copy.id)
        expect(snapshot()).toBe(atRelease)
        expect(useEditor.getState().movingNodeOrigin).toBe(origin)
        expect(useScene.temporal.getState().isTracking).toBe(!usesRawMover)
        const attachments = {
          ...(useScene.getState().nodes[host.id] as ProceduralItemNode).attachments,
        }
        delete attachments[obstacle.id]
        useScene.getState().applyNodeChanges({
          delete: [obstacle.id],
          update: [{ id: host.id, data: { attachments } }],
        })
        await renderer.update(<Scene menu panes={panesFor('3d')} />)
        const pointer = pointerDispatcher()
        await pointer.send(new Vector3(1, 2, 0), 'grid first')
        await settle(renderer)
        if (outcome === 'Escape') await key('Escape')
        else await pointer.send(new Vector3(1, 2, 0), 'grid first', true)
        await settle(renderer)
        expect(getMovingNode()).toBeNull()
        // Items pause only their own writes. These unmounted recipes delegate to the generic
        // 3D mover, whose raw lifetime pause applies with either 2D overlay path.
        const foreignSteps = usesRawMover ? 0 : 2
        if (outcome === 'Escape') {
          expect(snapshot()).toBe(before)
          expect(useScene.temporal.getState().pastStates).toHaveLength(foreignSteps)
        } else {
          expect(useScene.temporal.getState().pastStates).toHaveLength(foreignSteps + 1)
          const committed = snapshot()
          const originalIds = new Set(Object.keys(JSON.parse(before).nodes))
          const copies = Object.values(useScene.getState().nodes).filter(
            (n) => !originalIds.has(n.id),
          )
          expect(copies).toHaveLength(2)
          const placed = copies.find((n) => n.parentId === host.id)!
          const position = (placed as ItemNode | ProceduralItemNode).position
          for (const [axis, value] of [1, 0, 0].entries())
            expect(position[axis]).toBeCloseTo(value, 8)
          expect(surfaceAttachmentId(placed)).toBe('top')
          expect(copies.find((n) => n.id !== placed.id)?.parentId).toBe(placed.id)
          expect(world(placed.id).y).toBeCloseTo(2)
          await act(async () => useScene.temporal.getState().undo())
          expect(snapshot()).toBe(before)
          await act(async () => useScene.temporal.getState().redo())
          expect(snapshot()).toBe(committed)
        }
      } finally {
        await renderer.unmount()
      }
    })

test('review3 unregistered generic Escape cannot record deletion after flags change', async () => {
  Core.resetSceneHistoryPauseDepth()
  genericPlanDOM()
  const root = genericHost()
  const definition = nodeRegistry.get(root.type)!
  registerNode({ ...definition, floorplan: nodeRegistry.get('shelf')!.floorplan } as never)
  root.metadata = { isNew: true }
  seed([root])
  select(root, '2d')
  useScene.temporal.getState().resume()
  await act(async () => useEditor.getState().setMovingNode(root))
  const renderer = await create(<Scene panes={panesFor('2d')} />)
  try {
    await planPointer(3, 4)
    // A custom mover can clear its scene flags while the scope still carries the fresh payload.
    useScene.temporal.getState().pause()
    useScene.getState().updateNode(root.id, { metadata: {} })
    useScene.temporal.getState().resume()
    await key('Escape')
    await settle(renderer)
    expect(useScene.getState().nodes[root.id]).toBeUndefined()
    const historySteps = useScene.temporal.getState().pastStates.length
    await act(async () => useScene.temporal.getState().undo())
    expect(useScene.getState().nodes[root.id]).toBeUndefined()
    expect(historySteps).toBe(0)
    await act(async () => useScene.temporal.getState().redo())
    expect(useScene.getState().nodes[root.id]).toBeUndefined()
  } finally {
    await renderer.unmount()
  }
})
