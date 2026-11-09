// @ts-expect-error — Bun types are not part of the viewer's production declaration build.
import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { mergeBakedStatic } from './glb-merge'
import { BATCHED_LAYER, SCENE_LAYER } from './layers'

const wall = new THREE.MeshStandardMaterial({ name: 'wall' })
const glass = new THREE.MeshStandardMaterial({ name: 'glass', transparent: true })

function mesh(material: THREE.Material, x: number, extras: Record<string, unknown> = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)
  m.position.x = x
  Object.assign(m.userData, extras)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

/** One level: three walls, a glass pane, a window sash (animated) with two parts and a pane, a ceiling. */
function house() {
  const root = new THREE.Group()
  const level = new THREE.Group()
  level.userData = { kind: 'level', pascalId: 'level_0' }
  root.add(level)
  const walls = [0, 1, 2].map((x) => {
    const owner = new THREE.Group()
    owner.userData = { kind: 'wall', pascalId: `wall_${x}` }
    owner.add(mesh(wall, x))
    level.add(owner)
    return owner.children[0] as THREE.Mesh
  })
  const pane = mesh(glass, 4)
  level.add(pane)
  const sash = new THREE.Group()
  sash.name = 'sash'
  const window = new THREE.Group()
  window.userData = { kind: 'window', pascalId: 'window_0' }
  window.add(sash)
  level.add(window)
  const sashParts = [mesh(wall, 5), mesh(wall, 6)]
  const sashGlass = [mesh(glass, 5.5), mesh(glass, 6.5)]
  sash.add(...sashParts, ...sashGlass)
  const ceiling = new THREE.Group()
  ceiling.userData = { kind: 'ceiling', pascalId: 'ceiling_0' }
  ceiling.add(mesh(wall, 0), mesh(wall, 1))
  level.add(ceiling)
  return { root, level, walls, pane, sash, sashParts, sashGlass, ceiling }
}

describe('baked static merge', () => {
  test('merges static meshes per level, moving parts under their pivot, and keeps the rest', () => {
    const h = house()
    const merge = mergeBakedStatic(h.root, () => undefined, {
      keepIds: new Set(),
      animated: new Set([h.sash]),
    })
    // Walls (level), sash parts (pivot), sash panes (glass, but inside one moving part).
    expect(merge.batches).toHaveLength(3)
    expect(merge.batches.filter((b) => b.parent === h.level)).toHaveLength(1)
    expect(merge.batches.filter((b) => b.parent === h.sash)).toHaveLength(2)
    expect(merge.merged).toBe(7)
    // Originals leave the scene layer for the batched layer; loose glass and ceilings stay drawn.
    for (const m of [...h.walls, ...h.sashParts, ...h.sashGlass]) {
      expect(m.layers.isEnabled(SCENE_LAYER)).toBe(false)
      expect(m.layers.isEnabled(BATCHED_LAYER)).toBe(true)
    }
    expect(h.pane.layers.isEnabled(SCENE_LAYER)).toBe(true)
    for (const m of h.ceiling.children) expect(m.layers.isEnabled(SCENE_LAYER)).toBe(true)
    // Batches never answer rays: picks resolve on the originals.
    const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1))
    expect(raycaster.intersectObjects(merge.batches, false)).toHaveLength(0)
    // The level batch carries the three walls' triangles.
    const wallBatch = merge.batches.find((b) => b.parent === h.level)!
    expect(wallBatch.geometry.index!.count).toBe(3 * h.walls[0]!.geometry.index!.count)

    merge.dispose()
    for (const m of [...h.walls, ...h.sashParts, ...h.sashGlass])
      expect(m.layers.isEnabled(SCENE_LAYER)).toBe(true)
    expect(h.level.children.some((c) => c.userData.glbBatch)).toBe(false)
  })

  test('interactive items stay individual', () => {
    const h = house()
    const merge = mergeBakedStatic(h.root, () => undefined, {
      keepIds: new Set(['wall_0']),
      animated: new Set(),
    })
    expect(h.walls[0]!.layers.isEnabled(SCENE_LAYER)).toBe(true)
    expect(h.walls[1]!.layers.isEnabled(SCENE_LAYER)).toBe(false)
    merge.dispose()
  })

  test('hiding a merged original on its own changes the visibility signature', () => {
    const h = house()
    const merge = mergeBakedStatic(h.root, () => undefined, {
      keepIds: new Set(),
      animated: new Set(),
    })
    const before = merge.visibilitySignature()
    h.walls[1]!.parent!.visible = false
    expect(merge.visibilitySignature()).not.toBe(before)
    h.walls[1]!.parent!.visible = true
    expect(merge.visibilitySignature()).toBe(before)
    // The level itself hiding is the batch's parent's job, not a reason to rebuild.
    h.level.visible = false
    expect(merge.visibilitySignature()).toBe(before)
    merge.dispose()
  })
})
