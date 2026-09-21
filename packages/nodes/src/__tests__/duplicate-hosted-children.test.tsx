import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BlockNode,
  CabinetModuleNode,
  CabinetNode,
  CeilingNode,
  ColumnNode,
  collectSubtree,
  createSceneApi,
  type FloorplanGeometry,
  ItemNode,
  initSpatialGridSync,
  LevelNode,
  nodeRegistry,
  RoofSegmentNode,
  registerNode,
  type SceneCommit,
  ShelfNode,
  spatialGridManager,
  subscribeSceneCommits,
  useLiveNodeOverrides,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { ProceduralItemNode, shelfRecipe } from '@pascal-app/core/procedural-items'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { act, create } from '@react-three/test-renderer'
import { isValidElement, type ReactNode } from 'react'
import * as ReactDOM from 'react-dom'
import { renderToString } from 'react-dom/server'
import { FloatingActionMenu } from '../../../editor/src/components/editor/floating-action-menu'
import { FloorplanRegistryActionMenu } from '../../../editor/src/components/editor-2d/floorplan-registry-action-menu'
import { FloorplanRegistryMoveOverlay } from '../../../editor/src/components/editor-2d/floorplan-registry-move-overlay'
import {
  buildFloorplanEntryGeometry,
  computeAffectedSiblingIds,
} from '../../../editor/src/components/editor-2d/renderers/floorplan-registry-layer'
import {
  type DraftNodeHandle,
  useDraftNode,
} from '../../../editor/src/components/tools/item/use-draft-node'
import {
  commitFreshPlacementSubtree,
  createFreshPlacementSubtree,
} from '../../../editor/src/lib/fresh-planar-placement'
import useEditor from '../../../editor/src/store/use-editor'
import useInteractionScope, { getMovingNode } from '../../../editor/src/store/use-interaction-scope'
import { blockDefinition } from '../block/definition'
import { cabinetDefinition, cabinetModuleDefinition } from '../cabinet/definition'
import { columnDefinition } from '../column/definition'
import { itemDefinition } from '../item/definition'
import { proceduralItemDefinition } from '../procedural-item/definition'
import { shelfDefinition } from '../shelf/definition'

const asset = {
  id: 'vase',
  name: 'Vase',
  category: 'decor',
  thumbnail: '',
  src: '/vase.glb',
  dimensions: [0.2, 0.3, 0.2],
}
const namedRecipe = {
  ...shelfRecipe,
  surfaces: [{ id: 'top', label: 'Top', position: [0, 1, 0], size: [2, 2] }],
}
const level = LevelNode.parse({ id: 'level_duplicate', level: 0 })
let restoreRegistry: () => void
let restoreGlobals: () => void
let restoreStores: () => void
let html: ReturnType<typeof spyOn>
let portal: ReturnType<typeof spyOn>
let menu: ReactNode
let frames: FrameRequestCallback[]
let draft: DraftNodeHandle
function DraftHarness() {
  draft = useDraftNode()
  return null
}

beforeEach(() => {
  const scene = useScene.getState(),
    editor = useEditor.getState(),
    viewer = useViewer.getState(),
    scope = useInteractionScope.getState()
  restoreStores = () => {
    useScene.setState(scene, true)
    useEditor.setState(editor, true)
    useViewer.setState(viewer, true)
    useInteractionScope.setState(scope, true)
  }
  restoreRegistry = nodeRegistry._snapshot()
  nodeRegistry._reset()
  for (const definition of [
    itemDefinition,
    shelfDefinition,
    proceduralItemDefinition,
    cabinetDefinition,
    cabinetModuleDefinition,
    columnDefinition,
    blockDefinition,
  ])
    registerNode(definition as never)
  const names = ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame'] as const
  const descriptors = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name))
  restoreGlobals = () =>
    names.forEach((name, i) => {
      const descriptor = descriptors[i]
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    })
  frames = []
  Object.assign(globalThis, {
    window: Object.assign(new EventTarget(), {
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    }),
    document: {
      body: { style: {} },
      querySelector: () => ({
        ownerSVGElement: {},
        getScreenCTM: () => ({}),
        querySelector: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 10 }) }),
      }),
    },
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    },
    cancelAnimationFrame: () => {},
  })
  menu = null
  html = spyOn(
    Html as unknown as { render: (props: { children: ReactNode }) => ReactNode },
    'render',
  ).mockImplementation((props) => {
    menu = props.children
    return null
  })
  portal = spyOn(ReactDOM, 'createPortal').mockImplementation((children) => {
    menu = children
    return null as never
  })
  useInteractionScope.getState().end()
  useEditor.setState({ mode: 'build', tool: null, isFloorplanHovered: false })
  useViewer.getState().setSelection({ levelId: level.id, selectedIds: [] })
  useScene.temporal.getState().pause()
  useScene.temporal.getState().clear()
  spatialGridManager.clear()
  renderToString(<DraftHarness />)
})
afterEach(() => {
  html.mockRestore()
  portal.mockRestore()
  restoreStores()
  restoreRegistry()
  restoreGlobals()
  useScene.temporal.getState().clear()
  useScene.temporal.getState().resume()
  spatialGridManager.clear()
})

function snapshot() {
  const { nodes, rootNodeIds, collections, materials, installedPlugins } = useScene.getState()
  return JSON.stringify({ nodes, rootNodeIds, collections, materials, installedPlugins })
}
function item(id: string, parentId: string, patch = {}) {
  return ItemNode.parse({ id, parentId, asset, ...patch })
}
function fixture(kind: string, childless = false) {
  let root: AnyNode
  let parent: AnyNode = level
  if (kind === 'shelf' || kind === 'bookshelf40')
    root = ShelfNode.parse({
      id: 'shelf_original',
      parentId: level.id,
      rows: 3,
      height: 1.8,
      style: 'bookshelf',
    })
  else if (kind === 'design')
    root = ProceduralItemNode.parse({
      id: 'procedural-item_original',
      parentId: level.id,
      recipe: namedRecipe,
    }) as AnyNode
  else if (kind === 'cabinet')
    root = CabinetNode.parse({ id: 'cabinet_original', parentId: level.id })
  else if (kind === 'column') root = ColumnNode.parse({ id: 'column_original', parentId: level.id })
  else if (kind === 'block') root = BlockNode.parse({ id: 'block_original', parentId: level.id })
  else {
    if (kind === 'wall')
      parent = WallNode.parse({ id: 'wall_host', parentId: level.id, start: [0, 0], end: [5, 0] })
    if (kind === 'ceiling')
      parent = CeilingNode.parse({
        id: 'ceiling_host',
        parentId: level.id,
        polygon: [
          [0, 0],
          [5, 0],
          [5, 5],
          [0, 5],
        ],
      })
    if (kind === 'roof') parent = RoofSegmentNode.parse({ id: 'rseg_host', parentId: level.id })
    if (kind === 'block-face') parent = BlockNode.parse({ id: 'block_host', parentId: level.id })
    root = item('item_original', parent.id, {
      asset: {
        ...asset,
        name: 'Table',
        dimensions: [2, 1, 1],
        ...(kind === 'wall' || kind === 'roof' || kind === 'block-face'
          ? { attachTo: 'wall-side' }
          : kind === 'ceiling'
            ? { attachTo: 'ceiling' }
            : {}),
      },
      ...(kind === 'wall' ? { wallId: parent.id } : {}),
      ...(kind === 'roof' ? { roofSegmentId: parent.id, roofFace: 'front' } : {}),
      ...(kind === 'block-face' ? { blockFaceId: 'f-front' } : {}),
    })
  }
  const children: AnyNode[] = []
  if (!childless) {
    if (kind === 'table-design')
      children.push(
        ProceduralItemNode.parse({
          id: 'procedural-item_child',
          parentId: root.id,
          recipe: shelfRecipe,
          position: [0, 1, 0],
        }) as AnyNode,
      )
    else if (kind === 'cabinet')
      children.push(CabinetModuleNode.parse({ id: 'cabinet-module_child', parentId: root.id }))
    else
      for (
        let i = 0;
        i < (kind === 'bookshelf40' ? 40 : kind === 'shelf' ? 3 : kind === 'design' ? 2 : 1);
        i++
      )
        children.push(
          item(`item_child${i}`, root.id, { position: [0, ((i % 3) + 1) * 0.6 + 0.04, 0] }),
        )
    if (kind === 'nested') {
      const middle = children[0]! as ItemNode
      const leaf = item('item_leaf', middle.id, { position: [0, 0.3, 0] })
      middle.children = [leaf.id]
      children.push(leaf)
    }
    if (kind === 'column') {
      const shelf = ShelfNode.parse({
        id: 'shelf_child',
        parentId: root.id,
        children: [children[0]!.id],
      })
      children[0]!.parentId = shelf.id
      children.unshift(shelf)
    }
  }
  Object.assign(root, {
    children: children.filter((child) => child.parentId === root.id).map((child) => child.id),
  })
  if (root.type === 'procedural-item' && children[0]) {
    root.attachments = { [children[0].id]: 'top' }
    Object.assign(children[0], { position: [0, 0, 0] })
  }
  const nodes = {
    [level.id]: { ...level, children: [parent.id === level.id ? root.id : parent.id] },
    [root.id]: root,
    ...Object.fromEntries(children.map((child) => [child.id, child])),
  }
  if (parent.id !== level.id) nodes[parent.id] = { ...parent, children: [root.id] } as AnyNode
  useScene.setState({
    nodes,
    rootNodeIds: [level.id],
    collections: {},
    materials: {},
    installedPlugins: [],
    dirtyNodes: new Set(),
  } as never)
  useScene.temporal.getState().clear()
  useScene.temporal.getState().resume()
  return root
}
function findDuplicate(
  element: ReactNode,
): ((event: { stopPropagation: () => void }) => void) | undefined {
  if (Array.isArray(element)) return element.map(findDuplicate).find(Boolean)
  if (
    !isValidElement<{
      onDuplicate?: (event: { stopPropagation: () => void }) => void
      children?: ReactNode
    }>(element)
  )
    return undefined
  return element.props.onDuplicate ?? findDuplicate(element.props.children)
}
async function duplicate(root: AnyNode, view: '3d' | '2d') {
  if (root.type === 'block') {
    useScene.temporal.getState().pause()
    const id = createFreshPlacementSubtree(root.id)!
    return useScene.getState().nodes[id]!
  }
  useViewer.getState().setSelection({ selectedIds: [root.id] })
  useEditor.setState({ isFloorplanHovered: view === '2d' })
  const renderer = await create(
    view === '3d' ? <FloatingActionMenu /> : <FloorplanRegistryActionMenu />,
  )
  if (view === '2d')
    await act(async () => {
      const callbacks = frames.splice(0)
      callbacks.forEach((callback) => {
        callback(0)
      })
    })
  const handler = findDuplicate(menu)
  expect(handler).toBeDefined()
  await act(async () => handler!({ stopPropagation() {} }))
  await renderer.unmount()
  const moving = useInteractionScope.getState().scope
  expect(moving).toBeDefined()
  const node = getMovingNode()
  expect(node).toBeDefined()
  return node as AnyNode
}
function assertCopy(source: AnyNode, copy: AnyNode) {
  const nodes = useScene.getState().nodes
  const original = collectSubtree(nodes, source.id)!,
    cloned = collectSubtree(nodes, copy.id)!
  expect(cloned).not.toBeNull()
  expect(cloned.descendants).toHaveLength(original.descendants.length)
  const oldNodes = [original.root, ...original.descendants],
    newNodes = [cloned.root, ...cloned.descendants]
  const map = new Map(oldNodes.map((node, i) => [node.id, newNodes[i]!.id]))
  for (let i = 0; i < oldNodes.length; i++) {
    const old = oldNodes[i]!,
      fresh = newNodes[i]!
    expect(oldNodes.some((node) => node.id === fresh.id)).toBe(false)
    expect(fresh.parentId).toBe(i === 0 ? old.parentId : map.get(old.parentId as AnyNodeId))
    if ('children' in old)
      expect((fresh as ItemNode).children).toEqual(
        (old.children as AnyNodeId[]).map((id) => map.get(id)),
      )
    if (i > 0) expect((fresh as ItemNode).position).toEqual((old as ItemNode).position)
    if (old.type === 'procedural-item')
      expect((fresh as typeof old).attachments).toEqual(
        Object.fromEntries(
          Object.entries(old.attachments).map(([id, surface]) => [
            map.get(id as AnyNodeId),
            surface,
          ]),
        ),
      )
  }
  return newNodes
}
for (const view of ['3d', '2d'] as const)
  for (const kind of [
    'table',
    'table-design',
    'shelf',
    'design',
    'nested',
    'wall',
    'ceiling',
    'roof',
    'block-face',
    'cabinet',
    'column',
    'block',
    'bookshelf40',
  ]) {
    test(`${view} Duplicate ${kind}: whole subtree, single commit/undo/redo and reload`, async () => {
      const root = fixture(kind),
        before = snapshot(),
        commits: SceneCommit[] = []
      const unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))
      try {
        const copy = await duplicate(root, view)
        const copied = assertCopy(root, copy)
        expect(copy.metadata?.isNew).toBe(true)
        expect(commits).toHaveLength(0)
        useScene.temporal.getState().pause()
        let finalId: AnyNodeId
        if (copy.type === 'item' && view === '3d') {
          draft.adopt(copy)
          finalId = draft.commit({
            position: [8, 0, 8],
            parentId: root.parentId,
            metadata: {},
          }) as AnyNodeId
        } else
          finalId = commitFreshPlacementSubtree(copy.id, {
            position: [8, 0, 8],
          } as Partial<AnyNode>)!
        expect(finalId).toBeTruthy()
        for (const node of copied) expect(useScene.getState().nodes[node.id]).toBeUndefined()
        const placed = useScene.getState().nodes[finalId]!
        const committedNodes = assertCopy(root, placed)
        for (const node of committedNodes) {
          expect(node.metadata?.isNew).toBeUndefined()
          expect(node.metadata?.isTransient).toBeUndefined()
        }
        expect(commits).toHaveLength(1)
        expect(
          Object.keys(commits[0]!.current.nodes).length -
            Object.keys(commits[0]!.before.nodes).length,
        ).toBe(committedNodes.length)
        const after = snapshot()
        useScene.temporal.getState().resume()
        useScene.temporal.getState().undo()
        expect(snapshot()).toBe(before)
        useScene.temporal.getState().redo()
        expect(snapshot()).toBe(after)
        const roundTrip = JSON.parse(after)
        for (const node of committedNodes)
          expect(nodeRegistry.get(node.type)!.schema.parse(roundTrip.nodes[node.id])).toEqual(node)
      } finally {
        unsubscribe()
      }
    })
    test(`${view} Duplicate ${kind}: cancel deletes descendants without changing the source`, async () => {
      const root = fixture(kind),
        before = snapshot()
      const copy = await duplicate(root, view)
      assertCopy(root, copy)
      if (copy.type === 'item' && view === '3d') {
        draft.adopt(copy)
        draft.destroy()
      } else useScene.getState().deleteNode(copy.id)
      useEditor.getState().setMovingNode(null)
      useScene.temporal.getState().resume()
      expect(snapshot()).toBe(before)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    })
  }

for (const view of ['3d', '2d'] as const)
  for (const kind of ['table', 'shelf', 'design']) {
    test(`${view} childless ${kind}: main draft byte pin`, async () => {
      const root = fixture(kind, true)
      const copy = await duplicate(root, view)
      const nodes = useScene.getState().nodes
      const normalized = JSON.stringify({ moving: copy, nodes }).replaceAll(copy.id, 'FRESH_ID')
      expect(normalized).toMatchSnapshot()
    })
  }

test('fresh item survives effect cleanup/setup without losing its hosted subtree', async () => {
  const root = fixture('nested'),
    before = snapshot()
  const copy = (await duplicate(root, '3d')) as ItemNode
  draft.adopt(copy)
  draft.destroy()
  draft.adopt(copy)
  assertCopy(root, useScene.getState().nodes[copy.id]!)
  draft.destroy()
  expect(useScene.getState().nodes[copy.id]).toBeDefined()
  useEditor.getState().setMovingNode(null)
  expect(snapshot()).toBe(before)
})

test('40 hosted items are inserted once and excluded with their draft root from collision queries', async () => {
  const root = fixture('bookshelf40')
  const unsubscribe = initSpatialGridSync()
  const created = spyOn(spatialGridManager, 'handleNodeCreated')
  try {
    const copy = await duplicate(root, '3d')
    const copied = assertCopy(root, copy)
    const ids = new Set(copied.map((node) => node.id))
    const registrations = created.mock.calls.filter(([node]) => ids.has(node.id))
    expect(registrations).toHaveLength(41)
    expect(new Set(registrations.map(([node]) => node.id)).size).toBe(41)
    const collision = spatialGridManager.canPlaceOnFloor(
      level.id,
      [0, 0, 0],
      [2, 2, 2],
      [0, 0, 0],
      [copy.id],
    )
    expect(collision.conflictIds).toContain(root.id)
    expect(collision.conflictIds.some((id) => ids.has(id as AnyNodeId))).toBe(false)
    expect(
      spatialGridManager.canPlaceOnFloor(level.id, [8, 0, 8], [2, 2, 2], [0, 0, 0], [copy.id])
        .valid,
    ).toBe(true)
  } finally {
    created.mockRestore()
    unsubscribe()
  }
})

for (const kind of ['table', 'shelf', 'design', 'nested', 'wall', 'block-face']) {
  test(`2d ${kind}: the real Escape handler restores the entire scene`, async () => {
    const root = fixture(kind),
      before = snapshot()
    await duplicate(root, '2d')
    const renderer = await create(<FloorplanRegistryMoveOverlay />)
    try {
      await act(async () => {
        window.dispatchEvent(
          Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' }),
        )
      })
      expect(getMovingNode()).toBeNull()
      expect(snapshot()).toBe(before)
    } finally {
      await renderer.unmount()
    }
  })
}

test('item subtree commit re-elects root support without rewriting hosted descendants', async () => {
  const root = fixture('nested') as ItemNode
  useScene.getState().updateNode(root.id, { supportSlabId: 'slab_previous' })
  const source = useScene.getState().nodes[root.id]!
  const copy = (await duplicate(source, '3d')) as ItemNode
  draft.adopt(copy)
  const id = draft.commit(
    { position: [8, 0, 8], parentId: level.id },
    { pinSupport: true },
  ) as AnyNodeId
  const committed = useScene.getState().nodes[id] as ItemNode
  expect(committed.supportSlabId).toBe('ground')
  expect((useScene.getState().nodes[root.id] as ItemNode).supportSlabId).toBe('slab_previous')
  for (const child of collectSubtree(useScene.getState().nodes, id)!.descendants)
    expect((child as ItemNode).supportSlabId).toBeUndefined()
})

for (const kind of ['table', 'table-design', 'shelf', 'design', 'nested']) {
  test(`2d ${kind}: cached descendant footprints follow both preview moves`, async () => {
    const root = fixture(kind)
    const copy = await duplicate(root, '2d')
    const nodes = useScene.getState().nodes
    const descendants = collectSubtree(nodes, copy.id)!.descendants
    const geometryCache = new Map()
    const interactiveElevators = {}
    const build = (node: AnyNode, siblingEpoch: number) =>
      buildFloorplanEntryGeometry({
        automaticDimensions: false,
        ctxOverrides: undefined,
        geometryCache,
        highlighted: false,
        hovered: false,
        interactiveElevators,
        levelDataCache: new Map(),
        levelNodeIdsByType: new Map(),
        live: undefined,
        liveOverride: undefined,
        liveOverrides: useLiveNodeOverrides.getState().overrides,
        moving: false,
        node,
        nodeId: node.id,
        nodes,
        palette: undefined,
        selected: false,
        siblingEpoch,
        unit: 'metric',
        metricNotation: 'meters',
        wallDimensionReference: 'centerline',
        visibilityRootId: undefined,
      })!.base!
    const anchor = (geometry: FloorplanGeometry): readonly number[] => {
      if (geometry.kind === 'group') return anchor(geometry.children[0]!)
      if (geometry.kind === 'polygon') return geometry.points[0]!
      if (geometry.kind === 'rect') return [geometry.x, geometry.y]
      throw new Error(`Unexpected footprint ${geometry.kind}`)
    }
    const originals = descendants.map((node) => anchor(build(node, 0)))
    const session = nodeRegistry.get(copy.type)!.floorplanMoveTarget!({
      node: copy,
      nodes,
      sceneApi: createSceneApi(useScene),
    })
    try {
      for (const distance of [4, 8]) {
        session.apply({
          planPoint: [distance, distance],
          modifiers: { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false },
        })
        const affected = computeAffectedSiblingIds(
          [copy.id],
          nodes,
          useLiveNodeOverrides.getState().overrides,
        )
        for (const [i, node] of descendants.entries()) {
          const point = anchor(build(node, affected.has(node.id) ? distance : 0))
          expect(point[0]! - originals[i]![0]!).toBeCloseTo(distance)
          expect(point[1]! - originals[i]![1]!).toBeCloseTo(distance)
        }
      }
    } finally {
      useLiveNodeOverrides.getState().clear(copy.id)
    }
  })
}
