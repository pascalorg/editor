import { afterEach, describe, expect, test } from 'bun:test'
import { type AnyNode, registerNode, useInteractive } from '@pascal-app/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { MechanismButton, selectedMechanismNode } from './registry-action-contributions'

const switchMechanism = {
  has: (node: AnyNode) => (node as unknown as { joints: number }).joints > 0,
  isOn: (node: AnyNode, state: ReturnType<typeof useInteractive.getState>) =>
    Boolean(state.mechanisms[node.id]),
  set: (node: AnyNode, on: boolean) => useInteractive.getState().setMechanism(node.id, on),
}

// A kind that only declares the capability: no action-menu contribution, no E action.
function articulated(joints: number): AnyNode {
  const kind = `test:mechanism-${crypto.randomUUID()}`
  registerNode({
    kind,
    schemaVersion: 1,
    category: 'furnish',
    defaults: () => ({}),
    capabilities: { mechanism: switchMechanism },
  } as never)
  return { object: 'node', id: `${kind}_1`, type: kind, joints } as unknown as AnyNode
}

const byId = (...nodes: AnyNode[]) => Object.fromEntries(nodes.map((node) => [node.id, node]))

afterEach(() => {
  for (const id of Object.keys(useInteractive.getState().mechanisms))
    useInteractive.getState().removeMechanism(id as never)
})

describe('mechanism action in the action menu', () => {
  test('the only selected node gets Play when its kind declares a mechanism', () => {
    const node = articulated(2)
    expect(selectedMechanismNode([node.id], byId(node))).toBe(node)
  })

  test('no Play without moving parts, for a multi-selection, or without the capability', () => {
    const still = articulated(0)
    expect(selectedMechanismNode([still.id], byId(still))).toBeUndefined()

    const node = articulated(2)
    const other = { object: 'node', id: 'other_1', type: 'other' } as unknown as AnyNode
    expect(selectedMechanismNode([node.id, other.id], byId(node, other))).toBeUndefined()
    expect(selectedMechanismNode([other.id], byId(other))).toBeUndefined()
  })

  test('the button reads Play, then Stop while the mechanism runs', () => {
    const node = articulated(1)
    const idle = renderToStaticMarkup(
      <MechanismButton mechanism={switchMechanism} node={node} running={false} />,
    )
    expect(idle).toContain('aria-label="Play"')
    expect(idle).toContain('aria-pressed="false"')

    const running = renderToStaticMarkup(
      <MechanismButton mechanism={switchMechanism} node={node} running />,
    )
    expect(running).toContain('aria-label="Stop"')
    expect(running).toContain('aria-pressed="true"')
  })
})
