import { describe, expect, test } from 'bun:test'
import { type AnyNodeDefinition, registerNode } from '@pascal-app/core'
import { z } from 'zod'
import { resolveNodeDisplayName } from './node-display-name'

/**
 * The bug this locks down is silent by construction.
 *
 * `presentation.label` is one string per KIND, and it is always present, so a
 * header or a tree row that reads it never looks broken — it just names the
 * wrong thing. A plugin whose two catalogue chips build the same kind with
 * different fields (a low rack and a pallet rack) had both objects reading
 * "Pallet Rack" everywhere in the UI, while the kind's own `tree.label` sat
 * unread. Nothing throws, nothing logs; the only symptom is that two different
 * products answer to one name.
 *
 * A kind per test rather than one shared kind: the registry is a process-wide
 * singleton with no public removal, so reuse would make these tests depend on
 * their own order.
 */

let counter = 0

function register(overrides: Partial<AnyNodeDefinition>): string {
  const kind = `test:display-name-${++counter}`
  registerNode({
    kind,
    schemaVersion: 1,
    schema: z.object({ type: z.literal(kind) }) as never,
    category: 'utility',
    defaults: () => ({}) as never,
    capabilities: {},
    ...overrides,
  } as AnyNodeDefinition)
  return kind
}

function node(kind: string, fields: Record<string, unknown> = {}) {
  return { id: 'probe_1', type: kind, ...fields } as never
}

describe('resolveNodeDisplayName', () => {
  test('the kind derive beats the kind label — two variants, two names', () => {
    const kind = register({
      presentation: { label: 'Widget', icon: { kind: 'iconify', name: 'lucide:box' } },
      tree: {
        label: (n) => ((n as { variant?: string }).variant === 'low' ? 'Low Widget' : 'Widget'),
      },
    } as Partial<AnyNodeDefinition>)

    expect(resolveNodeDisplayName(node(kind, { variant: 'low' }), {})).toBe('Low Widget')
    expect(resolveNodeDisplayName(node(kind, { variant: 'tall' }), {})).toBe('Widget')
  })

  test("the user's rename wins over the derive", () => {
    // The derive is a default, not a decree: renaming is the most-used action
    // in the scene tree, and a chain that ignored `name` would undo the rename
    // on the next render.
    const kind = register({
      presentation: { label: 'Widget', icon: { kind: 'iconify', name: 'lucide:box' } },
      tree: { label: (n) => (n as { name?: string }).name || 'Low Widget' },
    } as Partial<AnyNodeDefinition>)

    expect(resolveNodeDisplayName(node(kind, { name: 'Aisle 4' }), {})).toBe('Aisle 4')
  })

  test('a kind with no derive still answers', () => {
    const kind = register({
      presentation: { label: 'Widget', icon: { kind: 'iconify', name: 'lucide:box' } },
    } as Partial<AnyNodeDefinition>)
    expect(resolveNodeDisplayName(node(kind), {})).toBe('Widget')
  })

  test('an unregistered kind falls through to its type, never to a blank', () => {
    expect(resolveNodeDisplayName(node('test:never-registered'), {})).toBe('test:never-registered')
  })

  test('an empty derive hands over instead of blanking the header', () => {
    // `||` rather than `??` on purpose: a derive that returns '' for a node it
    // cannot describe should fall through, not erase the name.
    const kind = register({
      presentation: { label: 'Widget', icon: { kind: 'iconify', name: 'lucide:box' } },
      tree: { label: () => '' },
    } as Partial<AnyNodeDefinition>)

    expect(resolveNodeDisplayName(node(kind), {})).toBe('Widget')
  })

  test('no node, no name', () => {
    expect(resolveNodeDisplayName(undefined, {})).toBe('')
  })
})
