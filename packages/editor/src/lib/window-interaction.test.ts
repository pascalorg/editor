import { afterEach, expect, test } from 'bun:test'
import { useInteractive, useScene, WindowNode } from '@pascal-app/core'
import {
  getDisplayedWindowShutterValue,
  getDisplayedWindowValue,
  openWindowOpenState,
  setWindowShuttersOpenState,
} from '../index'

const originalScene = useScene.getState()
const originalInteractive = useInteractive.getState()
afterEach(() => {
  useScene.setState(originalScene)
  useInteractive.setState(originalInteractive)
})

test.each(['box', 'concealed'] as const)(
  '%s shutter previews use saved defaults, can reverse, and leave sash animation queued',
  (rollerShutter) => {
    const node = WindowNode.parse({ windowType: 'casement', shutters: 'panel', rollerShutter })
    useScene.setState({ nodes: { [node.id]: node } })
    useInteractive.setState({ windows: {}, windowAnimations: {} })
    expect(getDisplayedWindowShutterValue(node.id, 'shutterOpen', undefined)).toBe(1)
    expect(getDisplayedWindowShutterValue(node.id, 'rollerShutterOpen', 0.7)).toBe(0.7)
    openWindowOpenState(node.id, { persist: false })
    setWindowShuttersOpenState(node.id, false, { persist: false })
    expect(getDisplayedWindowValue(node.id, node.operationState)).toBe(0)
    expect(useInteractive.getState().windowAnimations[node.id]?.operationState?.to).toBe(1)
    useInteractive
      .getState()
      .setWindowOpenState(node.id, { shutterOpen: 0.3, rollerShutterOpen: 0.5 })
    setWindowShuttersOpenState(node.id, true, { persist: false })
    expect(useInteractive.getState().windowAnimations[node.id]).toMatchObject({
      shutterOpen: { from: 0.3, to: 1, persist: false },
      rollerShutterOpen: { from: 0.5, to: 1, persist: false },
      operationState: { to: 1 },
    })
    useInteractive.getState().cancelWindowAnimation(node.id)
    useInteractive.getState().removeWindowOpenState(node.id)
    expect(getDisplayedWindowShutterValue(node.id, 'shutterOpen', 0.7)).toBe(0.7)
  },
)
