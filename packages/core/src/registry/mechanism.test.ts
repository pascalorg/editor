import { afterEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import type { AnyNode, AnyNodeId } from '../schema/types'
import { useInteractive } from '../store/use-interactive'
import useScene from '../store/use-scene'
import { nodeMechanism, toggleNodeMechanism } from './mechanism'
import { nodeRegistry, registerNode } from './registry'
import type { AnyNodeDefinition } from './types'

const KIND = 'test:articulated'
const NODE_ID = 'articulated_one' as AnyNodeId

// A plugin kind with one switch: its joints either run or rest.
function register(capabilities: AnyNodeDefinition['capabilities']) {
  registerNode({
    kind: KIND,
    schemaVersion: 1,
    schema: z.object({ type: z.literal(KIND) }) as never,
    category: 'furnish',
    defaults: () => ({}) as never,
    capabilities,
    renderer: { kind: 'parametric', module: async () => ({ default: () => null }) },
  })
}

const singleSwitch = {
  has: (node: AnyNode) => (node as unknown as { joints: number }).joints > 0,
  isOn: (node: AnyNode, state: ReturnType<typeof useInteractive.getState>) =>
    Boolean(state.mechanisms[node.id]),
  set: (node: AnyNode, on: boolean) => useInteractive.getState().setMechanism(node.id, on),
}

function articulated(joints: number): AnyNode {
  return { object: 'node', id: NODE_ID, type: KIND, joints } as unknown as AnyNode
}

afterEach(() => {
  nodeRegistry._reset()
  useInteractive.getState().removeMechanism(NODE_ID)
})

describe('mechanism capability', () => {
  test('a kind that declares a mechanism is run by any caller, without its kind name', () => {
    register({ mechanism: singleSwitch })
    const node = articulated(2)

    expect(nodeMechanism(node)).toBe(singleSwitch)
    expect(toggleNodeMechanism(node)).toBe(true)
    expect(useInteractive.getState().mechanisms[NODE_ID]).toBe(true)
    expect(toggleNodeMechanism(node)).toBe(true)
    expect(useInteractive.getState().mechanisms[NODE_ID]).toBe(false)
  })

  test('running a mechanism is transient: the scene and its history do not change', () => {
    register({ mechanism: singleSwitch })
    const node = articulated(1)
    useScene.setState({ nodes: { [NODE_ID]: node } } as never)
    const before = useScene.getState().nodes
    const history = useScene.temporal.getState().pastStates.length

    toggleNodeMechanism(node)

    expect(useScene.getState().nodes).toBe(before)
    expect(useScene.temporal.getState().pastStates).toHaveLength(history)
  })

  test('no mechanism when the node has nothing to run or the kind declares none', () => {
    register({ mechanism: singleSwitch })
    expect(nodeMechanism(articulated(0))).toBeUndefined()
    expect(toggleNodeMechanism(articulated(0))).toBe(false)
    expect(useInteractive.getState().mechanisms[NODE_ID]).toBeUndefined()

    nodeRegistry._reset()
    register({})
    expect(nodeMechanism(articulated(3))).toBeUndefined()
    expect(nodeMechanism(undefined)).toBeUndefined()
  })

  test('removeMechanism forgets the switch', () => {
    useInteractive.getState().setMechanism(NODE_ID, true)
    useInteractive.getState().removeMechanism(NODE_ID)
    expect(NODE_ID in useInteractive.getState().mechanisms).toBe(false)
  })
})
