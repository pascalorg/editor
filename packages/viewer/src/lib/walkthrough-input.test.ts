import { afterEach, beforeEach, expect, test } from 'bun:test'
import { createWalkthroughInput, useViewer } from '../index'
import {
  consumeWalkthroughClose,
  consumeWalkthroughFrame,
  consumeWalkthroughInteract,
  consumeWalkthroughShutters,
} from './walkthrough-input'

const input = createWalkthroughInput()
let viewerState = useViewer.getState()
beforeEach(() => {
  viewerState = useViewer.getState()
})
afterEach(() => {
  input.clear()
  useViewer.getState().setWalkthroughMode(false)
  useViewer.setState(viewerState, true)
})

test('the scene channel accumulates look and consumes each request once', () => {
  expect(createWalkthroughInput()).toBe(input)
  input.setMove(0.4, -0.8)
  input.addLook(5, -3)
  input.addLook(7, 9)
  input.requestJump()
  input.requestInteract()
  input.requestShutters()
  input.requestClose()
  expect(consumeWalkthroughFrame()).toEqual({
    joystick: { x: 0.4, y: -0.8 },
    dx: 12,
    dy: 6,
    jump: true,
    crouch: false,
  })
  expect(consumeWalkthroughInteract()).toBe(true)
  expect(consumeWalkthroughShutters()).toBe(true)
  expect(consumeWalkthroughClose()).toBe(true)
  expect(consumeWalkthroughInteract()).toBe(false)
  expect(consumeWalkthroughShutters()).toBe(false)
  expect(consumeWalkthroughClose()).toBe(false)
  expect(consumeWalkthroughFrame()).toEqual({
    joystick: { x: 0.4, y: -0.8 },
    dx: 0,
    dy: 0,
    jump: false,
    crouch: false,
  })
})

test('two presses before a frame are delivered separately', () => {
  input.requestJump()
  input.requestJump()
  input.requestInteract()
  input.requestShutters()
  input.requestClose()
  input.requestInteract()
  input.requestShutters()
  input.requestClose()
  expect(consumeWalkthroughFrame().jump).toBe(true)
  expect(consumeWalkthroughFrame().jump).toBe(true)
  expect(consumeWalkthroughFrame().jump).toBe(false)
  expect(consumeWalkthroughInteract()).toBe(true)
  expect(consumeWalkthroughShutters()).toBe(true)
  expect(consumeWalkthroughClose()).toBe(true)
  expect(consumeWalkthroughInteract()).toBe(true)
  expect(consumeWalkthroughShutters()).toBe(true)
  expect(consumeWalkthroughClose()).toBe(true)
  expect(consumeWalkthroughInteract()).toBe(false)
  expect(consumeWalkthroughShutters()).toBe(false)
  expect(consumeWalkthroughClose()).toBe(false)
})

test('clear drops movement, look and all pending requests', () => {
  input.setMove(9, -9)
  expect(consumeWalkthroughFrame().joystick).toEqual({ x: 1, y: -1 })
  input.addLook(30, 40)
  input.requestJump()
  input.requestInteract()
  input.requestShutters()
  input.requestClose()
  input.setCrouch(true)
  input.clear()
  expect(consumeWalkthroughFrame()).toEqual({
    joystick: { x: 0, y: 0 },
    dx: 0,
    dy: 0,
    jump: false,
    crouch: false,
  })
  expect(consumeWalkthroughInteract()).toBe(false)
  expect(consumeWalkthroughShutters()).toBe(false)
  expect(consumeWalkthroughClose()).toBe(false)
})

test('leaving walkthrough, switching input mode and switching project clear the channel', () => {
  const viewer = useViewer.getState()
  viewer.setWalkthroughMode(true)
  for (const change of [
    () => viewer.setWalkthroughMode(false),
    () => viewer.setWalkthroughInputMode('touch'),
    () => viewer.setProjectId('touch-input-project'),
  ]) {
    input.setMove(1, 1)
    input.addLook(20, 20)
    input.requestJump()
    input.requestInteract()
    input.requestShutters()
    input.requestClose()
    change()
    expect(consumeWalkthroughFrame()).toEqual({
      joystick: { x: 0, y: 0 },
      dx: 0,
      dy: 0,
      jump: false,
      crouch: false,
    })
    expect(consumeWalkthroughInteract()).toBe(false)
    expect(consumeWalkthroughShutters()).toBe(false)
    expect(consumeWalkthroughClose()).toBe(false)
  }
  expect(useViewer.getState().walkthroughInputMode).toBe('desktop')
})

test('input mode is transient and defaults to desktop', () => {
  expect(useViewer.getInitialState().walkthroughInputMode).toBe('desktop')
  useViewer.getState().setWalkthroughInputMode('touch')
  const persisted = useViewer.persist.getOptions().partialize!(useViewer.getState())
  expect(persisted).not.toHaveProperty('walkthroughInputMode')
})
