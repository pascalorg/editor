import { expect, test } from 'bun:test'
import type { Recipe } from '../procedural-items/recipe'

type Shape = Recipe['parts'][number]['shapes'][number]
// R1: a v1 consumer reading a non-extrude shape's size keeps compiling once it narrows on the
// primitive it knows.
function width(shape: Shape): number {
  if (shape.primitive === 'box' || shape.primitive === 'cylinder') {
    const size: [unknown, unknown, unknown] = shape.size
    return typeof size[0] === 'number' ? size[0] : 0
  }
  return 0
}

test('non-extrude shapes keep a required size', () => {
  expect(
    width({ id: 'b', primitive: 'box', slot: 's', size: [1, 1, 1], position: [0, 0, 0] }),
  ).toBe(1)
})
