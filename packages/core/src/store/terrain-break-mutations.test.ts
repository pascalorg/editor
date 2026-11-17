import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  clearSceneHistory,
  createTerrainField,
  encodeTerrainField,
  heightAt,
  persistedTerrainFieldOf,
  useScene,
} from '@pascal-app/core'
import { type AnyNode, SiteNode, TerrainBreakNode, TerrainTileNode } from '@pascal-app/core/schema'

const crossing: [number, number][] = [
  [3, 2],
  [5, 2],
  [5, 6],
  [3, 6],
  [3, 2],
]
const collapsed: [number, number][] = [
  [1, 2],
  [1, 2],
]

function fixture() {
  const cliff = TerrainBreakNode.parse({
    id: 'terrain-break_cliff',
    parentId: 'site_mutations',
    line: [
      [4, 0],
      [4, 8],
    ],
    kind: 'cliff',
    left: 5,
    right: 2,
  })
  const pad = TerrainBreakNode.parse({
    id: 'terrain-break_pad',
    parentId: 'site_mutations',
    line: [
      [1, 2],
      [3, 2],
      [3, 6],
      [1, 6],
      [1, 2],
    ],
    kind: 'retaining',
    left: 7,
    right: 'ground',
  })
  const site = SiteNode.parse({
    id: 'site_mutations',
    children: [cliff.id, pad.id],
    polygon: {
      type: 'polygon',
      points: [
        [0, 0],
        [8, 0],
        [8, 8],
        [0, 8],
      ],
    },
  })
  return { site, pad, nodes: { [site.id]: site, [cliff.id]: cliff, [pad.id]: pad } }
}

let previous: ReturnType<typeof useScene.getState>
let previousRaf: typeof requestAnimationFrame
let previousCancelRaf: typeof cancelAnimationFrame

beforeEach(() => {
  previous = useScene.getState()
  previousRaf = globalThis.requestAnimationFrame
  previousCancelRaf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  const { site, nodes } = fixture()
  useScene.setState({ nodes, rootNodeIds: [site.id], dirtyNodes: new Set(), readOnly: false })
  clearSceneHistory()
})

afterEach(() => {
  useScene.setState(previous)
  clearSceneHistory()
  globalThis.requestAnimationFrame = previousRaf
  globalThis.cancelAnimationFrame = previousCancelRaf
})

function expectAtomicRefusal(write: () => unknown) {
  const before = JSON.stringify(useScene.getState().nodes)
  expect(write).toThrow()
  expect(JSON.stringify(useScene.getState().nodes)).toBe(before)
  expect(useScene.getState().dirtyNodes.size).toBe(0)
}

describe('raw terrain-break mutations', () => {
  test('a raw keep-ground ring without same-side tile samples is refused before publication', () => {
    const samples = createTerrainField({ cols: 65, rows: 65, spacing: 0.5 })
    samples.heights.fill(500)
    const tile = TerrainTileNode.parse({
      id: 'terrain-tile_raw',
      parentId: 'site_mutations',
      ix: 0,
      iz: 0,
      heights: encodeTerrainField(samples).heights,
    })
    const site = SiteNode.parse({ ...fixture().site, children: [tile.id] })
    useScene.setState({ nodes: { [site.id]: site, [tile.id]: tile } })
    clearSceneHistory()
    const tiny = TerrainBreakNode.parse({
      id: 'terrain-break_tiny',
      parentId: site.id,
      kind: 'retaining',
      line: [
        [0.2, 0.2],
        [0.3, 0.2],
        [0.3, 0.3],
        [0.2, 0.3],
        [0.2, 0.2],
      ],
      left: 'ground',
      right: 2,
    })
    expectAtomicRefusal(() => useScene.getState().createNode(tiny, site.id))
    const field = persistedTerrainFieldOf(site, useScene.getState().nodes)
    if (!field) throw new Error('Expected the untouched tile authority')
    expect(heightAt(field, 0.25, 0.25)).toBe(5)
  })

  test('enlarging the lot cannot leave an existing open break with internal endpoints', () => {
    const { site } = fixture()
    expectAtomicRefusal(() =>
      useScene.getState().updateNode(site.id, {
        polygon: {
          type: 'polygon',
          points: [
            [0, 0],
            [8, 0],
            [8, 12],
            [0, 12],
          ],
        },
      }),
    )
  })

  test('single-node updates cannot publish crossing breaks', () => {
    const { pad } = fixture()
    expectAtomicRefusal(() => useScene.getState().updateNode(pad.id, { line: crossing }))
  })

  test('batch updates reject crossing geometry before applying an earlier unrelated edit', () => {
    const { site, pad } = fixture()
    expectAtomicRefusal(() =>
      useScene.getState().updateNodes([
        { id: site.id, data: { name: 'Must not be committed' } },
        { id: pad.id, data: { line: crossing } },
      ]),
    )
  })

  test('mixed scene changes reject the entire batch before publishing a conflicting break', () => {
    const { site, pad } = fixture()
    const extra = TerrainBreakNode.parse({ ...pad, id: 'terrain-break_extra', line: crossing })
    expectAtomicRefusal(() =>
      useScene.getState().applyNodeChanges({
        update: [{ id: site.id, data: { name: 'Must not be committed' } }],
        create: [{ node: extra, parentId: site.id }],
      }),
    )
  })

  test('raw creation refuses crossings without adding a node or parent-child reference', () => {
    const { site, pad } = fixture()
    const extra = TerrainBreakNode.parse({ ...pad, id: 'terrain-break_extra', line: crossing })
    expectAtomicRefusal(() => useScene.getState().createNode(extra, site.id))
  })

  for (const [label, data] of [
    ['collapsed line', { line: collapsed }],
    ['both sides ground', { left: 'ground' }],
  ] satisfies [string, Partial<TerrainBreakNode>][]) {
    test(`strict mutation validation keeps the original scene after a ${label} update`, () => {
      const { pad } = fixture()
      expectAtomicRefusal(() => useScene.getState().updateNode(pad.id, data as Partial<AnyNode>))
    })
  }

  test('strict mutation validation also refuses a collapsed raw create', () => {
    const { site, pad } = fixture()
    expectAtomicRefusal(() =>
      useScene.getState().createNode(
        {
          ...pad,
          id: 'terrain-break_collapsed',
          line: collapsed,
        },
        site.id,
      ),
    )
  })
})
