import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  getSurfaceProvider,
  ItemNode,
  nodeRegistry,
  type SceneApi,
  ShelfNode,
  type SurfaceProvider,
} from '@pascal-app/core'
import { ProceduralItemNode, shelfRecipe } from '@pascal-app/core/procedural-items'
import { Box3, type Mesh } from 'three'
import { cabinetDefinition } from '../../cabinet/definition'
import { CabinetModuleNode, CabinetNode } from '../../cabinet/schema'
import { shelfDefinition } from '../definition'
import { buildShelfGeometry } from '../geometry'

let restore: () => void
beforeEach(() => {
  restore = nodeRegistry._snapshot()
  nodeRegistry._reset()
  nodeRegistry._register(shelfDefinition)
  nodeRegistry._register(cabinetDefinition)
})
afterEach(() => restore())

function sceneFor(nodes: AnyNode[]): SceneApi {
  const map = Object.fromEntries(nodes.map((n) => [n.id, n]))
  return { nodes: () => map, get: (id: AnyNodeId) => map[id] } as SceneApi
}

for (const style of ['wall-shelf', 'bookshelf', 'open-rack', 'cubby'] as const) {
  test.each([
    false,
    true,
  ])(`${style}, bottom %s: every row region matches the board mesh`, (withBottom) => {
    for (const withSides of [false, true]) {
      const host = ShelfNode.parse({
        style,
        withBottom,
        withSides,
        rows: 3,
        width: 1.2,
        depth: 0.5,
      })
      const mesh = buildShelfGeometry(host)
      const boards = mesh.children.filter((m) => m.name.startsWith('shelf-board-'))
      const surfaces = getSurfaceProvider(host).surfaces!(host, { scene: sceneFor([host]) })
      expect(surfaces).toHaveLength(boards.length)
      for (const surface of surfaces) {
        const bottom = withBottom && (style === 'bookshelf' || style === 'cubby')
        const index = Number(surface.id.split(':')[1])
        const board = boards.find(
          (m) =>
            m.name ===
            (bottom && index === 0
              ? 'shelf-board-bottom'
              : `shelf-board-${index - (bottom ? 1 : 0)}`),
        )!
        const box = new Box3().setFromObject(board)
        expect(surface.region.size![0] * 2).toBeCloseTo(box.max.x - box.min.x, 6)
        expect(surface.region.size![1] * 2).toBeCloseTo(box.max.z - box.min.z, 6)
        expect(surface.region.center ?? [0, 0]).toEqual([0, 0])
      }
      mesh.traverse((object) => (object as Mesh).geometry?.dispose())
    }
  })
}

test('every declaring provider publishes regions; ray-derived providers declare no surfaces', () => {
  const module = CabinetModuleNode.parse({})
  const cabinet = CabinetNode.parse({
    children: [module.id],
    withCountertop: true,
    barLedge: { edge: 'back', height: 1.2, depth: 0.4 },
  })
  const shelf = ShelfNode.parse({ rows: 3 })
  const procedural = ProceduralItemNode.parse({ recipe: shelfRecipe })
  const item = ItemNode.parse({
    asset: {
      id: 'sofa',
      name: 'Sofa',
      category: 'decor',
      thumbnail: '',
      src: '/sofa.glb',
      dimensions: [2, 1, 2],
      surface: { height: 0.8 },
    },
  })
  const arbitrary = { id: 'plugin_host', type: 'plugin-host' } as unknown as AnyNode
  const nodes = [
    cabinet,
    { ...module, parentId: cabinet.id },
    shelf,
    procedural,
    item,
    arbitrary,
  ] as AnyNode[]
  const scene = sceneFor(nodes)
  const declaring: SurfaceProvider[] = []
  for (const host of [cabinet, shelf, procedural] as AnyNode[]) {
    const provider = getSurfaceProvider(host)
    declaring.push(provider)
    const surfaces = provider.surfaces!(host, { scene })
    expect(surfaces.length).toBeGreaterThan(0)
    for (const surface of surfaces) {
      expect(surface.id).not.toBeNull()
      expect(surface.region).toBeDefined()
      expect(surface.region.size?.every((extent) => extent > 0)).toBe(true)
    }
  }
  expect(new Set(declaring).size).toBe(3)
  for (const host of [item, arbitrary]) {
    const provider = getSurfaceProvider(host)
    expect(provider.surfaces).toBeUndefined()
    const surface = provider.resolveHit(
      host,
      { point: [0.1, 0.8, 0.1], normalWorldY: 1 },
      { scene },
    )!
    expect(surface.id).toBeNull()
    expect(surface.region).toBeUndefined()
  }
})
