// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
import { describe, expect, test } from 'bun:test'
import { Group, Mesh } from 'three'
import { isDirectR3FPointerTarget, isR3FPointerTarget } from './pointer-filter'

describe('isDirectR3FPointerTarget', () => {
  test('keeps an explicit collision mesh ahead of its passive rendered sibling', () => {
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
    expect(isR3FPointerTarget(passiveWallBody)).toBe(false)
    expect(isR3FPointerTarget(wallCollisionMesh)).toBe(true)
  })

  test('keeps an explicit collision child ahead of its passive rendered parent', () => {
    const passiveWallBody = new Mesh()
    const wallCollisionMesh = new Mesh()
    const interactiveWrapper = new Group()

    ;(interactiveWrapper as Group & { __r3f: { eventCount: number } }).__r3f = {
      eventCount: 6,
    }
    ;(wallCollisionMesh as Mesh & { __r3f: { eventCount: number } }).__r3f = { eventCount: 6 }
    passiveWallBody.add(wallCollisionMesh)
    interactiveWrapper.add(passiveWallBody)

    expect(isR3FPointerTarget(passiveWallBody)).toBe(false)
    expect(isR3FPointerTarget(wallCollisionMesh)).toBe(true)
  })

  test('inherits pointer handlers for nested imported meshes', () => {
    const interactiveItemWrapper = new Group()
    const importedGroup = new Group()
    const importedMesh = new Mesh()
    ;(interactiveItemWrapper as Group & { __r3f: { eventCount: number } }).__r3f = {
      eventCount: 6,
    }
    interactiveItemWrapper.add(importedGroup)
    importedGroup.add(importedMesh)

    expect(isR3FPointerTarget(importedMesh)).toBe(true)
  })

  test('rejects geometry with no eventful ancestor', () => {
    expect(isR3FPointerTarget(new Mesh())).toBe(false)
  })
})
