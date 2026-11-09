import { afterEach, expect, test } from 'bun:test'
import { useInteractive, useScene, WindowNode } from '@pascal-app/core'
import { getDisplayedWindowShutterValue } from '@pascal-app/editor'
import { windowMechanism } from './mechanism'

const originalScene = useScene.getState()
const originalInteractive = useInteractive.getState()
afterEach(() => {
  useScene.setState(originalScene)
  useInteractive.setState(originalInteractive)
})

const shutters = windowMechanism.parts![0]!

test('shutters are available for fixed windows, hinged leaves or a roller box, but not scripts', () => {
  for (const fields of [
    { shutters: 'panel' },
    { rollerShutter: 'box' },
    { rollerShutter: 'concealed' },
  ] as const) {
    const node = WindowNode.parse({ windowType: 'fixed', ...fields })
    expect(windowMechanism.has(node)).toBe(false)
    expect(shutters.has(node)).toBe(true)
    expect(shutters.has({ ...node, source: { kind: 'script' } as WindowNode['source'] })).toBe(
      false,
    )
  }
  expect(shutters.has(WindowNode.parse({ shutters: 'none' }))).toBe(false)
})

test.each(['box', 'concealed'] as const)(
  'closing hinged shutters and a %s roller previews without changing the saved node',
  (rollerShutter) => {
    const node = WindowNode.parse({
      shutters: 'panel',
      rollerShutter,
      shutterOpen: 0.8,
      rollerShutterOpen: 0.6,
    })
    useScene.setState({ nodes: { [node.id]: node } })
    useInteractive.setState({ windows: {}, windowAnimations: {}, mechanismParts: {} })
    const before = useScene.getState().nodes
    const history = useScene.temporal.getState().pastStates.length
    expect(shutters.isOn(node, useInteractive.getState())).toBe(true)
    shutters.set(node, false)
    expect(useScene.getState().nodes).toBe(before)
    expect(node.shutterOpen).toBe(0.8)
    expect(node.rollerShutterOpen).toBe(0.6)
    expect(useScene.temporal.getState().pastStates).toHaveLength(history)
    expect(useInteractive.getState().windowAnimations[node.id]).toMatchObject({
      shutterOpen: { from: 0.8, to: 0, persist: false },
      rollerShutterOpen: { from: 0.6, to: 0, persist: false },
    })
    expect(getDisplayedWindowShutterValue(node.id, 'shutterOpen', node.shutterOpen)).toBe(0.8)
    useInteractive.getState().setWindowOpenState(node.id, { shutterOpen: 0, rollerShutterOpen: 0 })
    expect(shutters.isOn(node, useInteractive.getState())).toBe(false)
    shutters.set(node, true)
    expect(useInteractive.getState().windowAnimations[node.id]?.shutterOpen).toMatchObject({
      from: 0,
      to: 1,
      persist: false,
    })
  },
)

test('the shutter selector reads its supplied snapshot and falls back to saved data without a preview', () => {
  const node = WindowNode.parse({ shutters: 'panel', shutterOpen: 0 })
  const state = useInteractive.getState()
  expect(shutters.isOn(node, { ...state, windows: {}, windowAnimations: {} })).toBe(false)
  expect(shutters.isOn(node, { ...state, windows: { [node.id]: { shutterOpen: 1 } } })).toBe(true)
  expect(
    getDisplayedWindowShutterValue(node.id, 'shutterOpen', undefined, {
      ...state,
      windows: {},
      windowAnimations: {},
    }),
  ).toBe(1)
})
