import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  nodeRegistry,
  registerNode,
  sceneRegistry,
  useInteractive,
  useScene,
} from '@pascal-app/core'
import { Object3D } from 'three'
import {
  hasNativeLeaf,
  mechanismHudInteract,
  mechanismTargetIds,
  nativeOpeningIds,
  watchScriptedDoors,
} from './mechanism-targets'

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

// A door or window built from a script has no native leaf or sash: the walkthrough's own door and
// window targets only start a native swing on it, which draws nothing. Its `open` clip runs
// through its mechanism, as an authored object's does.
describe('walkthrough doors and windows', () => {
  const script = { source: { kind: 'script', script: 'b'.repeat(64), artifact: 'a'.repeat(64) } }

  test('the doors and windows it swings itself are the ones with a native leaf', () => {
    const native = mount('door', 'door_native')
    const scripted = mount('door', 'door_scripted', script)
    mount('window', 'window_native')
    mount('window', 'window_scripted', script)

    expect(nativeOpeningIds().sort()).toEqual(['door_native', 'window_native'] as AnyNodeId[])
    expect(hasNativeLeaf(native)).toBe(true)
    expect(hasNativeLeaf(scripted)).toBe(false)
    expect(hasNativeLeaf(undefined)).toBe(true)
  })
})

// The walkthrough's collider world is rebuilt when a native door's tween ends. A door built from a
// script opens by a clip that no tween system reports: its collider follows its mechanism, so
// the world has to be rebuilt when that flips.
describe('walkthrough scripted doors', () => {
  const mechanism = {
    verb: 'open',
    has: (node: AnyNode) => Boolean((node as unknown as { source?: unknown }).source),
    isOn: (node: AnyNode, state: ReturnType<typeof useInteractive.getState>) =>
      Boolean(state.items[node.id as AnyNodeId]?.controlValues[0]),
    set: () => {},
  }
  let restoreRegistry = () => {}

  beforeEach(() => {
    restoreRegistry = nodeRegistry._snapshot()
    registerNode({
      kind: 'door',
      schemaVersion: 1,
      category: 'structure',
      defaults: () => ({}),
      capabilities: { mechanism },
    } as never)
  })

  afterEach(() => {
    useInteractive.setState({ items: {} } as never)
    restoreRegistry()
  })

  test('a rebuild is asked for when a scripted door opens or closes, and for nothing else', () => {
    mount('door', 'door_scripted_watch', { source: { kind: 'script' } })
    mount('door', 'door_native_watch')
    let rebuilds = 0
    const stop = watchScriptedDoors(() => rebuilds++)
    const setControls = (scripted: boolean, native: boolean) =>
      useInteractive.setState({
        items: {
          door_scripted_watch: { controlValues: [scripted] },
          door_native_watch: { controlValues: [native] },
        },
      } as never)
    try {
      // its model initialising the item closed is not a change
      setControls(false, false)
      expect(rebuilds).toBe(0)
      setControls(true, false)
      expect(rebuilds).toBe(1)
      // the same state again, and a native door's control, are not its business
      setControls(true, false)
      setControls(true, true)
      expect(rebuilds).toBe(1)
      setControls(false, true)
      expect(rebuilds).toBe(2)
    } finally {
      stop()
    }
    setControls(true, true)
    expect(rebuilds).toBe(2)
  })
})
