import { describe, expect, test } from 'bun:test'
import { resolveArticraftRootTransform } from './transform'

const node = {
  position: [1, 2, 3] as [number, number, number],
  rotation: [0.1, 0.2, 0.3] as [number, number, number],
  scale: 1.5,
}

describe('Articraft root transform', () => {
  test('uses the persisted transform when no gesture is active', () => {
    expect(resolveArticraftRootTransform(node)).toEqual(node)
  })

  test('renders host move and keyboard rotation previews immediately', () => {
    expect(
      resolveArticraftRootTransform(node, {
        position: [4, 5, 6],
        rotation: 1.25,
      }),
    ).toEqual({
      position: [4, 5, 6],
      rotation: [0.1, 1.25, 0.3],
      scale: 1.5,
    })
  })

  test('renders handle-driven position, rotation, and scale overrides before commit', () => {
    expect(
      resolveArticraftRootTransform(node, undefined, {
        position: [7, 8, 9],
        rotation: [0.4, 0.5, 0.6],
        scale: 2.25,
      }),
    ).toEqual({
      position: [7, 8, 9],
      rotation: [0.4, 0.5, 0.6],
      scale: 2.25,
    })
  })

  test('keeps override tilt and applies the live drag pose with host precedence', () => {
    expect(
      resolveArticraftRootTransform(
        node,
        { position: [10, 11, 12], rotation: 0.75 },
        { position: [7, 8, 9], rotation: [0.4, 0.5, 0.6], scale: 3 },
      ),
    ).toEqual({
      position: [10, 11, 12],
      rotation: [0.4, 0.75, 0.6],
      scale: 3,
    })
  })
})
