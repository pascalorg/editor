import { describe, expect, test } from 'bun:test'
import {
  createSceneApi,
  DoorNode,
  type HandleDescriptor,
  useScene,
  WindowNode,
} from '@pascal-app/core'
import { doorDefinition } from '../door/definition'
import { windowDefinition } from '../window/definition'

const scene = createSceneApi(useScene)

function radiusHandles<N>(
  handles: unknown,
): Extract<HandleDescriptor<N>, { kind: 'corner-radius' }>[] {
  return (handles as HandleDescriptor<N>[]).filter(
    (handle): handle is Extract<HandleDescriptor<N>, { kind: 'corner-radius' }> =>
      handle.kind === 'corner-radius',
  )
}

describe('opening corner-radius handles', () => {
  test('window exposes four dots and supports shared or Shift-isolated rounding', () => {
    const window = WindowNode.parse({ id: 'window_radius', cornerRadius: 0.15 })
    const handles = radiusHandles<WindowNode>(windowDefinition.handles)

    expect(handles).toHaveLength(4)
    expect(handles[0]?.apply(window, 0.3, scene, { altKey: false })).toMatchObject({
      cornerRadius: 0.3,
      openingRadiusMode: 'all',
      openingShape: 'rounded',
    })
    expect(handles[2]?.apply(window, 0.25, scene, { altKey: false, shiftKey: true })).toMatchObject(
      {
        openingCornerRadii: [0.15, 0.15, 0.25, 0.15],
        openingRadiusMode: 'individual',
        openingShape: 'rounded',
      },
    )
  })

  test('door exposes only its top two dots and hides them for an arch', () => {
    const door = DoorNode.parse({ id: 'door_radius', cornerRadius: 0.15 })
    const handles = radiusHandles<DoorNode>(doorDefinition.handles)

    expect(handles.map((handle) => handle.corner)).toEqual([
      [-1, 1],
      [1, 1],
    ])
    expect(handles[1]?.apply(door, 0.2, scene, { altKey: false, shiftKey: true })).toMatchObject({
      openingRadiusMode: 'individual',
      openingShape: 'rounded',
      openingTopRadii: [0.15, 0.2],
    })
    expect(handles[0]?.visible?.({ ...door, openingShape: 'arch' }, scene)).toBe(false)
    expect(
      handles[0]?.visible?.(
        { ...door, openingShape: 'rounded', cornerRadius: door.width / 2 },
        scene,
      ),
    ).toBe(true)
    expect(
      handles[0]?.visible?.({ ...door, openingShape: 'rounded', cornerRadius: 0.15 }, scene),
    ).toBe(true)
  })
})
