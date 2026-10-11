import { describe, expect, test } from 'bun:test'
import { type AnyNode, registerNode } from '@pascal-app/core'
import { placementNoticeOf, transientDraftId } from './use-placement-notice'

// The editor asks a node's definition for its placement notice; it names no kind.
function registerKind(placementNotice?: unknown): string {
  const kind = `test:notice-${crypto.randomUUID()}`
  registerNode({
    kind,
    schemaVersion: 1,
    category: 'furnish',
    defaults: () => ({}),
    capabilities: {},
    ...(placementNotice ? { placementNotice } : {}),
  } as never)
  return kind
}

const nodeOf = (id: string, type: string, metadata?: Record<string, unknown>) =>
  ({ id, type, parentId: 'level_a', metadata: metadata ?? {} }) as unknown as AnyNode

describe('the placement notice of the node in hand', () => {
  test("comes from the node's definition, at its live pose", () => {
    const kind = registerKind((node: AnyNode, ctx: { live?: { position: number[] } }) => ({
      line: `${node.id} at ${ctx.live?.position.join(',') ?? 'rest'}`,
    }))
    const nodes = { a: nodeOf('a', kind) }
    expect(placementNoticeOf(nodes, 'a')).toEqual({ line: 'a at rest' })
    expect(placementNoticeOf(nodes, 'a', { position: [1, 0, 2], rotation: 0 })).toEqual({
      line: 'a at 1,0,2',
    })
  })

  test('is null for a kind that declares none, and for a node not in the scene', () => {
    const nodes = { b: nodeOf('b', registerKind()) }
    expect(placementNoticeOf(nodes, 'b')).toBeNull()
    expect(placementNoticeOf(nodes, 'missing')).toBeNull()
  })

  test("a tool's transient draft is found whatever its kind", () => {
    const nodes = {
      kept: nodeOf('kept', registerKind()),
      draft: nodeOf('draft', registerKind(), { isTransient: true }),
    }
    expect(transientDraftId(nodes) as string | null).toBe('draft')
    expect(transientDraftId({ kept: nodes.kept })).toBeNull()
  })
})
