import { describe, expect, test } from 'bun:test'
import { showsValidityBox } from './move-registry-node-tool'

/**
 * The gap this closes: `floorPlaced.collides` is the spatial grid's plan
 * rectangle, which sees no Y. A kind whose usable volume is mostly air — a
 * racking run with a walkway under it, a mezzanine — must leave it off, and
 * doing so switched off move validation entirely. Placement checked such a
 * kind; dragging it afterwards checked nothing.
 */
describe('which moves are validated', () => {
  test('a kind that declares only canMoveTo is validated', () => {
    expect(showsValidityBox(false, true)).toBe(true)
  })

  test('a colliding kind is validated, as it always was', () => {
    expect(showsValidityBox(true, false)).toBe(true)
  })

  test('a kind declaring neither keeps its plain arrow cursor', () => {
    expect(showsValidityBox(false, false)).toBe(false)
  })
})
