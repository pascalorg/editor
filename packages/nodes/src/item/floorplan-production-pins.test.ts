import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BlockNode,
  CabinetModuleNode,
  CabinetNode,
  CeilingNode,
  getBlockFaceFrame,
  ItemNode,
  LevelNode,
  nodeRegistry,
  RoofNode,
  RoofSegmentNode,
  registerNode,
  ShelfNode,
  SlabNode,
  WallNode,
} from '@pascal-app/core'
import { ProceduralItemNode, shelfRecipe } from '@pascal-app/core/procedural-items'
import { builtinPlugin } from '../index'
import { resolveItemTransform } from './floorplan'

let restore: () => void
beforeEach(() => {
  restore = nodeRegistry._snapshot()
  for (const def of builtinPlugin.nodes!) registerNode(def)
})
afterEach(() => restore())
const asset = {
  id: 'pin',
  name: 'Pin',
  category: 'furniture',
  src: '/box.glb',
  thumbnail: '',
  dimensions: [0.2, 0.2, 0.2],
}
for (const kind of [
  'level',
  'wall-front',
  'wall-back',
  'ceiling',
  'roof',
  'item',
  'shelf',
  'shelf-wall',
  'cabinet',
  'cabinet-module',
  'named',
  'unnamed',
  'block',
  'slab',
  'plugin',
] as const)
  test(`production plan pin ${kind}`, async () => {
    const level = LevelNode.parse({ id: 'level_pin' })
    const props = { parentId: level.id, position: [2, 0.1, 3], rotation: [0, 0.6, 0] }
    const child = ItemNode.parse({
      id: 'item_pin',
      asset,
      position: [0.2, 0.3, 0.4],
      rotation: [0, 0.2, 0],
    })
    let host: AnyNode = level
    const nodes: Record<AnyNodeId, AnyNode> = { [level.id]: level }
    if (kind.startsWith('wall')) {
      host = WallNode.parse({ parentId: level.id, start: [2, 3], end: [6, 5], thickness: 0.4 })
      child.asset.attachTo = 'wall-side'
      child.side = kind === 'wall-front' ? 'front' : 'back'
    }
    if (kind === 'ceiling')
      host = CeilingNode.parse({
        parentId: level.id,
        polygon: [
          [0, 0],
          [5, 0],
          [5, 5],
          [0, 5],
        ],
      })
    if (kind === 'roof') {
      const roof = RoofNode.parse({ parentId: level.id, position: [2, 0, 3], rotation: 0.3 })
      nodes[roof.id] = roof
      host = RoofSegmentNode.parse({ parentId: roof.id, position: [1, 2, 1], rotation: 0.2 })
      child.roofFace = 'front'
      child.roofSegmentId = host.id
      child.asset.attachTo = 'wall-side'
      child.side = 'front'
    }
    if (kind === 'item') host = ItemNode.parse({ ...props, asset })
    if (kind === 'shelf' || kind === 'shelf-wall') host = ShelfNode.parse(props)
    if (kind === 'shelf-wall') {
      const wall = WallNode.parse({ parentId: level.id, start: [5, 6], end: [9, 8] })
      nodes[wall.id] = wall
      host.parentId = wall.id
    }
    if (kind === 'cabinet') host = CabinetNode.parse({ ...props, rotation: 0.6 })
    if (kind === 'cabinet-module') {
      const run = CabinetNode.parse({ ...props, rotation: 0.6 })
      nodes[run.id] = run
      host = CabinetModuleNode.parse({ parentId: run.id, position: [0.5, 0.1, 0.2], rotation: 0.1 })
    }
    if (kind === 'named' || kind === 'unnamed') {
      host = ProceduralItemNode.parse({
        ...props,
        recipe: shelfRecipe,
        ...(kind === 'named' ? { attachments: { [child.id]: 'top' } } : {}),
      })
      if (kind === 'named')
        host.recipe = {
          ...host.recipe,
          surfaces: [
            {
              id: 'top',
              label: 'Top',
              position: [0.1, 1, 0.2],
              rotation: [0, 0.4, 0],
              size: [2, 2],
            },
          ],
        }
    }
    if (kind === 'block') {
      host = BlockNode.parse({ ...props, rotation: 0.6 })
      child.blockFaceId = host.topology.faces.find(
        (f) => getBlockFaceFrame(host.topology, f.id)!.normal[1] > 0.99,
      )!.id
    }
    if (kind === 'slab')
      host = SlabNode.parse({
        parentId: level.id,
        elevation: 0.8,
        polygon: [
          [0, 0],
          [5, 0],
          [5, 5],
          [0, 5],
        ],
      })
    if (kind === 'plugin')
      host = {
        id: 'grass-field_pin',
        type: 'environment:ground-cover',
        object: 'node',
        parentId: null,
        visible: true,
        metadata: {},
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        bladeWidth: 0.035,
        bladeHeight: 0.3,
        density: 100,
        paintMap: {
          type: 'grass-paint-field',
          origin: [2, 3],
          spacing: 0.05,
          cols: 33,
          rows: 33,
          values: Buffer.alloc(33 * 33 * 4).toString('base64'),
        },
      } as unknown as AnyNode
    child.parentId = host.id
    nodes[host.id] = host
    nodes[child.id] = child
    const result = resolveItemTransform(child, { resolve: (id: AnyNodeId) => nodes[id] } as never)
    {
      const pins = await import('./__fixtures__/production-plan-pins.json')
      const expected = pins.default[kind]
      expect(result).not.toBeNull()
      expect(result!.x).toBeCloseTo(expected.x, 12)
      expect(result!.y).toBeCloseTo(expected.y, 12)
      expect(result!.rotation).toBeCloseTo(expected.rotation, 12)
    }
  })
