import { expect, test } from 'bun:test'
import { float } from 'three/tsl'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { lotMaskedMaterial } from './lot-mask'

const LOT = [
  [-15, -15],
  [15, -15],
  [15, 15],
  [-15, 15],
] as const

function reads(root: unknown, wanted: unknown) {
  let found = false
  ;(root as { traverse: (visit: (node: unknown) => void) => void }).traverse((node) => {
    if (node === wanted) found = true
  })
  return found
}

type Masked = { maskNode: unknown; maskShadowNode: unknown }

test('the ground cut to the lot keeps the mask it carries, and its shadow mask stops at the line too', () => {
  const drawn = float(1).greaterThan(0)
  const shadow = float(2).greaterThan(0)
  const ground = new MeshBasicNodeMaterial()
  ;(ground as unknown as Masked).maskNode = drawn
  // A ground with no shadow mask of its own (as it ships) gets none: its mask serves the shadow.
  const plain = lotMaskedMaterial(ground, LOT) as unknown as Masked
  expect(reads(plain.maskNode, drawn)).toBe(true)
  expect(plain.maskNode).not.toBe(drawn)
  expect(plain.maskShadowNode).toBeNull()

  // A ground that casts its shadow where it is not drawn carries a shadow mask: the tiles reach
  // past the lot, and their shadow must not.
  ;(ground as unknown as Masked).maskShadowNode = shadow
  const implied = lotMaskedMaterial(ground, LOT) as unknown as Masked
  expect(reads(implied.maskShadowNode, shadow)).toBe(true)
  expect(implied.maskShadowNode).not.toBe(shadow)
  expect(reads(implied.maskShadowNode, drawn)).toBe(false)
})
