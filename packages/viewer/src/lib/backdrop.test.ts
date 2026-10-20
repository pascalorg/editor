// @ts-expect-error — Bun types are not part of the viewer's production declaration build.
import { expect, test } from 'bun:test'
import { backdropColors } from '../index'

test('an explicitly flat sky has the same colour at the horizon and zenith', () => {
  const colors = backdropColors({ background: '#dce4e5', backgroundSky: null, appearance: 'light' })
  expect(Object.values(colors)).toEqual(['#dce4e5', '#dce4e5', '#dce4e5', '#dce4e5'])
})

test('an omitted sky preserves the existing derived atmosphere', () => {
  const colors = backdropColors({ background: '#dce4e5', appearance: 'light' })
  expect(colors.sky).toBe('#dce4e5')
  expect(colors.haze).not.toBe(colors.background)
  expect(colors.skyDeep).not.toBe(colors.background)
})
