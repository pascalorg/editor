import { expect, test } from 'bun:test'
import { wallCursorIcon } from './tool-cursor-icon'
import { getWallDrawVariantInfo, WALL_DRAW_VARIANTS } from './wall-draw-variant'

test('the wall cursor bubble shows the Rooms tile icon of the variant in hand', () => {
  for (const variant of WALL_DRAW_VARIANTS) {
    expect(wallCursorIcon(variant.mode)).toEqual({
      label: getWallDrawVariantInfo(variant.id).title,
      iconSrc: variant.iconSrc,
    })
  }
  expect(
    new Set(WALL_DRAW_VARIANTS.map((variant) => wallCursorIcon(variant.mode).iconSrc)).size,
  ).toBe(3)
  expect(getWallDrawVariantInfo('walls').iconSrc).toBe('/icons/wall.webp')
})
