import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  createSceneApi,
  DoorNode,
  getHostAttachmentSurface,
  getSurfaceProvider,
  ItemNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  resolveSurfacePlacement,
  ShelfNode,
  surfaceRegionContainsPoint,
  useScene,
  WallFeatureNode,
  WallNode,
} from '@pascal-app/core'
import { cloneLevelSubtree } from '@pascal-app/core/clone-scene-graph'
import { nodeLevelFrame } from '@pascal-app/core/procedural-items'
import { cloneNodesInto } from '@pascal-app/core/registry'
import { surfaceAttachmentId, surfaceFramePose, updateSurfaceNode } from '@pascal-app/editor'
import {
  itemDefinition,
  shelfDefinition,
  wallFeatureDefinition,
  wallFeatureSupportHeight,
  wallFeatureTrimRanges,
} from '@pascal-app/nodes'

globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}

const original = useScene.getState()
let restore: () => void
beforeEach(() => {
  restore = nodeRegistry._snapshot()
  registerNode(wallFeatureDefinition)
  registerNode(itemDefinition)
})
afterEach(() => {
  restore()
  useScene.setState(original)
  useScene.temporal.getState().clear()
})

function setup(mode: 'niche' | 'bump' = 'niche', face: 'a' | 'b' = 'a') {
  const level = LevelNode.parse({ height: 3 })
  const wall = WallNode.parse({ parentId: level.id, start: [2, 1], end: [2, 6], thickness: 0.3 })
  const feature = WallFeatureNode.parse({
    parentId: wall.id,
    mode,
    face,
    u: 2,
    width: 1,
    height: 1,
    bottom: 0.5,
    depth: 0.2,
  })
  const item = ItemNode.parse({
    parentId: feature.id,
    asset: {
      id: 'probe',
      name: 'Probe',
      category: 'decor',
      thumbnail: '',
      src: '/probe.glb',
      dimensions: [0.1, 0.1, 0.1],
    },
  })
  feature.children = [item.id]
  wall.children = [feature.id]
  level.children = [wall.id]
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [level, wall, feature, item].map((n) => [n.id, n]),
  )
  useScene.setState({ nodes, rootNodeIds: [level.id], readOnly: false, dirtyNodes: new Set() })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  const scene = createSceneApi(useScene)
  const provider = getSurfaceProvider(feature)
  const surface = provider.surfaces!(feature, { scene })[0]!
  return { nodes, level, wall, feature, item, scene, provider, surface }
}

test('both faces expose bounded niche shelves and bump tops through the registered hosting protocol', () => {
  for (const mode of ['niche', 'bump'] as const)
    for (const face of ['a', 'b'] as const) {
      const { feature, scene, surface } = setup(mode, face)
      const pose = resolveSurfacePlacement({
        host: feature,
        childKind: 'item',
        childId: 'item_probe',
        childFootprint: { size: [0.1, 0.1, 0.1], rotationY: 0 },
        hit: { point: surface.position, normalWorldY: 1 },
        scene,
      })
      expect(pose?.surfaceId).toBe('resting')
      expect(pose?.childFrame).toBe('surface-local')
      expect(pose?.surfaceLocal?.position.every((value) => Math.abs(value) < 1e-9)).toBe(true)
      expect(surface.position[1]).toBe(mode === 'bump' ? feature.height : 0)
      expect(
        resolveSurfacePlacement({
          host: feature,
          childKind: 'item',
          childId: 'item_probe',
          childFootprint: { size: [0.1, 0.1, 0.1], rotationY: 0 },
          hit: {
            point: [surface.position[0], surface.position[1], surface.position[2] + 0.3],
            normalWorldY: 1,
          },
          scene,
        }),
      ).toBeNull()
    }
})

test('surface-local attachments round-trip through editor writes and follow host height and wall transformations', () => {
  const { item, feature, wall, scene, surface } = setup('bump', 'b')
  const stored = surfaceFramePose(
    feature.id,
    surface.id,
    { position: [...surface.position], rotation: [0, 0, 0] },
    true,
  )
  updateSurfaceNode(item.id, { ...stored, parentId: feature.id }, surface.id)
  expect(surfaceAttachmentId(scene.get(item.id)!)).toBe('resting')
  expect(
    getHostAttachmentSurface(scene.get(feature.id)!, item.id, scene.nodes())?.position,
  ).toEqual(surface.position)
  const first = nodeLevelFrame(item.id, scene.nodes()).position
  first.forEach((value, i) => {
    expect(value).toBeCloseTo([2.25, 1.5, 3][i]!)
  })
  scene.update(feature.id, { height: 1.3, u: 3 })
  const raised = nodeLevelFrame(item.id, scene.nodes()).position
  raised.forEach((value, i) => {
    expect(value).toBeCloseTo([2.25, 1.8, 4][i]!)
  })
  scene.update(wall.id, { start: [1, 2], end: [6, 2] })
  const rotated = nodeLevelFrame(item.id, scene.nodes()).position
  rotated.forEach((value, i) => {
    expect(value).toBeCloseTo([4, 1.8, 1.75][i]!)
  })
  expect(surfaceFramePose(feature.id, 'resting', stored, false).position[1]).toBe(1.3)
})

test('nested shelves and support-height sampling agree with the rendered host frame', () => {
  const { feature: bump, nodes, wall, scene } = setup('bump', 'a')
  const niche = WallFeatureNode.parse({
    parentId: bump.id,
    u: 0.5,
    bottom: 0.3,
    width: 0.6,
    height: 0.4,
    depth: 0.15,
  })
  nodes[niche.id] = niche
  bump.children.push(niche.id)
  const surface = getSurfaceProvider(niche).surfaces!(niche, { scene })[0]!
  expect(surface.position[1]).toBe(0)
  const frame = nodeLevelFrame(niche.id, nodes)
  expect(frame.position[1]).toBeCloseTo(0.8)
  expect(wallFeatureSupportHeight(niche, 2 - 0.275, 3, { nodes })).toBeCloseTo(0.8)
  expect(wallFeatureSupportHeight(niche, 2, 3, { nodes })).toBeNull()
  nodes[wall.id] = { ...wall, visible: false }
  expect(getSurfaceProvider(niche).surfaces!(niche, { scene })).toHaveLength(0)
})

test('subtree and level copies retain the hosted item resting frame with fresh attachment IDs', () => {
  const { feature, item, wall, level, nodes } = setup('bump', 'b')
  feature.attachments[item.id] = 'resting'
  const originalFrame = nodeLevelFrame(item.id, nodes)
  const subtree = cloneNodesInto([feature, item], { rootId: feature.id, parentId: wall.id })
  const levelCopy = cloneLevelSubtree(nodes as Record<AnyNode['id'], AnyNode>, level.id)
  for (const copy of [
    { nodes: subtree.nodes, idMap: subtree.idMap },
    { nodes: levelCopy.clonedNodes, idMap: levelCopy.idMap },
  ]) {
    const copiedNodes = {
      ...nodes,
      ...Object.fromEntries(copy.nodes.map((node) => [node.id, node])),
    }
    const copiedFeature = copiedNodes[copy.idMap.get(feature.id)!] as WallFeatureNode
    const copiedItemId = copy.idMap.get(item.id)!
    expect(copiedFeature.attachments).toEqual({ [copiedItemId]: 'resting' })
    expect(getHostAttachmentSurface(copiedFeature, copiedItemId, copiedNodes)?.id).toBe('resting')
    const copiedFrame = nodeLevelFrame(copiedItemId, copiedNodes)
    copiedFrame.position.forEach((value, i) => {
      expect(value).toBeCloseTo(originalFrame.position[i]!)
    })
  }
})

test('openings and niches reaching a bump top remove the corresponding resting region', () => {
  const { feature, nodes, wall, scene } = setup('bump')
  const door = DoorNode.parse({ parentId: wall.id, position: [2, 1, 0], width: 0.3, height: 2 })
  nodes[door.id] = door
  const surface = getSurfaceProvider(feature).surfaces!(feature, { scene })[0]!
  expect(surfaceRegionContainsPoint(surface.region, [0, 0])).toBe(false)
  expect(surfaceRegionContainsPoint(surface.region, [0.3, 0])).toBe(true)
  delete nodes[door.id]
  const niche = WallFeatureNode.parse({
    parentId: feature.id,
    u: 0.5,
    bottom: 0.5,
    width: 0.4,
    height: 0.5,
    depth: 0.2,
  })
  nodes[niche.id] = niche
  const cut = getSurfaceProvider(feature).surfaces!(feature, { scene })[0]!
  expect(surfaceRegionContainsPoint(cut.region, [0, 0])).toBe(false)
})

test('trim interruptions are limited to visible features crossing the same physical face and elevation', () => {
  const { feature, wall, nodes } = setup('bump', 'b')
  expect(wallFeatureTrimRanges(wall, 'b', nodes, 0.9, 0.1)).toEqual([[1.5, 2.5]])
  expect(wallFeatureTrimRanges(wall, 'a', nodes, 0.9, 0.1)).toEqual([])
  expect(wallFeatureTrimRanges(wall, 'b', nodes, 1.5, 0.1)).toEqual([])
  expect(
    wallFeatureTrimRanges(
      wall,
      'b',
      { ...nodes, [feature.id]: { ...feature, visible: false } },
      0.9,
      0.1,
    ),
  ).toEqual([])
})

test('host-local shelf providers retain the stored pose when a named row is supplied', () => {
  const { nodes } = setup()
  registerNode(shelfDefinition)
  const shelf = ShelfNode.parse({ id: 'shelf_frame-probe', height: 1.8, rows: 3, style: 'cubby' })
  nodes[shelf.id] = shelf
  const surface = getSurfaceProvider(shelf).surfaces!(shelf, {
    scene: createSceneApi(useScene),
  })[0]!
  const pose = {
    position: [...surface.position] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
  }
  expect(surfaceFramePose(shelf.id, surface.id, pose, true)).toEqual(pose)
  expect(surfaceFramePose(shelf.id, surface.id, pose, false)).toEqual(pose)
})
