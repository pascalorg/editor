import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { BaseNode, nodeType, objectId } from '../schema/base'
import { BuildingNode } from '../schema/nodes/building'
import { LevelNode } from '../schema/nodes/level'
import { RoofNode } from '../schema/nodes/roof'
import { RoofSegmentNode } from '../schema/nodes/roof-segment'
import { SiteNode } from '../schema/nodes/site'
import type { AnyNode, AnyNodeId } from '../schema/types'
import useScene from '../store/use-scene'
import { type RoofPlane, registerRoofPlanes, roofPlane } from './__fixtures__/roof-planes'
import { registerNode } from './registry'
import { roofFaceShapes } from './roofs'
import type { AnyNodeDefinition } from './types'

const Lamp = BaseNode.extend({ id: objectId('lamp'), type: nodeType('test:lamp') })

/** The kinds a host registers: the roof (core's schema), a plugin's planes, and a lamp. */
function registerKinds() {
  const kind = (name: string, schema: typeof RoofNode | typeof Lamp) =>
    registerNode({
      kind: name,
      schemaVersion: 1,
      schema,
      category: 'structure',
      defaults: () => ({}),
      capabilities: {},
    } as unknown as AnyNodeDefinition)
  kind('roof', RoofNode)
  kind('test:lamp', Lamp)
  registerRoofPlanes()
}

// The south plane of an 8 m wide roof: 3 m deep at 6 in 12, its eave 2.9 m up.
const south = roofPlane('roofplane_south', [0, 0, 8, 3], 2.9)
const lamp = Lamp.parse({ id: 'lamp_one' }) as unknown as AnyNode
const level = LevelNode.parse({ id: 'level_roof', metadata: { role: 'roof' } })
const roof = RoofNode.parse({ id: 'roof_main', parentId: level.id })

function seed(...extra: AnyNode[]) {
  const nodes: Record<string, AnyNode> = {
    [level.id]: { ...level, children: [roof.id, ...extra.map((node) => node.id)] },
    [roof.id]: roof,
  }
  for (const node of extra) nodes[node.id] = { ...node, parentId: level.id }
  useScene.setState({ nodes: nodes as Record<AnyNodeId, AnyNode>, rootNodeIds: [level.id] })
}

const stored = (id: string) => useScene.getState().nodes[id as AnyNodeId] as AnyNode
const childrenOf = (id: string) => (stored(id) as AnyNode & { children: string[] }).children

let saved: ReturnType<typeof useScene.getState>
let savedRaf: typeof requestAnimationFrame
let savedCancelRaf: typeof cancelAnimationFrame
beforeEach(() => {
  saved = useScene.getState()
  savedRaf = globalThis.requestAnimationFrame
  savedCancelRaf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  registerKinds()
})
afterEach(() => {
  useScene.setState(saved)
  useScene.temporal.getState().clear()
  globalThis.requestAnimationFrame = savedRaf
  globalThis.cancelAnimationFrame = savedCancelRaf
})

describe('a roof holds the faces of kinds that roof', () => {
  test("a face created under a roof is one of its children, kept by the roof's schema", () => {
    seed()
    useScene.getState().createNode(south, roof.id)

    expect(childrenOf(roof.id)).toEqual([south.id])
    expect(stored(south.id).parentId).toBe(roof.id)
    // What a host saves and an authority parses: the plane's own id prefix, no segment's.
    expect(RoofNode.parse(stored(roof.id)).children).toEqual([south.id])
  })

  test('a node of a kind that does not roof is refused under a roof, and nothing is written', () => {
    seed()
    expect(() => useScene.getState().createNode(lamp, roof.id)).toThrow(
      /test:lamp lamp_one is neither/,
    )
    expect(childrenOf(roof.id)).toEqual([])
    expect(stored(lamp.id)).toBeUndefined()
  })

  test('a face standing on the level moves into its roof; a lamp does not', () => {
    seed(south, lamp)
    useScene.getState().updateNode(south.id as AnyNodeId, { parentId: roof.id })

    expect(childrenOf(roof.id)).toEqual([south.id])
    expect(childrenOf(level.id)).toEqual([roof.id, lamp.id])
    expect(() =>
      useScene.getState().updateNode(lamp.id as AnyNodeId, { parentId: roof.id }),
    ).toThrow(/is neither/)
    expect(stored(lamp.id).parentId).toBe(level.id)
  })

  test('a roof saved holding another kind still edits', () => {
    useScene.setState({
      nodes: {
        [roof.id]: { ...roof, children: [lamp.id] },
        [lamp.id]: { ...lamp, parentId: roof.id },
      } as Record<AnyNodeId, AnyNode>,
      rootNodeIds: [roof.id],
    })
    useScene.getState().updateNode(roof.id, { name: 'Main roof' })
    expect(stored(roof.id).name).toBe('Main roof')
  })
})

describe("a roof's faces in its frame", () => {
  const polygon = (south as unknown as RoofPlane).polygon
  const ridge = 2.9 + (3 * 6) / 12

  test('at the level origin a face reads as it is stored; a moved, turned roof carries it', () => {
    const nodes = { [south.id]: south }
    expect(roofFaceShapes({ ...roof, children: [south.id] }, nodes)).toEqual([
      { id: south.id, outline: polygon, low: 2.9, high: ridge },
    ])

    const moved = roofFaceShapes(
      { ...roof, children: [south.id], position: [10, 1, 5], rotation: Math.PI / 2 },
      nodes,
    )[0]!
    // A quarter turn takes the roof's local +z toward +x: (x, z) lands on (z, -x).
    moved.outline.forEach(([x, z], index) => {
      const [lx, lz] = polygon[index]!
      expect(x).toBeCloseTo(10 + lz)
      expect(z).toBeCloseTo(5 - lx)
    })
    expect([moved.low, moved.high]).toEqual([3.9, ridge + 1])
  })

  test('a face of a kind this runtime has not registered is not read', () => {
    const unknown = { ...south, id: 'stone_one', type: 'test:stone' } as unknown as AnyNode
    expect(roofFaceShapes({ ...roof, children: [unknown.id] }, { [unknown.id]: unknown })).toEqual(
      [],
    )
  })
})

test('a scene saved with roof planes standing on the roof level loads them where they stood', () => {
  const site = SiteNode.parse({ id: 'site_lot', children: ['building_house'] })
  const building = BuildingNode.parse({
    id: 'building_house',
    parentId: site.id,
    children: ['level_ground', level.id],
  })
  const ground = LevelNode.parse({
    id: 'level_ground',
    parentId: building.id,
    level: 0,
    height: 2.7,
  })
  const segment = RoofSegmentNode.parse({ id: 'rseg_porch', parentId: roof.id, width: 4, depth: 3 })
  const nodes = {
    [site.id]: site,
    [building.id]: building,
    [ground.id]: ground,
    [level.id]: {
      ...level,
      parentId: building.id,
      level: 1,
      height: 3,
      children: [roof.id, south.id],
    },
    [roof.id]: { ...roof, children: [segment.id] },
    [segment.id]: segment,
    [south.id]: { ...south, parentId: level.id },
  } as unknown as Record<AnyNodeId, AnyNode>
  useScene.getState().setScene(structuredClone(nodes), [site.id as AnyNodeId])

  expect(childrenOf(level.id)).toEqual([roof.id, south.id])
  expect(stored(south.id)).toEqual(nodes[south.id as AnyNodeId]!)
  expect(childrenOf(roof.id)).toEqual([segment.id])
})
