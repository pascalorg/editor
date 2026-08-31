// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
import { describe, expect, test } from 'bun:test'
import { Mesh } from 'three'
import { isSceneBvhExcluded } from './scene-bvh'

describe('scene BVH exclusions', () => {
  test('keeps annotation meshes on their normal raycast path', () => {
    expect(isSceneBvhExcluded(new Mesh())).toBe(false)

    const annotation = new Mesh()
    annotation.userData.excludeFromBvh = true

    expect(isSceneBvhExcluded(annotation)).toBe(true)
  })
})
