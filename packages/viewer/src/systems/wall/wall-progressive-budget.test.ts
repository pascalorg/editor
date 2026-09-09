import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  DoorNode,
  sceneRegistry,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import * as THREE from 'three'
import { shouldDeferWallRebuild } from './wall-system'

describe('progressive wall budget', () => {
  const openings = Array.from({ length: 6 }, (_, index) =>
    (index % 2 ? DoorNode : WindowNode).parse({ position: [index, 1, 0] }),
  )
  const cheap = WallNode.parse({ start: [0, 0], end: [8, 0], children: [] })
  const heavy = WallNode.parse({
    start: [0, 0],
    end: [8, 0],
    children: openings.map((opening) => opening.id),
  })
  const nodes: Record<AnyNodeId, AnyNode> = Object.fromEntries(
    [cheap, heavy, ...openings].map((node) => [node.id, node]),
  )

  function frame(walls: WallNode[]): string[] {
    const rebuilt: string[] = []
    for (const wall of walls) {
      if (shouldDeferWallRebuild(wall.id, nodes, rebuilt.length, 0)) break
      rebuilt.push(wall.id)
    }
    return rebuilt
  }

  test('defers a heavy wall after a cheap wall and rebuilds it at the start of the next frame', () => {
    expect(frame([cheap, heavy])).toEqual([cheap.id])
    expect(frame([heavy])).toEqual([heavy.id])
  })

  test('counts hosted cutouts rather than all children', () => {
    const five = { ...heavy, children: [...heavy.children.slice(0, 5), cheap.id] }
    expect(shouldDeferWallRebuild(five.id, { ...nodes, [five.id]: five }, 1, 0)).toBe(false)
    expect(shouldDeferWallRebuild(heavy.id, nodes, 1, 0)).toBe(true)
  })

  test('retains the eight-wall and eight-millisecond limits while allowing initial progress', () => {
    expect(shouldDeferWallRebuild(cheap.id, nodes, 7, 7.9)).toBe(false)
    expect(shouldDeferWallRebuild(cheap.id, nodes, 8, 0)).toBe(true)
    expect(shouldDeferWallRebuild(cheap.id, nodes, 1, 8)).toBe(true)
    expect(shouldDeferWallRebuild(heavy.id, nodes, 0, 100)).toBe(false)
  })

  test('counts item cutout proxies but skips ordinary items', () => {
    const item = { id: 'item_budget-test', type: 'item' } as AnyNode
    const wall = { ...heavy, children: [...heavy.children.slice(0, 5), item.id] }
    const sceneNodes = { ...nodes, [wall.id]: wall, [item.id]: item }
    const mesh = new THREE.Group()
    const proxy = new THREE.Mesh(new THREE.BoxGeometry())
    proxy.name = 'cutout'
    sceneRegistry.nodes.set(item.id, mesh)
    try {
      expect(shouldDeferWallRebuild(wall.id, sceneNodes, 1, 0)).toBe(false)
      mesh.add(proxy)
      expect(shouldDeferWallRebuild(wall.id, sceneNodes, 1, 0)).toBe(true)
    } finally {
      sceneRegistry.nodes.delete(item.id)
      proxy.geometry.dispose()
    }
  })
})
