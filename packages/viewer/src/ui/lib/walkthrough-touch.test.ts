import { afterEach, expect, test } from 'bun:test'
import { createWalkthroughInput, useViewer } from '../../index'
import { consumeWalkthroughFrame, onWalkthroughInputClear } from '../../lib/walkthrough-input'
import { createWalkthroughTouchGestures, STICK_RADIUS, walkthroughStick } from './walkthrough-touch'

afterEach(() => createWalkthroughInput().clear())

test('stick dead zone, clamping and camera-relative axes including a diagonal', () => {
  expect(walkthroughStick(0, 0)).toMatchObject({ x: 0, y: 0 })
  expect(walkthroughStick(STICK_RADIUS * 0.1, 0)).toMatchObject({ x: 0, y: 0 })
  expect(walkthroughStick(STICK_RADIUS * 0.13, 0).x).toBeCloseTo(0.13)
  for (const [dx, dy, x, y] of [
    [1000, 0, 1, 0],
    [-1000, 0, -1, 0],
    [0, -1000, 0, 1],
    [0, 1000, 0, -1],
  ]) {
    const stick = walkthroughStick(dx!, dy!)
    expect(stick.x).toBeCloseTo(x!)
    expect(stick.y).toBeCloseTo(y!)
    expect(Math.hypot(stick.dx, stick.dy)).toBeCloseTo(STICK_RADIUS)
  }
  const diagonal = walkthroughStick(1000, -1000)
  expect(diagonal.x).toBeCloseTo(Math.SQRT1_2)
  expect(diagonal.y).toBeCloseTo(Math.SQRT1_2)
})

test('two captured thumbs move and look independently; normal release preserves the other thumb', () => {
  const captures: number[] = []
  const pointer = (pointerId: number, clientX: number, clientY: number) => ({
    pointerId,
    clientX,
    clientY,
    preventDefault() {},
    currentTarget: { setPointerCapture: (id: number) => captures.push(id) },
  })
  const gestures = createWalkthroughTouchGestures(() => {})
  const off = onWalkthroughInputClear(gestures.reset)
  try {
    gestures.stickDown(pointer(1, 100, 100))
    gestures.lookDown(pointer(2, 800, 100))
    gestures.stickDown(pointer(3, 200, 200))
    gestures.stickMove(pointer(2, 120, 80)) // look pointer cannot take the stick
    gestures.lookMove(pointer(1, 400, 400))
    expect(consumeWalkthroughFrame()).toMatchObject({ joystick: { x: 0, y: 0 }, dx: 0, dy: 0 })
    gestures.stickMove(pointer(1, 156, 100))
    gestures.lookMove(pointer(2, 815, 108))
    expect(captures).toEqual([1, 2])
    expect(consumeWalkthroughFrame()).toMatchObject({ joystick: { x: 1, y: 0 }, dx: 15, dy: 8 })
    gestures.up(pointer(2, 815, 108))
    gestures.lost(pointer(2, 815, 108))
    expect(consumeWalkthroughFrame().joystick.x).toBe(1)
    gestures.cancel()
    expect(consumeWalkthroughFrame().joystick.x).toBe(0)
    gestures.stickMove(pointer(1, 156, 100))
    expect(consumeWalkthroughFrame().joystick.x).toBe(0)
    gestures.stickDown(pointer(4, 100, 100))
    gestures.stickMove(pointer(4, 156, 100))
    gestures.lost(pointer(4, 156, 100))
    expect(consumeWalkthroughFrame().joystick.x).toBe(0)
  } finally {
    off()
  }
})

test('Exit leaves walkthrough through the viewer action', () => {
  useViewer.getState().setWalkthroughMode(true)
  createWalkthroughTouchGestures(() => {}).exit()
  expect(useViewer.getState().walkthroughMode).toBe(false)
})

test('crouch holds until its own pointer releases; cancellation and capture loss clear it', () => {
  const pointer = (pointerId: number) => ({
    pointerId,
    clientX: 0,
    clientY: 0,
    preventDefault() {},
    currentTarget: { setPointerCapture() {} },
  })
  const gestures = createWalkthroughTouchGestures(() => {})
  const off = onWalkthroughInputClear(gestures.reset)
  try {
    gestures.crouchDown(pointer(1))
    expect(consumeWalkthroughFrame().crouch).toBe(true)
    gestures.crouchDown(pointer(2))
    gestures.up(pointer(2))
    expect(consumeWalkthroughFrame().crouch).toBe(true)
    gestures.up(pointer(1))
    expect(consumeWalkthroughFrame().crouch).toBe(false)
    gestures.crouchDown(pointer(3))
    gestures.lost(pointer(3))
    expect(consumeWalkthroughFrame().crouch).toBe(false)
    gestures.crouchDown(pointer(4))
    gestures.cancel()
    expect(consumeWalkthroughFrame().crouch).toBe(false)
    gestures.crouchDown(pointer(5))
    expect(consumeWalkthroughFrame().crouch).toBe(true)
  } finally {
    off()
  }
})
