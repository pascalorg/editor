import { afterEach, describe, expect, test } from 'bun:test'
import { type AnyNode, type MechanismPart, registerNode, useInteractive } from '@pascal-app/core'
import type { MouseEvent, ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  MechanismButton,
  MechanismPartButton,
  NodeMechanismActions,
  soleSelectedNode,
} from './registry-action-contributions'

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

const shutters: MechanismPart = {
  id: 'shutters',
  label: 'Shutters',
  icon: 'shutters',
  verb: 'open',
  has: () => true,
  isOn: (node, state) => Boolean(state.mechanisms[`${node.id}:shutters` as never]),
  set: (node, on) => useInteractive.getState().setMechanism(`${node.id}:shutters` as never, on),
}

function shuttered(): AnyNode {
  const kind = `test:shuttered-${crypto.randomUUID()}`
  registerNode({
    kind,
    schemaVersion: 1,
    category: 'structure',
    defaults: () => ({}),
    capabilities: {
      mechanism: { ...switchMechanism, verb: 'open', icon: 'window', parts: [shutters] },
    },
  } as never)
  return { object: 'node', id: `${kind}_1`, type: kind, joints: 1 } as unknown as AnyNode
}

const byId = (...nodes: AnyNode[]) => Object.fromEntries(nodes.map((node) => [node.id, node]))

afterEach(() => {
  for (const id of Object.keys(useInteractive.getState().mechanisms))
    useInteractive.getState().removeMechanism(id as never)
})

describe('mechanism action in the action menu', () => {
  test('the only selected node gets Play when its kind declares a mechanism', () => {
    const node = articulated(2)
    expect(soleSelectedNode([node.id], byId(node))).toBe(node)
    expect(renderToStaticMarkup(<NodeMechanismActions node={node} />)).toContain(
      'aria-label="Play"',
    )
  })

  test('no Play without moving parts, for a multi-selection, or without the capability', () => {
    const still = articulated(0)
    expect(renderToStaticMarkup(<NodeMechanismActions node={still} />)).toBe('')

    const node = articulated(2)
    const other = { object: 'node', id: 'other_1', type: 'other' } as unknown as AnyNode
    expect(soleSelectedNode([node.id, other.id], byId(node, other))).toBeUndefined()
    expect(renderToStaticMarkup(<NodeMechanismActions node={other} />)).toBe('')
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

describe('mechanism parts in the action menu', () => {
  test('a window with shutters gets Open shutters beside Open', () => {
    const markup = renderToStaticMarkup(<NodeMechanismActions node={shuttered()} />)
    expect(markup.match(/aria-label="[^"]*"/g)).toEqual([
      'aria-label="Open"',
      'aria-label="Open shutters"',
    ])
  })

  test('the shutters button opens them alone, then reads Close shutters', () => {
    const node = shuttered()
    let button: ReactElement<{ onClick: (event: MouseEvent) => void }> | undefined
    // Rendering the button as a hook call hands over the element it returns, onClick included.
    function Probe() {
      button = MechanismPartButton({ node, part: shutters, running: false }) as typeof button
      return null
    }
    renderToStaticMarkup(<Probe />)
    button?.props.onClick({ stopPropagation: () => {} } as MouseEvent)
    expect(shutters.isOn(node, useInteractive.getState())).toBe(true)
    expect(switchMechanism.isOn(node, useInteractive.getState())).toBe(false)

    const open = renderToStaticMarkup(<MechanismPartButton node={node} part={shutters} running />)
    expect(open).toContain('aria-label="Close shutters"')
    expect(open).toContain('aria-pressed="true"')
  })
})
