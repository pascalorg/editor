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
import { applyShadowOnly, clearShadowOnly } from '../../../../viewer/src/lib/shadow-only'
import { getCeilingMaterials } from '../../ceiling/materials'
import { ceilingPaint } from '../../ceiling/paint'
import { createSlotPaintCapability, isSlotPaintPreviewActive } from '../slot-paint'
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
