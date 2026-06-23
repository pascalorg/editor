import { beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { nodeRegistry, registerNode } from '../registry/registry'
import type { AnyNodeDefinition, Capabilities, SceneApi } from '../registry/types'
import type { AnyNode, AnyNodeId } from '../schema/types'
import {
  canAttach,
  canHostOnTop,
  clampYToHostTop,
  getSurface,
  getTopSurfaceHeight,
  MAX_HOST_DEPTH,
  pickHost,
} from './hosting'

const id = (s: string) => s as AnyNodeId

function makeItem(idStr: string, attachTo?: 'wall' | 'wall-side' | 'ceiling'): AnyNode {
  return {
    id: id(idStr),
    type: 'item',
    parentId: null,
    visible: true,
    asset: attachTo ? { attachTo } : {},
  } as unknown as AnyNode
}

function makeDef(
  kind: string,
  capabilities: Capabilities = {},
  overrides: Partial<AnyNodeDefinition> = {},
): AnyNodeDefinition {
  return {
    kind,
    schemaVersion: 1,
    schema: z.object({ type: z.literal(kind) }) as any,
    category: 'utility',
    defaults: () => ({}) as any,
    capabilities,
    renderer: { kind: 'parametric', module: async () => ({ default: () => null }) },
    ...overrides,
  }
}

function makeNode(kind: string, idStr: string, parentId: string | null = null): AnyNode {
  return {
    id: id(idStr),
    type: kind,
    parentId: parentId ? id(parentId) : null,
    visible: true,
  } as unknown as AnyNode
}

function makeFakeScene(nodes: Record<string, AnyNode>): SceneApi {
  return {
    get: ((nid: AnyNodeId) => nodes[nid as string]) as SceneApi['get'],
    nodes: () => nodes as Readonly<Record<AnyNodeId, AnyNode>>,
    update: () => {},
    upsert: () => id(''),
    delete: () => {},
    restore: () => {},
    restoreAll: () => {},
    markDirty: () => {},
    pauseHistory: () => {},
    resumeHistory: () => {},
    getSubtree: () => null,
    cloneNodesInto: () => null,
  }
}

describe('canAttach', () => {
  beforeEach(() => {
    nodeRegistry._reset()
  })

  test('rejects self-host', () => {
    const scene = makeFakeScene({ a: makeNode('thing', 'a') })
    const result = canAttach(id('a'), id('a'), scene)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('self-host')
  })

  test('rejects missing host', () => {
    const scene = makeFakeScene({ a: makeNode('thing', 'a') })
    const result = canAttach(id('a'), id('missing'), scene)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('host-missing')
  })

  test('detects cycle when host is a descendant of child', () => {
    // child=a, host=b, b's parent chain leads back to a → cycle.
    const scene = makeFakeScene({
      a: makeNode('thing', 'a'),
      b: makeNode('thing', 'b', 'c'),
      c: makeNode('thing', 'c', 'a'), // c.parent = a, b.parent = c → cycle if a → b
    })
    const result = canAttach(id('a'), id('b'), scene)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('cycle')
  })

  test('rejects when chain would exceed MAX_HOST_DEPTH', () => {
    const nodes: Record<string, AnyNode> = {}
    for (let i = 0; i <= MAX_HOST_DEPTH; i++) {
      nodes[`n${i}`] = makeNode('thing', `n${i}`, i === 0 ? null : `n${i - 1}`)
    }
    // n6 is already MAX_HOST_DEPTH deep — attaching n_new beneath it would
    // push the child to MAX_HOST_DEPTH + 1.
    nodes.candidate = makeNode('thing', 'candidate')
    const scene = makeFakeScene(nodes)
    const result = canAttach(id('candidate'), id(`n${MAX_HOST_DEPTH}`), scene)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('depth-exceeded')
  })

  test('accepts attach when chain stays within MAX_HOST_DEPTH', () => {
    const scene = makeFakeScene({
      root: makeNode('thing', 'root'),
      candidate: makeNode('thing', 'candidate'),
    })
    expect(canAttach(id('candidate'), id('root'), scene).ok).toBe(true)
  })

  test('rejects host kind not in child def.hostable.parents', () => {
    registerNode(makeDef('shelf', { hostable: { parents: ['wall', 'slab'] } }))
    const scene = makeFakeScene({
      s: makeNode('shelf', 's'),
      ceiling: makeNode('ceiling', 'ceiling'),
    })
    const result = canAttach(id('s'), id('ceiling'), scene)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('kind-not-allowed')
  })

  test('accepts when host kind is in parents', () => {
    registerNode(makeDef('shelf', { hostable: { parents: ['wall', 'slab'] } }))
    const scene = makeFakeScene({
      s: makeNode('shelf', 's'),
      w: makeNode('wall', 'w'),
    })
    expect(canAttach(id('s'), id('w'), scene).ok).toBe(true)
  })

  test('no def or no hostable.parents = no kind restriction', () => {
    // Some kinds (e.g. items via catalog) defer to runtime checks instead of
    // declaring parents up front. canAttach should not block them.
    const scene = makeFakeScene({
      i: makeNode('item', 'i'),
      w: makeNode('wall', 'w'),
    })
    expect(canAttach(id('i'), id('w'), scene).ok).toBe(true)
  })

  test('allows missing child (placement preview before commit)', () => {
    const scene = makeFakeScene({ w: makeNode('wall', 'w') })
    expect(canAttach(id('future-child'), id('w'), scene).ok).toBe(true)
  })
})

describe('getSurface / getTopSurfaceHeight', () => {
  beforeEach(() => {
    nodeRegistry._reset()
  })

  test('returns null when host has no registered def', () => {
    const node = makeNode('mystery', 'm')
    expect(getSurface(node)).toBeNull()
    expect(getTopSurfaceHeight(node)).toBeNull()
  })

  test('returns surface config when declared', () => {
    registerNode(
      makeDef('table', {
        surfaces: { top: { height: 0.74 } },
      }),
    )
    const t = makeNode('table', 't')
    expect(getSurface(t)?.top?.height).toBe(0.74)
    expect(getTopSurfaceHeight(t)).toBe(0.74)
  })

  test('evaluates function-valued height with the node', () => {
    registerNode(
      makeDef('shelf', {
        surfaces: {
          top: {
            height: (n: any) => (n.id === id('high') ? 1.8 : 0.3),
          },
        },
      }),
    )
    expect(getTopSurfaceHeight(makeNode('shelf', 'high'))).toBe(1.8)
    expect(getTopSurfaceHeight(makeNode('shelf', 'low'))).toBe(0.3)
  })
})

describe('clampYToHostTop', () => {
  beforeEach(() => {
    nodeRegistry._reset()
  })

  test('clamps to top when host has one', () => {
    registerNode(makeDef('table', { surfaces: { top: { height: 0.74 } } }))
    expect(clampYToHostTop(makeNode('table', 't'), 5)).toBe(0.74)
  })

  test('passes through when host has no top surface', () => {
    registerNode(makeDef('plain'))
    expect(clampYToHostTop(makeNode('plain', 'p'), 5)).toBe(5)
  })
})

describe('pickHost', () => {
  beforeEach(() => {
    nodeRegistry._reset()
  })

  test('returns first candidate that has hostable capability', () => {
    registerNode(makeDef('slab', { hostable: { parents: ['*'] } }))
    registerNode(makeDef('item')) // no hostable
    const candidates = [makeNode('item', 'i'), makeNode('slab', 's')]
    const picked = pickHost({
      point: [0, 0, 0],
      candidates,
      placedKind: 'chair',
    })
    expect(picked?.id).toBe(id('s'))
  })

  test('returns null when nothing in candidates is hostable', () => {
    registerNode(makeDef('item'))
    const candidates = [makeNode('item', 'i')]
    expect(pickHost({ point: [0, 0, 0], candidates, placedKind: 'chair' })).toBeNull()
  })

  test('hitTest can reject hostable candidates', () => {
    registerNode(makeDef('slab', { hostable: { parents: ['*'] } }))
    const candidates = [makeNode('slab', 's1'), makeNode('slab', 's2')]
    const picked = pickHost({
      point: [0, 0, 0],
      candidates,
      placedKind: 'chair',
      hitTest: (host) => host.id === id('s2'),
    })
    expect(picked?.id).toBe(id('s2'))
  })

  test('excludes ceiling-mounted hosts (ceiling fan cannot be a top surface)', () => {
    registerNode(makeDef('item', { hostable: { parents: ['*'] } }))
    const candidates = [makeItem('fan', 'ceiling'), makeItem('table')]
    const picked = pickHost({ point: [0, 0, 0], candidates, placedKind: 'item' })
    expect(picked?.id).toBe(id('table'))
  })

  test('keeps wall-mounted hosts (wall shelf still hosts)', () => {
    registerNode(makeDef('item', { hostable: { parents: ['*'] } }))
    const candidates = [makeItem('shelf', 'wall')]
    const picked = pickHost({ point: [0, 0, 0], candidates, placedKind: 'item' })
    expect(picked?.id).toBe(id('shelf'))
  })
})

describe('canHostOnTop', () => {
  test('rejects ceiling-attachTo hosts', () => {
    expect(canHostOnTop(makeItem('fan', 'ceiling'))).toBe(false)
  })

  test('accepts wall / wall-side / floor (undefined) hosts', () => {
    expect(canHostOnTop(makeItem('shelf', 'wall'))).toBe(true)
    expect(canHostOnTop(makeItem('sconce', 'wall-side'))).toBe(true)
    expect(canHostOnTop(makeItem('table'))).toBe(true)
  })
})
