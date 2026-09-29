import { afterEach, describe, expect, test } from 'bun:test'
import { emitter } from '@pascal-app/core'
import useEditor from '../store/use-editor'
import { toolHudTitle } from './hud-title'
import {
  getWallDrawVariant,
  selectWallDrawVariant,
  WALL_DRAW_VARIANTS,
  wallDrawVariantOf,
} from './wall-draw-variant'

afterEach(() => {
  useEditor.getState().setContinuation('wall', 'room')
  useEditor.getState().armToolMode({ mode: 'select' })
})

describe('Rooms variants', () => {
  test('are Rectangle, Polygon and Walls, in the Build panel order', () => {
    expect(WALL_DRAW_VARIANTS.map((variant) => [variant.id, variant.label, variant.mode])).toEqual([
      ['rectangle', 'Rectangle', 'rectangle'],
      ['polygon', 'Polygon', 'room'],
      ['walls', 'Walls', 'single'],
    ])
  })

  test('default to the chain that closes into a room', () => {
    expect(getWallDrawVariant()).toBe('polygon')
    expect(wallDrawVariantOf('unknown')).toBe('polygon')
  })

  test('picking one sets the wall tool drawing mode, and it sticks', () => {
    for (const variant of WALL_DRAW_VARIANTS) {
      selectWallDrawVariant(variant.id)
      expect(useEditor.getState().getContinuation('wall')).toBe(variant.mode)
      expect(getWallDrawVariant()).toBe(variant.id)
    }
    // Arming the wall tool (e.g. with B) keeps the picked variant.
    selectWallDrawVariant('rectangle')
    useEditor.getState().armToolMode({ mode: 'build', tool: 'wall' })
    expect(getWallDrawVariant()).toBe('rectangle')
  })

  test('switching while the wall tool is armed drops the in-flight draft', () => {
    let cancels = 0
    const onCancel = () => {
      cancels += 1
    }
    emitter.on('tool:cancel', onCancel)
    try {
      selectWallDrawVariant('walls')
      expect(cancels).toBe(0)
      useEditor.getState().armToolMode({ mode: 'build', tool: 'wall' })
      selectWallDrawVariant('rectangle')
      expect(cancels).toBe(1)
      selectWallDrawVariant('rectangle')
      expect(cancels).toBe(1)
    } finally {
      emitter.off('tool:cancel', onCancel)
    }
  })

  test('name the HUD after the variant in hand', () => {
    expect(toolHudTitle('wall', 'rectangle')).toEqual({
      label: 'Rectangle room',
      icon: { kind: 'url', src: '/icons/room.webp' },
      shortcut: 'B',
    })
    expect(toolHudTitle('wall', 'room')?.label).toBe('Polygon room')
    expect(toolHudTitle('wall', 'single')?.label).toBe('Walls')
  })
})
