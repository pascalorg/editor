import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, PROVENANCE_MAX_REFS, type Provenance } from '../schema'
import useScene from './use-scene'

const node = (id: string, type: string, parentId: string | null, fields = {}) => ({
  object: 'node',
  id,
  type,
  parentId,
  visible: true,
  metadata: {},
  ...fields,
})

const LOUVER: Provenance = {
  refs: [
    { ns: 'al', id: 'roof-native-134755-83', role: 'absorbed' },
    { ns: 'al', id: 'roof-native-135186-86', role: 'absorbed' },
  ],
}
const WALL: Provenance = {
  refs: [{ ns: 'al', id: 'ground-exterior-01' }],
  lineage: { op: 'split', fromIds: ['wall_gone'] },
}
const OVER_CAP: Provenance = {
  refs: Array.from({ length: PROVENANCE_MAX_REFS + 3 }, (_, i) => ({ id: `source-${i}` })),
}

function loadScene() {
  const nodes = {
    level_l: node('level_l', 'level', null, { children: ['wall_a', 'wall_over'], level: 0 }),
    wall_a: node('wall_a', 'wall', 'level_l', {
      children: ['window_a'],
      start: [0, 0],
      end: [4, 0],
      provenance: WALL,
    }),
    window_a: node('window_a', 'window', 'wall_a', {
      wallId: 'wall_a',
      position: [1, 1, 0],
      provenance: LOUVER,
    }),
    wall_over: node('wall_over', 'wall', 'level_l', {
      children: [],
      start: [0, 2],
      end: [4, 2],
      provenance: OVER_CAP,
    }),
  }
  useScene
    .getState()
    .setScene(
      JSON.parse(JSON.stringify(nodes)) as Record<AnyNodeId, AnyNode>,
      ['level_l'] as AnyNodeId[],
    )
}

const provenanceOf = (id: string) =>
  (useScene.getState().nodes[id as AnyNodeId] as { provenance?: Provenance }).provenance

describe('provenance through the scene store (D5)', () => {
  let savedRaf: typeof requestAnimationFrame
  let savedCancelRaf: typeof cancelAnimationFrame
  beforeEach(() => {
    savedRaf = globalThis.requestAnimationFrame
    savedCancelRaf = globalThis.cancelAnimationFrame
    globalThis.requestAnimationFrame = () => 0
    globalThis.cancelAnimationFrame = () => {}
    useScene.setState({
      nodes: {},
      rootNodeIds: [],
      dirtyNodes: new Set(),
      collections: {},
      materials: {},
      readOnly: false,
    } as never)
    useScene.temporal.getState().clear()
  })
  afterEach(() => {
    globalThis.requestAnimationFrame = savedRaf
    globalThis.cancelAnimationFrame = savedCancelRaf
  })

  test('load keeps every ref, including a node over the cap', () => {
    loadScene()
    expect(provenanceOf('wall_a')).toEqual(WALL)
    expect(provenanceOf('window_a')).toEqual(LOUVER)
    expect(provenanceOf('wall_over')).toEqual(OVER_CAP)
  })

  test('an edit keeps the field through the parsed update', () => {
    loadScene()
    useScene.getState().updateNode('window_a' as AnyNodeId, { width: 1.4 } as Partial<AnyNode>)
    useScene.getState().updateNode('wall_a' as AnyNodeId, { height: 3 } as Partial<AnyNode>)
    expect(provenanceOf('window_a')).toEqual(LOUVER)
    expect(provenanceOf('wall_a')).toEqual(WALL)
  })

  test('undo restores an edited provenance', () => {
    loadScene()
    const next: Provenance = { refs: [{ ns: 'al', id: 'ground-exterior-01', role: 'derived' }] }
    useScene.getState().updateNode('wall_a' as AnyNodeId, { provenance: next } as Partial<AnyNode>)
    expect(provenanceOf('wall_a')).toEqual(next)
    useScene.temporal.getState().undo()
    expect(provenanceOf('wall_a')).toEqual(WALL)
  })
})
