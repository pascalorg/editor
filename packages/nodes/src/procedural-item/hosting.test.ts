import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  canAttach,
  createSceneApi,
  type FloorplanMoveTargetSession,
  getFloorPlacedElevation,
  ItemNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  resolveSupportSlabPatch,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  evaluateRecipe,
  ProceduralItemNode,
  queryProceduralItem,
  shelfRecipe,
} from '@pascal-app/core/procedural-items'
import { itemFloorplanMoveTarget } from '../item/floorplan-move'
import { proceduralItemDefinition } from './definition'
import { proceduralFloorplanMoveTarget } from './move-session'

const host = ItemNode.parse({
  id: 'item_procedural-host',
  parentId: 'level_procedural-host',
  position: [4, 0, 5],
  rotation: [0, Math.PI / 2, 0],
  asset: {
    id: 'table',
    name: 'Table',
    category: 'furniture',
    src: '/table.glb',
    thumbnail: '',
    dimensions: [4, 1, 4],
  },
})
const node = ProceduralItemNode.parse({
  id: 'procedural-item_hosted',
  recipe: shelfRecipe,
  parentId: host.id,
  position: [1, 1, 0],
  rotation: [0, 0.2, 0],
})
const level = LevelNode.parse({ id: host.parentId, children: [host.id] })
const nodes = {
  [level.id]: level,
  [host.id]: { ...host, children: [node.id] },
  [node.id]: node,
} as unknown as Record<AnyNodeId, AnyNode>
let restoreRegistry: () => void
let oldNodes: ReturnType<typeof useScene.getState>['nodes']

beforeEach(() => {
  restoreRegistry = nodeRegistry._snapshot()
  oldNodes = useScene.getState().nodes
  nodeRegistry._reset()
  registerNode(proceduralItemDefinition)
  useScene.setState({ nodes })
})
afterEach(() => {
  useLiveNodeOverrides.getState().clear(node.id)
  useScene.setState({ nodes: oldNodes })
  restoreRegistry()
})

test('procedural definition allows item parenting without floor lift or support-slab stamps', () => {
  expect(canAttach(node.id as AnyNodeId, host.id, createSceneApi(useScene))).toEqual({ ok: true })
  expect(
    getFloorPlacedElevation({ node: node as unknown as AnyNode, nodes, position: node.position }),
  ).toBe(0)
  expect(
    resolveSupportSlabPatch(node as unknown as AnyNode, nodes, {
      preferredSlabId: 'slab_above',
      pinSupport: true,
    }),
  ).toEqual({ supportSlabId: undefined })
})

test('floorplan geometry composes a translated and rotated item parent', () => {
  const equivalent = {
    ...node,
    parentId: level.id,
    position: [4, 1, 4],
    rotation: [0, Math.PI / 2 + 0.2, 0],
  } as ProceduralItemNode
  const actual = queryProceduralItem(node, nodes).levelBounds
  const expected = queryProceduralItem(equivalent, { ...nodes, [node.id]: equivalent }).levelBounds
  for (const key of ['min', 'max'] as const) {
    actual[key].forEach((value, index) => {
      expect(value).toBeCloseTo(expected[key][index]!)
    })
  }
  const geometry = proceduralItemDefinition.floorplan!(node, {
    resolve: (id: AnyNodeId) => nodes[id],
    children: [],
    siblings: [],
    parent: nodes[host.id],
  } as never)
  expect(geometry).toMatchObject({
    kind: 'rect',
    x: actual.min[0],
    y: actual.min[2],
    width: actual.dimensions[0],
    height: actual.dimensions[2],
  })
})

test('hosted procedural floorplan moves use the same parent-composed grab point and detach behavior as items', () => {
  const sceneApi = createSceneApi(useScene)
  const procedural = proceduralFloorplanMoveTarget({ node, nodes, sceneApi })!
  const facade = {
    ...node,
    asset: { dimensions: evaluateRecipe(node.recipe, node.parameters).dimensions },
    scale: [1, 1, 1],
  } as unknown as ItemNode
  const catalog = itemFloorplanMoveTarget({ node: facade, nodes, sceneApi })!
  const apply = (session: FloorplanMoveTargetSession, point: [number, number]) =>
    session.apply({
      planPoint: point,
      modifiers: { altKey: false, shiftKey: false, ctrlKey: false, metaKey: false },
    } as Parameters<FloorplanMoveTargetSession['apply']>[0])
  apply(procedural, [4, 4])
  apply(procedural, [6, 7])
  const proceduralPatch = useLiveNodeOverrides.getState().overrides.get(node.id)
  useLiveNodeOverrides.getState().clear(node.id)
  apply(catalog, [4, 4])
  apply(catalog, [6, 7])
  expect(useLiveNodeOverrides.getState().overrides.get(node.id)).toEqual(proceduralPatch)
  expect(proceduralPatch).toMatchObject({
    parentId: level.id,
    position: [6, 0, 7],
  })
})
