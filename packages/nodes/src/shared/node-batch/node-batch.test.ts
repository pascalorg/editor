import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import {
  type AnyNode,
  itemClipRegistry,
  sceneRegistry,
  useInteractive,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import * as viewerExports from '@pascal-app/viewer'
import { SCENE_LAYER, useViewer } from '@pascal-app/viewer'
import {
  BackSide,
  type BatchedMesh,
  BoxGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
} from 'three'
import {
  combinePaintPreviews,
  createPaintPreviewOwner,
} from '../../../../editor/src/lib/paint-preview-owner'
import { commitPaintScopeFanout } from '../../../../editor/src/lib/paint-scope'
import { applyShadowOnly, clearShadowOnly } from '../../../../viewer/src/lib/shadow-only'
import { getCeilingMaterials } from '../../ceiling/materials'
import { ceilingPaint } from '../../ceiling/paint'
import {
  createSlotPaintCapability,
  isSlotPaintPreviewActive,
  subscribeSlotPaintPreviews,
} from '../slot-paint'
import { collectBatchCandidate, collectTintedNodes } from './candidates'
import { NodeBatchStore } from './store'
import {
  captureChangedNodes,
  resetNodeBatchState,
  runBatchFrame,
  subscribeBatchInteractions,
} from './system'

let now = 0
let restoreClock: () => void
let unsubscribe: () => void
const wakeRef: { current: ReturnType<typeof setTimeout> | null } = { current: null }
const originalViewer = useViewer.getState()
const stores: NodeBatchStore[] = []
const restores: Array<() => void> = []

beforeEach(() => {
  now = 0
  const clock = spyOn(performance, 'now').mockImplementation(() => now)
  restoreClock = () => clock.mockRestore()
  sceneRegistry.clear()
  useScene.setState({ nodes: {}, dirtyNodes: new Set(), materials: {}, rootNodeIds: [] } as never)
  useViewer.setState({
    selection: { ...originalViewer.selection, selectedIds: [], levelId: null },
    previewSelectedIds: [],
    externalSelectedIds: [],
    hoveredId: null,
    levelMode: 'stacked',
  } as never)
  unsubscribe = subscribeBatchInteractions(() => {})
})

afterEach(() => {
  for (const restore of restores.splice(0).reverse()) restore()
  unsubscribe()
  useLiveTransforms.getState().clearAll()
  useLiveNodeOverrides.getState().clearAll()
  useInteractive.setState({ doorAnimations: {}, windowAnimations: {} })
  resetNodeBatchState()
  for (const store of stores.splice(0)) store.disposeAll()
  if (wakeRef.current) clearTimeout(wakeRef.current)
  wakeRef.current = null
  sceneRegistry.clear()
  useScene.setState({ nodes: {}, dirtyNodes: new Set(), rootNodeIds: [] } as never)
  useViewer.setState(originalViewer)
  restoreClock()
})

function frame() {
  runBatchFrame(() => {}, wakeRef)
}
function settle() {
  frame()
  now += 181
  frame()
}

function setup(kind = 'ceiling', count = 4) {
  const root = new Group()
  sceneRegistry.nodes.set('level_test', root)
  sceneRegistry.byType.level.add('level_test')
  const material = new MeshBasicMaterial({ side: BackSide })
  const meshes = Array.from({ length: count }, (_, index) => {
    const id = `${kind}_${index}`
    const mesh = new Mesh(new BoxGeometry(), material)
    mesh.userData.itemModelSettled = true
    root.add(mesh)
    sceneRegistry.nodes.set(id, mesh)
    sceneRegistry.byType[kind]!.add(id)
    return mesh
  })
  useScene.setState({
    nodes: {
      level_test: { id: 'level_test', type: 'level', children: [] },
      ...Object.fromEntries(
        meshes.map((_, index) => {
          const id = `${kind}_${index}`
          return [id, { id, type: kind, parentId: 'level_test', visible: true, children: [] }]
        }),
      ),
    },
  } as never)
  return { root, meshes, material }
}

function candidate(id: string) {
  const result = collectBatchCandidate(id)
  if (!result) throw new Error(`Expected candidate: ${id}`)
  return result
}

function batches(root: Group) {
  return root.children.filter((child) => child.name === 'item-batch') as BatchedMesh[]
}

test('collects the ceiling root mesh, pruning hosted items and the grid even when opaque', () => {
  const { meshes } = setup()
  const mesh = meshes[0]!
  const grid = new Mesh(new BoxGeometry(), new MeshBasicMaterial())
  grid.name = 'ceiling-grid'
  const hosted = new Mesh(new BoxGeometry(), new MeshBasicMaterial())
  mesh.add(grid, hosted)
  sceneRegistry.nodes.set('item_hosted', hosted)
  useScene.setState({
    nodes: {
      ...useScene.getState().nodes,
      ceiling_0: { ...useScene.getState().nodes.ceiling_0, children: ['item_hosted'] },
      item_hosted: { id: 'item_hosted', type: 'item', parentId: 'ceiling_0' },
    },
  } as never)
  expect(candidate('ceiling_0').entries.map((entry) => entry.mesh)).toEqual([mesh])
  expect(collectBatchCandidate('item_hosted')).toBeNull()
  expect(getCeilingMaterials().bottomMaterial.transparent).toBe(false)
  expect(getCeilingMaterials().bottomMaterial.side).toBe(BackSide)
  expect(getCeilingMaterials().topMaterial.transparent).toBe(true)
  expect(getCeilingMaterials().topMaterial.depthWrite).toBe(false)
})

test('separates both shadow flags and preserves them through capacity growth', () => {
  const { root, meshes } = setup('ceiling', 12)
  for (let i = 0; i < 3; i++) {
    meshes[i]!.castShadow = i === 1
    meshes[i]!.receiveShadow = i === 2
  }
  const store = new NodeBatchStore(() => root)
  stores.push(store)
  store.join([candidate('ceiling_0'), candidate('ceiling_1'), candidate('ceiling_2')], 1)
  expect(batches(root).map((batch) => [batch.castShadow, batch.receiveShadow])).toEqual([
    [false, false],
    [true, false],
    [false, true],
  ])
  store.join(
    meshes.slice(3).map((_, index) => candidate(`ceiling_${index + 3}`)),
    1,
  )
  expect(batches(root)).toHaveLength(3)
  expect(
    batches(root).find((batch) => !batch.castShadow && !batch.receiveShadow)?.instanceCount,
  ).toBe(10)
  expect(batches(root).every((batch) => batch.userData.pascalExport === 'strip')).toBe(true)
})

test.each([
  'ceiling',
  'slab',
  'item',
])('unselected %s live move releases immediately and rejoins on clear', (kind) => {
  const { root, meshes } = setup(kind)
  settle()
  expect(meshes[0]!.layers.isEnabled(SCENE_LAYER)).toBe(false)
  useLiveTransforms.getState().set(`${kind}_0`, { position: [5, 0, 2], rotation: 0 })
  expect(meshes[0]!.layers.isEnabled(SCENE_LAYER)).toBe(true)
  meshes[0]!.position.set(5, 0, 2)
  settle()
  expect(collectBatchCandidate(`${kind}_0`)).toBeNull()
  expect(meshes[0]!.layers.isEnabled(SCENE_LAYER)).toBe(true)
  useLiveTransforms.getState().clear(`${kind}_0`)
  settle()
  expect(meshes[0]!.layers.isEnabled(SCENE_LAYER)).toBe(false)
  const matrix = new Matrix4()
  const batch = batches(root)[0]!
  const translations = []
  for (let i = 0; i < batch.instanceCount; i++) {
    if (batch.getMatrixAt(i, matrix)) translations.push(matrix.elements[12])
  }
  expect(translations).toContain(5)
})

test('paint fan-out releases secondary targets before swapping and never settles preview material', () => {
  const { root, meshes, material } = setup()
  settle()
  useViewer.setState({ hoveredId: 'ceiling_0' } as never)
  for (const id of ['ceiling_0', 'ceiling_1']) {
    const restore = ceilingPaint.applyPreview({
      node: useScene.getState().nodes[id]!,
      root: sceneRegistry.nodes.get(id)!,
      role: 'surface',
      material: { properties: { color: '#ff0000' } } as never,
      materialPreset: undefined,
    })!
    restores.push(restore)
  }
  expect(meshes[1]!.layers.isEnabled(SCENE_LAYER)).toBe(true)
  expect(meshes[1]!.material).not.toBe(material)
  expect(isSlotPaintPreviewActive('ceiling_1')).toBe(true)
  settle()
  expect(batches(root).every((batch) => batch.material === material)).toBe(true)
  expect(collectBatchCandidate('ceiling_1')).toBeNull()
  for (const restore of restores.splice(0).reverse()) restore()
  expect(meshes[1]!.material).toBe(material)
  settle()
  expect(meshes[1]!.layers.isEnabled(SCENE_LAYER)).toBe(false)
  expect(batches(root).every((batch) => batch.material === material)).toBe(true)
})

test('overlapping preview holds end only after the final restore; failed previews release their hold', () => {
  setup()
  const args = {
    node: useScene.getState().nodes.ceiling_0!,
    root: sceneRegistry.nodes.get('ceiling_0')!,
    role: 'surface',
    material: undefined,
    materialPreset: undefined,
  }
  const paint = createSlotPaintCapability({
    resolveRole: () => 'surface',
    applyPreview: () => () => {},
  })
  const first = paint.applyPreview(args)!
  const second = paint.applyPreview(args)!
  first()
  first()
  expect(isSlotPaintPreviewActive('ceiling_0')).toBe(true)
  second()
  expect(isSlotPaintPreviewActive('ceiling_0')).toBe(false)
  const failed = createSlotPaintCapability({
    resolveRole: () => 'surface',
    applyPreview: () => null,
  })
  expect(failed.applyPreview(args)).toBeNull()
  expect(isSlotPaintPreviewActive('ceiling_0')).toBe(false)
})

test.each([
  'mode',
  'selected-level',
])('shadow-only candidates are re-offered on %s restoration', (change) => {
  const { root, meshes } = setup()
  useViewer.setState({
    levelMode: 'solo',
    selection: { ...useViewer.getState().selection, levelId: 'level_other' },
  } as never)
  applyShadowOnly(root)
  settle()
  expect(batches(root)).toHaveLength(0)
  clearShadowOnly(root)
  if (change === 'mode') useViewer.setState({ levelMode: 'stacked' })
  else
    useViewer.setState({
      selection: { ...useViewer.getState().selection, levelId: 'level_test' },
    } as never)
  settle()
  expect(batches(root)).toHaveLength(1)
  expect(meshes.every((mesh) => !mesh.layers.isEnabled(SCENE_LAYER))).toBe(true)
})

test('external selection releases sources for outline masks and reoffers after clearing', () => {
  const { meshes } = setup()
  settle()
  useViewer.setState({ externalSelectedIds: ['ceiling_1'] } as never)
  expect(collectTintedNodes(new Set(['ceiling_1']))).toEqual(new Set(['ceiling_1']))
  frame()
  expect(meshes[1]!.layers.isEnabled(SCENE_LAYER)).toBe(true)
  useViewer.setState({ externalSelectedIds: [] })
  settle()
  expect(meshes[1]!.layers.isEnabled(SCENE_LAYER)).toBe(false)
})

test('items retain loading, animation, transparency, hidden-hitbox and dirty-rejoin guards', () => {
  const { meshes } = setup('item')
  meshes[0]!.userData.itemModelSettled = false
  expect(collectBatchCandidate('item_0')).toBeNull()
  meshes[0]!.userData.itemModelSettled = true
  meshes[0]!.userData.itemHasAnimations = true
  expect(collectBatchCandidate('item_0')).toBeNull()
  meshes[0]!.userData.itemHasAnimations = false
  meshes[0]!.material = new MeshBasicMaterial({ transparent: true })
  expect(collectBatchCandidate('item_0')).toBeNull()
  meshes[0]!.material = new MeshBasicMaterial({ visible: false })
  expect(collectBatchCandidate('item_0')).toBeNull()
  meshes[0]!.material = meshes[1]!.material
  settle()
  useScene.getState().dirtyNodes.add('item_0' as never)
  captureChangedNodes()
  useScene.getState().dirtyNodes.clear()
  frame()
  expect(meshes[0]!.layers.isEnabled(SCENE_LAYER)).toBe(true)
  settle()
  expect(meshes[0]!.layers.isEnabled(SCENE_LAYER)).toBe(false)
  useViewer.setState({ hoveredId: 'item_0' } as never)
  frame()
  itemClipRegistry.set('item_0', {} as never)
  expect(collectBatchCandidate('item_0')).toBeNull()
  itemClipRegistry.delete('item_0')
})

test.each([
  'door',
  'window',
])('%s retains host tint/override and active-animation exclusions', (kind) => {
  setup(kind)
  useScene.setState({
    nodes: {
      ...useScene.getState().nodes,
      wall_host: {
        id: 'wall_host',
        type: 'wall',
        parentId: 'level_test',
        visible: true,
        children: [`${kind}_0`],
      },
      [`${kind}_0`]: { ...useScene.getState().nodes[`${kind}_0`], parentId: 'wall_host' },
    },
  } as never)
  expect(candidate(`${kind}_0`).levelId).toBe('level_test')
  useViewer.setState({ externalSelectedIds: ['wall_host'] } as never)
  expect(collectTintedNodes(new Set([`${kind}_0`]))).toEqual(new Set([`${kind}_0`]))
  useLiveNodeOverrides.getState().set('wall_host', { visible: true } as Partial<AnyNode>)
  expect(collectBatchCandidate(`${kind}_0`)).toBeNull()
  useLiveNodeOverrides.getState().clearAll()
  useInteractive.setState({ [`${kind}Animations`]: { [`${kind}_0`]: {} } } as never)
  expect(collectBatchCandidate(`${kind}_0`)).toBeNull()
})

test('paint interaction apply then drop ends every fan-out hold without restoring committed materials', () => {
  const { meshes } = setup()
  settle()
  const targets = ['ceiling_0', 'ceiling_1', 'ceiling_2'].map((nodeId) => ({
    nodeId,
    role: 'surface',
  }))
  const owner = createPaintPreviewOwner()
  let interaction = owner.wrap({
    key: 'all-matching',
    preview: () =>
      combinePaintPreviews(
        targets.map(
          ({ nodeId, role }) =>
            ceilingPaint.applyPreview({
              node: useScene.getState().nodes[nodeId]!,
              root: sceneRegistry.nodes.get(nodeId)!,
              role,
              material: { properties: { color: '#ff0000' } } as never,
              materialPreset: undefined,
            })!,
        ),
      ),
    apply: () =>
      commitPaintScopeFanout(
        targets as never,
        { properties: { color: '#ff0000' } } as never,
        undefined,
      ),
  })
  interaction!.preview!()
  const previewMaterials = meshes.slice(0, 3).map((mesh) => mesh.material)
  settle()
  expect(targets.every(({ nodeId }) => isSlotPaintPreviewActive(nodeId))).toBe(true)
  interaction!.apply!()
  interaction = null
  expect(targets.every(({ nodeId }) => !isSlotPaintPreviewActive(nodeId))).toBe(true)
  expect(meshes.slice(0, 3).map((mesh) => mesh.material)).toEqual(previewMaterials)
  captureChangedNodes()
  useScene.getState().dirtyNodes.clear()
  settle()
  expect(meshes.slice(0, 3).every((mesh) => !mesh.layers.isEnabled(SCENE_LAYER))).toBe(true)
})

test('same-size surface rebuild replaces its reserved slot without growing used or rebuilding', () => {
  const { root, meshes } = setup('slab')
  const store = new NodeBatchStore(() => root)
  stores.push(store)
  store.join(
    meshes.map((_, i) => candidate(`slab_${i}`)),
    1,
  )
  const batch = batches(root)[0]!
  const records = (
    store as unknown as { batches: Map<string, { used: { vertices: number; indices: number } }> }
  ).batches
  const used = { ...records.values().next().value!.used }
  const range = { ...batch.getGeometryRangeAt(0)! }
  const replace = spyOn(batch, 'setGeometryAt')
  const bytes = store.stats().geometryBytesCopied
  store.release('slab_0')
  meshes[0]!.geometry = new BoxGeometry(2, 1, 1)
  store.join([candidate('slab_0')], 1)
  expect(batches(root)[0]).toBe(batch)
  expect(replace).toHaveBeenCalledTimes(1)
  expect(records.values().next().value!.used).toEqual(used)
  expect(batch.getGeometryRangeAt(0)).toEqual(range)
  expect(store.stats().overflowRebuilds).toBe(0)
  expect(store.stats().geometryReplacements).toBe(1)
  expect(store.stats().geometryBytesCopied).toBeGreaterThan(bytes)
  replace.mockRestore()
})

test('surface slot overflow rebuilds once from live reservations, reclaiming released allocations', () => {
  const { root, meshes } = setup('slab', 12)
  const store = new NodeBatchStore(() => root)
  stores.push(store)
  store.join(
    meshes.map((_, i) => candidate(`slab_${i}`)),
    1,
  )
  const old = batches(root)[0]!
  for (let i = 0; i < 11; i++) store.release(`slab_${i}`)
  meshes[0]!.geometry = new BoxGeometry(2, 1, 1, 12, 12, 12)
  store.join([candidate('slab_0')], 1)
  const batch = batches(root)[0]!
  expect(batch).not.toBe(old)
  expect(store.stats().overflowRebuilds).toBe(1)
  const liveVertices =
    Math.max(36, Math.ceil(meshes[0]!.geometry.attributes.position!.count * 1.25)) + 36
  expect(batch.geometry.attributes.position!.count).toBe(liveVertices * 2)
  expect(batch.instanceCount).toBe(2)
})

test('N releases in a frame delete once per instance and publish stats once', () => {
  const { root } = setup('slab', 20)
  settle()
  const batch = batches(root)[0]!
  const deletion = spyOn(batch, 'deleteInstance')
  const publish = spyOn(viewerExports, 'publishPerfBatchStats')
  const flush = spyOn(NodeBatchStore.prototype, 'flushReleases')
  useLiveTransforms.getState().set('slab_0', { position: [1, 0, 0], rotation: 0 })
  for (let i = 0; i < 15; i++) useScene.getState().dirtyNodes.add(`slab_${i}` as never)
  captureChangedNodes()
  useScene.getState().dirtyNodes.clear()
  frame()
  expect(flush).toHaveBeenCalledTimes(1)
  expect(deletion).toHaveBeenCalledTimes(15)
  expect(batch.instanceCount).toBe(5)
  expect(publish).toHaveBeenCalledTimes(1)
  expect(publish.mock.calls[0]![0].instances).toBe(5)
  deletion.mockRestore()
  publish.mockRestore()
  flush.mockRestore()
})

test('empty container survives until quiet, is reused by a rejoin, and expires if unused', () => {
  const { root } = setup('slab', 1)
  const store = new NodeBatchStore(() => root)
  stores.push(store)
  store.join([candidate('slab_0')], 1)
  const batch = batches(root)[0]!
  store.release('slab_0')
  store.flushReleases()
  now = 179
  store.pruneEmpty()
  expect(batches(root)[0]).toBe(batch)
  now = 181
  store.join([candidate('slab_0')], 3)
  store.pruneEmpty()
  expect(batches(root)[0]).toBe(batch)
  expect(store.stats().overflowRebuilds).toBe(0)
  store.release('slab_0')
  store.flushReleases()
  now += 181
  store.pruneEmpty()
  expect(batches(root)).toHaveLength(0)
})

test('level surfaces wait through wall override, wall queue drain and quiet, then join in one wave', () => {
  const { root, meshes } = setup('slab', 6)
  const level2 = new Group()
  sceneRegistry.nodes.set('level_second', level2)
  sceneRegistry.byType.level.add('level_second')
  const nodes = {
    ...useScene.getState().nodes,
    wall_drag: { id: 'wall_drag', type: 'wall', parentId: 'level_test', children: [] },
    level_second: { id: 'level_second', type: 'level', children: [] },
  } as Record<string, any>
  for (let i = 3; i < 6; i++) {
    level2.add(meshes[i]!)
    nodes[`slab_${i}`] = { ...nodes[`slab_${i}`], parentId: 'level_second' }
  }
  useScene.setState({ nodes } as never)
  settle()
  const join = spyOn(NodeBatchStore.prototype, 'join')
  let pending = 0
  const queue = spyOn(viewerExports, 'getPendingWallRebuildCount').mockImplementation(() => pending)
  useLiveNodeOverrides.getState().set('wall_drag', { visible: true } as Partial<AnyNode>)
  for (const id of ['slab_0', 'slab_1', 'slab_3']) useScene.getState().dirtyNodes.add(id as never)
  captureChangedNodes()
  useScene.getState().dirtyNodes.clear()
  settle()
  expect(meshes[0]!.layers.isEnabled(SCENE_LAYER)).toBe(true)
  expect(meshes[1]!.layers.isEnabled(SCENE_LAYER)).toBe(true)
  expect(meshes[2]!.layers.isEnabled(SCENE_LAYER)).toBe(false)
  expect(meshes[3]!.layers.isEnabled(SCENE_LAYER)).toBe(false)
  expect(batches(root)[0]!.instanceCount).toBe(1)
  pending = 2
  useLiveNodeOverrides.getState().clearAll()
  settle()
  expect(meshes[0]!.layers.isEnabled(SCENE_LAYER)).toBe(true)
  pending = 0
  frame()
  now += 179
  frame()
  expect(meshes[0]!.layers.isEnabled(SCENE_LAYER)).toBe(true)
  join.mockClear()
  now += 2
  frame()
  expect(meshes.slice(0, 3).every((mesh) => !mesh.layers.isEnabled(SCENE_LAYER))).toBe(true)
  expect(join).toHaveBeenCalledTimes(1)
  expect(join.mock.calls[0]![0].map(({ nodeId }) => nodeId)).toEqual(['slab_0', 'slab_1'])
  join.mockRestore()
  queue.mockRestore()
})

test('superseded, cancelled and failed paint interactions end holds once without ending a newer owner', () => {
  setup()
  let restored = 0
  const paint = createSlotPaintCapability({
    resolveRole: () => 'surface',
    applyPreview: () => () => {
      restored++
    },
  })
  const owner = createPaintPreviewOwner()
  const interaction = (key: string, apply = () => {}) =>
    owner.wrap({
      key,
      apply,
      preview: () =>
        combinePaintPreviews([
          paint.applyPreview({
            node: useScene.getState().nodes.ceiling_0!,
            root: sceneRegistry.nodes.get('ceiling_0')!,
            role: 'surface',
            material: undefined,
            materialPreset: undefined,
          })!,
        ]),
    })!
  const first = interaction('first')
  const cancelFirst = first.preview!()!
  const second = interaction('second')
  const cancelSecond = second.preview!()!
  expect(restored).toBe(1)
  cancelFirst()
  expect(isSlotPaintPreviewActive('ceiling_0')).toBe(true)
  second.apply!()
  cancelSecond()
  expect(restored).toBe(1)
  expect(isSlotPaintPreviewActive('ceiling_0')).toBe(false)
  const cancel = interaction('cancel').preview!()!
  cancel()
  cancel()
  expect(restored).toBe(2)
  expect(isSlotPaintPreviewActive('ceiling_0')).toBe(false)
  const failed = interaction('failed', () => {
    throw new Error('commit failed')
  })
  failed.preview!()
  expect(() => failed.apply!()).toThrow('commit failed')
  expect(restored).toBe(2)
  expect(isSlotPaintPreviewActive('ceiling_0')).toBe(false)
})

test('deleting the last members schedules empty-container expiry without a rejoin candidate', () => {
  const { root } = setup('slab', 3)
  settle()
  const batch = batches(root)[0]!
  if (wakeRef.current) clearTimeout(wakeRef.current)
  wakeRef.current = null
  for (let i = 0; i < 3; i++) {
    sceneRegistry.nodes.delete(`slab_${i}`)
    sceneRegistry.byType.slab.delete(`slab_${i}`)
  }
  frame()
  expect(batch.instanceCount).toBe(0)
  expect(batches(root)).toHaveLength(1)
  expect(wakeRef.current).not.toBeNull()
  now += 181
  frame()
  expect(batches(root)).toHaveLength(0)
})

test('level remount releases orphaned draws and restores sources before collecting replacement batches', () => {
  const { root, meshes } = setup('slab')
  settle()
  const replacement = new Group()
  replacement.add(...meshes)
  sceneRegistry.nodes.set('level_test', replacement)
  frame()
  expect(batches(root)).toHaveLength(0)
  expect(meshes.every((mesh) => mesh.layers.isEnabled(SCENE_LAYER))).toBe(true)
  settle()
  expect(batches(replacement)).toHaveLength(1)
  expect(meshes.every((mesh) => !mesh.layers.isEnabled(SCENE_LAYER))).toBe(true)
})

test('paint apply throwing after publication ends fan-out holds without restoring and dirties every target', () => {
  const { meshes } = setup()
  const targets = ['ceiling_0', 'ceiling_1', 'ceiling_2'].map((nodeId) => ({
    nodeId,
    role: 'surface',
  }))
  const interaction = createPaintPreviewOwner().wrap({
    key: 'fan-out',
    preview: () =>
      combinePaintPreviews(
        targets.map(
          ({ nodeId, role }) =>
            ceilingPaint.applyPreview({
              node: useScene.getState().nodes[nodeId]!,
              root: sceneRegistry.nodes.get(nodeId)!,
              role,
              material: { properties: { color: '#ff0000' } } as never,
              materialPreset: undefined,
            })!,
        ),
      ),
    apply: () => commitPaintScopeFanout(targets as never, undefined, 'library:test/finish'),
  })!
  const cancel = interaction.preview!()!
  const previews = meshes.slice(0, 3).map((mesh) => mesh.material)
  const failure = new Error('subscriber failed after write')
  const unsubscribeScene = useScene.subscribe((state, previous) => {
    if (state.nodes !== previous.nodes) throw failure
  })
  try {
    expect(() => interaction.apply!()).toThrow(failure)
  } finally {
    unsubscribeScene()
  }
  cancel()
  for (const { nodeId } of targets) {
    expect(
      (useScene.getState().nodes[nodeId] as AnyNode & { slots: Record<string, string> }).slots
        .surface,
    ).toBe('library:test/finish')
    expect(isSlotPaintPreviewActive(nodeId)).toBe(false)
    expect(useScene.getState().dirtyNodes.has(nodeId as never)).toBe(true)
  }
  expect(meshes.slice(0, 3).map((mesh) => mesh.material)).toEqual(previews)
})

test('a throwing preview listener rolls back its hold before preview creation', () => {
  setup()
  const unsubscribePreview = subscribeSlotPaintPreviews(() => {
    throw new Error('preview listener failed')
  })
  let applied = false
  const paint = createSlotPaintCapability({
    resolveRole: () => 'surface',
    applyPreview: () => {
      applied = true
      return () => {}
    },
  })
  try {
    expect(() =>
      paint.applyPreview({
        node: useScene.getState().nodes.ceiling_0!,
        root: sceneRegistry.nodes.get('ceiling_0')!,
        role: 'surface',
        material: undefined,
        materialPreset: undefined,
      }),
    ).toThrow('preview listener failed')
    expect(isSlotPaintPreviewActive('ceiling_0')).toBe(false)
    expect(applied).toBe(false)
  } finally {
    unsubscribePreview()
  }
})
