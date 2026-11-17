import { expect, test } from 'bun:test'
import { CameraControlsImpl } from '@react-three/drei'
import { cameraBindings } from './camera-bindings'

const { ACTION } = CameraControlsImpl

test.each([false, true])(
  'default camera bindings preserve selection, pan, orbit and projection-sensitive wheel/touch (%s)',
  (orthographic) => {
    expect(cameraBindings(orthographic)).toEqual({
      mouseButtons: {
        left: ACTION.NONE,
        middle: ACTION.SCREEN_PAN,
        right: ACTION.ROTATE,
        wheel: orthographic ? ACTION.ZOOM : ACTION.DOLLY,
      },
      touches: {
        one: ACTION.TOUCH_ROTATE,
        two: orthographic ? ACTION.TOUCH_ZOOM_TRUCK : ACTION.TOUCH_DOLLY_TRUCK,
        three: ACTION.TOUCH_ROTATE,
      },
    })
  },
)

test.each([false, true])(
  'host bindings survive temporary Space pan and projection changes (%s)',
  (orthographic) => {
    const mouse = { left: 'rotate', middle: 'dolly', right: 'pan' } as const
    const touch = { one: 'none', two: 'rotate', three: 'dolly-pan' } as const
    const bindings = cameraBindings(orthographic, mouse, touch)
    expect(bindings.mouseButtons).toEqual({
      left: ACTION.ROTATE,
      middle: ACTION.DOLLY,
      right: ACTION.SCREEN_PAN,
      wheel: orthographic ? ACTION.ZOOM : ACTION.DOLLY,
    })
    expect(bindings.touches).toEqual({
      one: ACTION.NONE,
      two: ACTION.TOUCH_ROTATE,
      three: orthographic ? ACTION.TOUCH_ZOOM_TRUCK : ACTION.TOUCH_DOLLY_TRUCK,
    })
    expect(cameraBindings(orthographic, mouse, touch, true).mouseButtons).toEqual({
      ...bindings.mouseButtons,
      left: ACTION.SCREEN_PAN,
    })
    expect(cameraBindings(orthographic, mouse, touch, false)).toEqual(bindings)
    expect(cameraBindings(orthographic, {}, { one: 'dolly-pan' }).touches.one).toBe(
      ACTION.TOUCH_TRUCK,
    )
  },
)
