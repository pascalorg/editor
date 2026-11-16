import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { type AnyNode, nodeRegistry } from '@pascal-app/core'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import { resolveGlbPick, xrayActive } from '../index'
import { mergeBakedStatic } from './glb-merge'
import { BATCHED_LAYER, SCENE_LAYER, SHADOW_ONLY_LAYER } from './layers'
import { filterSectionHits, SECTION_DEFAULTS } from './section'
import { applyShadowOnly, clearShadowOnly } from './shadow-only'
import {
  createFamilyVisibility,
  filterXrayHits,
  viewerShadowSignature,
  xrayShadowSignature,
} from './xray'

let restore: () => void
beforeEach(() => {
  restore = nodeRegistry._snapshot()
  for (const [kind, family] of [
    ['level', null],
    ['wall', 'walls'],
    ['item', 'items'],
  ] as const)
    nodeRegistry._register({
      kind,
      schemaVersion: 1,
      extensions: { 'pascal:viewer': { family } },
    } as never)
})
afterEach(() => restore())

function fixture(hosted = false) {
  const root = new Group()
  root.userData = { kind: 'level', pascalId: 'level_0' }
  const material = new MeshBasicMaterial()
  const wall = new Mesh(new BoxGeometry(), material)
  wall.castShadow = true
  wall.userData = { kind: 'wall', pascalId: 'wall_0' }
  const item = new Mesh(new BoxGeometry(), material)
  item.castShadow = true
  item.userData = { kind: 'item', pascalId: 'item_0' }
  root.add(wall)
  if (hosted) wall.add(item)
  else root.add(item)
  const nodes = Object.fromEntries(
    [root, wall, item].map((object) => [
      object.userData.pascalId,
      { id: object.userData.pascalId, type: object.userData.kind } as AnyNode,
    ]),
  )
  const owner = (object: Group) => nodes[object.userData.pascalId]
  return { root, wall, item, owner }
}

test('family masks do not cascade, preserve solo, compose with a cut, and restore for walkthrough', () => {
  const { root, wall, item, owner } = fixture(true)
  const visibility = createFamilyVisibility()
  const state = { xrayFamily: 'items' }
  visibility.update(root, owner, state)
  expect(wall.visible).toBe(true)
  expect(wall.layers.isEnabled(SCENE_LAYER)).toBe(false)
  expect(wall.layers.isEnabled(SHADOW_ONLY_LAYER)).toBe(false)
  expect(item.layers.isEnabled(SCENE_LAYER)).toBe(true)
  const hits = [
    { object: wall, point: new Vector3(0, -1, 0) },
    { object: item, point: new Vector3(0, -1, 0) },
  ]
  expect(filterXrayHits(hits, state)).toEqual([hits[1]])
  expect(
    filterSectionHits(filterXrayHits(hits, state), { ...SECTION_DEFAULTS, sectionEnabled: true }),
  ).toEqual([hits[1]])
  applyShadowOnly(wall)
  visibility.update(root, owner, { ...state, walkthroughMode: true })
  expect(wall.layers.isEnabled(SHADOW_ONLY_LAYER)).toBe(true)
  expect(filterXrayHits(hits, { xrayFamily: null })).toBe(hits)
  visibility.clear()
  clearShadowOnly(wall)
  expect(wall.layers.isEnabled(SCENE_LAYER)).toBe(true)
})

test('a mixed-family baked merge falls back to original geometry and hidden hits fall through', () => {
  const { root, wall, item, owner } = fixture()
  const merge = mergeBakedStatic(root, () => undefined, { keepIds: new Set(), animated: new Set() })
  expect(merge.merged).toBe(2)
  const batch = merge.batches[0]!
  const geometry = batch.geometry
  const signature = merge.visibilitySignature()
  merge.setUnmerged(false)
  expect(merge.batches[0]).toBe(batch)
  expect(merge.visibilitySignature()).toBe(signature)
  const visibility = createFamilyVisibility()
  merge.setUnmerged(true)
  visibility.update(root, owner, { xrayFamily: 'items' })
  expect(batch.layers.isEnabled(SCENE_LAYER)).toBe(false)
  expect(wall.layers.isEnabled(SCENE_LAYER)).toBe(false)
  expect(wall.layers.isEnabled(BATCHED_LAYER)).toBe(false)
  expect(item.layers.isEnabled(SCENE_LAYER)).toBe(true)
  const identity = new Map([
    ['level_0', root],
    ['wall_0', wall],
    ['item_0', item],
  ])
  const hits = [
    { object: wall, point: new Vector3() },
    { object: item, point: new Vector3() },
  ]
  expect(resolveGlbPick(filterXrayHits(hits, { xrayFamily: 'items' }), identity)?.nodeId).toBe(
    'item_0',
  )
  merge.setUnmerged(false)
  visibility.clear()
  expect(merge.batches[0]!.geometry).toBe(geometry)
  expect(merge.visibilitySignature()).toBe(signature)
  expect(wall.layers.isEnabled(BATCHED_LAYER)).toBe(true)
  merge.dispose()
})

test('daylight shadows change family signatures and suspend isolation while walking', () => {
  expect(xrayActive({ xrayFamily: null })).toBe(false)
  expect(xrayActive({ xrayFamily: 'items' })).toBe(true)
  expect(xrayActive({ xrayFamily: 'items', walkthroughMode: true })).toBe(false)
  expect(xrayShadowSignature({ xrayFamily: 'items' })).not.toBe(
    xrayShadowSignature({ xrayFamily: 'walls' }),
  )
  expect(xrayShadowSignature({ xrayFamily: 'items', walkthroughMode: true })).toBe(
    xrayShadowSignature({ xrayFamily: null }),
  )
})

test('the main viewer entry exposes host taxonomy without internal resolvers or cache helpers', async () => {
  const api = await import('../index')
  expect('xrayShadowSignature' in api).toBe(false)
  expect('resolveFamilyVisibility' in api).toBe(false)
  expect('resolveDaylightSite' in api).toBe(false)
  expect(api.VIEWER_FAMILIES).toContain('other')
})

test('default shadow family signature does not serialize per frame', () => {
  const serialize = spyOn(JSON, 'stringify')
  try {
    xrayShadowSignature({ xrayFamily: null })
    xrayShadowSignature({ xrayFamily: null })
    expect(serialize).not.toHaveBeenCalled()
  } finally {
    serialize.mockRestore()
  }
})

test('default presentation shadows return a constant without reading section parameters', () => {
  const state = {
    ...SECTION_DEFAULTS,
    xrayFamily: null,
    get sectionAxis(): never {
      throw new Error('default signature formatted section parameters')
    },
  }
  expect(viewerShadowSignature(state)).toBe('')
  expect(viewerShadowSignature(state)).toBe('')
  expect(viewerShadowSignature({ ...SECTION_DEFAULTS, xrayFamily: 'walls' })).not.toBe('')
})

test('full section changes leave the combined daylight shadow signature unchanged', () => {
  const state = { ...SECTION_DEFAULTS, xrayFamily: null }
  const before = viewerShadowSignature(state)
  expect(viewerShadowSignature({ ...state, sectionEnabled: true })).toBe(before)
  expect(
    viewerShadowSignature({
      ...state,
      sectionEnabled: true,
      sectionAxis: 'z',
      sectionPosition: 7,
      sectionFlipped: true,
    }),
  ).toBe(before)
  const cut = { ...state, sectionEnabled: true, sectionShadows: 'cut' as const }
  expect(viewerShadowSignature(cut)).not.toBe(before)
  expect(viewerShadowSignature({ ...cut, sectionPosition: 2 })).not.toBe(viewerShadowSignature(cut))
})
