// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not depend on @types/bun.
import { describe, expect, test } from 'bun:test'
import { Texture } from 'three'
import {
  getOverlaySceneDepth,
  setOverlaySceneDepth,
  subscribeOverlaySceneDepth,
} from './overlay-scene-depth'

describe('the scene depth handed to overlay materials', () => {
  test('a listener hears the depth now, each change once, and null when the pipeline goes', () => {
    const heard: (Texture | null)[] = []
    const stop = subscribeOverlaySceneDepth((depth) => heard.push(depth))
    const first = new Texture()
    const rebuilt = new Texture()
    setOverlaySceneDepth(first)
    setOverlaySceneDepth(first)
    setOverlaySceneDepth(rebuilt)
    setOverlaySceneDepth(null)
    stop()
    setOverlaySceneDepth(first)
    expect(heard).toEqual([null, first, rebuilt, null])
    expect(getOverlaySceneDepth()).toBe(first)
    setOverlaySceneDepth(null)
  })
})
