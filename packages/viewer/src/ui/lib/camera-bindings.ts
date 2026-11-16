import { CameraControlsImpl } from '@react-three/drei'

export type CameraPointerAction = 'none' | 'rotate' | 'pan' | 'dolly'
export type CameraMouseButtons = Partial<Record<'left' | 'middle' | 'right', CameraPointerAction>>
export type CameraTouches = Partial<
  Record<'one' | 'two' | 'three', 'rotate' | 'dolly-pan' | 'none'>
>

export function cameraBindings(
  orthographic: boolean,
  mouse: CameraMouseButtons = {},
  touch: CameraTouches = {},
  space = false,
) {
  const { ACTION } = CameraControlsImpl
  const mouseAction = {
    none: ACTION.NONE,
    rotate: ACTION.ROTATE,
    pan: ACTION.SCREEN_PAN,
    dolly: ACTION.DOLLY,
  }
  const touchAction = {
    none: ACTION.NONE,
    rotate: ACTION.TOUCH_ROTATE,
    'dolly-pan': orthographic ? ACTION.TOUCH_ZOOM_TRUCK : ACTION.TOUCH_DOLLY_TRUCK,
  }
  return {
    mouseButtons: {
      left: space ? ACTION.SCREEN_PAN : mouseAction[mouse.left ?? 'none'],
      middle: mouseAction[mouse.middle ?? 'pan'],
      right: mouseAction[mouse.right ?? 'rotate'],
      wheel: orthographic ? ACTION.ZOOM : ACTION.DOLLY,
    },
    touches: {
      // Pinch requires two pointers; a single dolly-pan pointer can only pan.
      one:
        touch.one === 'dolly-pan'
          ? ACTION.TOUCH_TRUCK
          : touch.one === 'none'
            ? ACTION.NONE
            : ACTION.TOUCH_ROTATE,
      two: touchAction[touch.two ?? 'dolly-pan'],
      three: touchAction[touch.three ?? 'rotate'],
    },
  }
}
