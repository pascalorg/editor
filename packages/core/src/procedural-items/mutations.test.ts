import { beforeAll, expect, test } from 'bun:test'
import { registerNode } from '../registry/registry'
import { ItemNode } from '../schema/nodes/item'
import useScene from '../store/use-scene'
import { shelfRecipe } from './fixtures'
import { ProceduralItemNode } from './node'
import { evaluateRecipe } from './recipe'

globalThis.requestAnimationFrame ??= (cb: FrameRequestCallback) => {
  cb(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}
beforeAll(() =>
  registerNode({
    kind: 'procedural-item',
    schemaVersion: 1,
    schema: ProceduralItemNode,
    category: 'furnish',
    defaults: () => ({}),
    capabilities: {},
  } as never),
)
test('invalid direct and atomic mutations preserve the previous scene', () => {
  const node = ProceduralItemNode.parse({ recipe: shelfRecipe })
  useScene.setState({ nodes: { [node.id]: node } as never, rootNodeIds: [], readOnly: false })
  const before = useScene.getState().nodes
  expect(() =>
    useScene.getState().updateNode(node.id as never, { type: 'item' } as never),
  ).toThrow()
  expect(() =>
    useScene.getState().updateNode(node.id as never, { parameters: { width: -1 } } as never),
  ).toThrow()
  expect(useScene.getState().nodes).toBe(before)
  expect(() =>
    useScene.getState().applyNodeChanges({
      update: [{ id: node.id as never, data: { parameters: { rows: 2.5 } } as never }],
    }),
  ).toThrow()
  expect(useScene.getState().nodes).toBe(before)
  expect(() =>
    useScene
      .getState()
      .createNode({ ...node, id: 'procedural-item_bad', parameters: { rows: 999 } } as never),
  ).toThrow()
  expect(useScene.getState().nodes).toBe(before)
})
test('occupied surfaces are protected through direct store updates', () => {
  const surface = evaluateRecipe(shelfRecipe).surfaces.at(-1)!.id
  const node = ProceduralItemNode.parse({
    recipe: shelfRecipe,
    children: ['item_book'],
    attachments: { item_book: surface },
  })
  const book = ItemNode.parse({
    id: 'item_book',
    parentId: node.id,
    asset: {
      id: 'book',
      name: 'Book',
      category: 'decor',
      thumbnail: '',
      src: '/book.glb',
      dimensions: [0.16, 0.12, 0.12],
    },
  })
  useScene.setState({ nodes: { [node.id]: node, [book.id]: book } as never, readOnly: false })
  expect(() =>
    useScene.getState().updateNode(node.id as never, { parameters: { rows: 2 } } as never),
  ).toThrow('hosted item')
  useScene.getState().updateNode(node.id as never, { parameters: { height: 2 } } as never)
  expect(
    (useScene.getState().nodes[node.id as never] as unknown as ProceduralItemNode).parameters
      .height,
  ).toBe(2)
})
