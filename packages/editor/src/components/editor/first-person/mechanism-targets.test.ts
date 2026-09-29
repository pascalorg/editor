import { afterEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  registerNode,
  sceneRegistry,
  useInteractive,
  useScene,
} from '@pascal-app/core'
import { Object3D } from 'three'
import { mechanismHudInteract, mechanismTargetIds } from './mechanism-targets'

const switchMechanism = {
  has: (node: AnyNode) => (node as unknown as { joints: number }).joints > 0,
  isOn: (node: AnyNode, state: ReturnType<typeof useInteractive.getState>) =>
    Boolean(state.mechanisms[node.id]),
  set: (node: AnyNode, on: boolean) => useInteractive.getState().setMechanism(node.id, on),
}

const mounted: [string, string][] = []

function mount(kind: string, id: string, fields: Record<string, unknown> = {}): AnyNode {
  const node = { object: 'node', id, type: kind, ...fields } as unknown as AnyNode
  useScene.setState((state) => ({ nodes: { ...state.nodes, [id]: node } }) as never)
  sceneRegistry.nodes.set(id, new Object3D())
  sceneRegistry.byType[kind]!.add(id)
  mounted.push([kind, id])
  return node
}

function registerKind(capabilities: Record<string, unknown>): string {
  const kind = `test:walk-${crypto.randomUUID()}`
  registerNode({
    kind,
    schemaVersion: 1,
    category: 'furnish',
    defaults: () => ({}),
    capabilities,
  } as never)
  return kind
}

afterEach(() => {
  for (const [kind, id] of mounted.splice(0)) {
    sceneRegistry.nodes.delete(id)
    sceneRegistry.byType[kind]!.delete(id)
    useInteractive.getState().removeMechanism(id as AnyNodeId)
  }
})

describe('walkthrough mechanism targets', () => {
  test('any mounted node whose kind declares a mechanism is a target, once', () => {
    const kind = registerKind({ mechanism: switchMechanism })
    mount(kind, 'articulated_1', { joints: 2 })
    mount(kind, 'articulated_still', { joints: 0 })
    mount(registerKind({}), 'plain_1')
    const covered = mount(kind, 'articulated_covered', { joints: 1 })

    expect(mechanismTargetIds(new Set([covered.id]))).toEqual(['articulated_1' as AnyNodeId])
  })

  test('the HUD names the node and says what E will do', () => {
    const kind = registerKind({ mechanism: switchMechanism })
    const node = mount(kind, 'articulated_hud', { joints: 1, name: 'Desk lamp' })
    expect(mechanismHudInteract(node)).toEqual({ label: 'Desk lamp', verb: 'turn on' })
    useInteractive.getState().setMechanism(node.id, true)
    expect(mechanismHudInteract(node)).toEqual({ label: 'Desk lamp', verb: 'turn off' })

    const lid = mount(registerKind({ mechanism: { ...switchMechanism, verb: 'open' } }), 'lid_1', {
      joints: 1,
    })
    expect(mechanismHudInteract(lid)).toEqual({ label: 'item', verb: 'open' })
    expect(mechanismHudInteract(mount(registerKind({}), 'plain_hud'))).toBeNull()
  })
})
