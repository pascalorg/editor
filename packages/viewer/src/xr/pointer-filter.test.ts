// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
import { describe, expect, test } from 'bun:test'
import { Group, Mesh } from 'three'
import { isDirectR3FPointerTarget } from './pointer-filter'

describe('isDirectR3FPointerTarget', () => {
  test('keeps the interactive collision mesh and skips passive geometry under interactive wrappers', () => {
    const passiveWallBody = new Mesh()
    const wallCollisionMesh = new Mesh()
    const interactiveLevelWrapper = new Group()

    ;(interactiveLevelWrapper as Group & { __r3f: { eventCount: number } }).__r3f = {
      eventCount: 6,
    }
    interactiveLevelWrapper.add(passiveWallBody, wallCollisionMesh)
    ;(wallCollisionMesh as Mesh & { __r3f: { eventCount: number } }).__r3f = { eventCount: 6 }

    expect(isDirectR3FPointerTarget(passiveWallBody)).toBe(false)
    expect(isDirectR3FPointerTarget(wallCollisionMesh)).toBe(true)
  })
})
