import { describe, expect, test } from 'bun:test'
import type { LightEffect } from '@pascal-app/core'
import { type Light, PointLight, Scene } from 'three'
import { LightsNode } from 'three/webgpu'
import {
  ItemLightPool,
  POOL_SIZE,
  type PoolLightSource,
  poolTargetIntensity,
  type ScoredKey,
} from './light-pool'

const DT = 1 / 60

function source(overrides: Partial<LightEffect> = {}): PoolLightSource {
  return {
    effect: {
      kind: 'light',
      color: '#ffe0b0',
      intensityRange: [0, 2],
      distance: 6,
      offset: [0, 0, 0],
      ...overrides,
    } as LightEffect,
    toggleIndex: 0,
    sliderIndex: -1,
    hasSlider: false,
    sliderMin: 0,
    sliderMax: 1,
  }
}

/**
 * A pool mounted in a scene the way `ItemLightSystem` mounts it, with `count`
 * lit items. `on` holds each item's toggle; `scores` its camera score.
 */
function house(count: number) {
  const scene = new Scene()
  const pool = new ItemLightPool()
  for (let i = 0; i < POOL_SIZE; i++) {
    const light = new PointLight()
    light.castShadow = false
    light.intensity = 0
    light.visible = false
    scene.add(light)
    pool.lights[i] = light
  }
  const keys = Array.from({ length: count }, (_, i) => `light-${i}`)
  const sources = new Map(keys.map((k) => [k, source()]))
  const on = new Map(keys.map((k) => [k, false]))
  const scores = new Map(keys.map((k, i) => [k, i / count]))
  const lightsNode = new LightsNode()

  const values = (key: string) => [on.get(key)]
  const sourceOf = (key: string) => sources.get(key)

  const frame = (rescore = false) => {
    if (rescore) {
      const scored: ScoredKey[] = [...sources.keys()].map((key) => ({
        key,
        score: on.get(key) ? scores.get(key)! : Number.POSITIVE_INFINITY,
      }))
      pool.reassign(scored, sourceOf)
    }
    pool.update(DT, sourceOf, (key) => {
      const s = sources.get(key)
      return s ? poolTargetIntensity(s, values(key)) : null
    })
  }

  return {
    pool,
    keys,
    sources,
    on,
    scores,
    frame,
    /** Re-score, then run frames long enough for every fade to finish. */
    settle(frames = 120) {
      frame(true)
      for (let i = 0; i < frames; i++) frame()
    },
    /** The lights the renderer would pass to its lights node this frame. */
    visibleLights() {
      const lights: Light[] = []
      scene.traverseVisible((o) => {
        if ((o as Light).isLight) lights.push(o as Light)
      })
      return lights
    },
    /** `LightsNode.customCacheKey` over the visible lights: a change rebuilds every lit material. */
    cacheKey() {
      lightsNode.setLights(this.visibleLights())
      return lightsNode.customCacheKey()
    },
  }
}

/** Deterministic shuffle source so the orbit test is reproducible. */
function prng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

describe('ItemLightPool', () => {
  test('shows no lights before any light is switched on', () => {
    const h = house(20)
    h.settle()
    expect(h.visibleLights()).toHaveLength(0)
  })

  test('the first allocation shows all twelve lights at once; the spare slots stay dark', () => {
    const h = house(20)
    h.settle()
    for (const key of h.keys.slice(0, 3)) h.on.set(key, true)
    h.frame(true)
    expect(h.visibleLights()).toHaveLength(POOL_SIZE)
    h.settle()
    const lights = h.pool.lights as PointLight[]
    expect(lights.filter((l) => l.intensity > 0)).toHaveLength(3)
    expect(lights.filter((l) => l.intensity === 0)).toHaveLength(POOL_SIZE - 3)
  })

  test('re-scoring as the camera orbits keeps the light set and its cache key', () => {
    const h = house(58)
    for (const key of h.keys) h.on.set(key, true)
    h.settle()
    const key = h.cacheKey()
    const random = prng(7)
    let reassignments = 0
    for (let step = 0; step < 50; step++) {
      for (const k of h.keys) h.scores.set(k, random())
      const before = h.pool.assignedKeys().join()
      h.frame(true)
      if (h.pool.assignedKeys().join() !== before) reassignments++
      for (let i = 0; i < 6; i++) {
        h.frame()
        expect(h.visibleLights()).toHaveLength(POOL_SIZE)
        expect(h.cacheKey()).toBe(key)
      }
    }
    expect(reassignments).toBeGreaterThan(10)
  })

  test('switching lights off and back on keeps the light set; off slots reach zero', () => {
    const h = house(20)
    for (const key of h.keys) h.on.set(key, true)
    h.settle()
    const key = h.cacheKey()
    const lights = h.pool.lights as PointLight[]

    // The kitchen: ten lights off, then back on.
    for (const k of h.keys.slice(0, 10)) h.on.set(k, false)
    h.settle()
    expect(h.cacheKey()).toBe(key)
    for (const k of h.keys.slice(0, 10)) h.on.set(k, true)
    h.settle()
    expect(h.cacheKey()).toBe(key)

    // Every light off: the pool keeps its lights, all at exactly zero.
    for (const k of h.keys) h.on.set(k, false)
    h.frame(true)
    for (let i = 0; i < 120; i++) {
      h.frame()
      expect(h.cacheKey()).toBe(key)
    }
    expect(lights.every((l) => l.intensity === 0)).toBe(true)

    for (const k of h.keys) h.on.set(k, true)
    h.settle()
    expect(h.cacheKey()).toBe(key)
    expect(lights.filter((l) => l.intensity > 0)).toHaveLength(POOL_SIZE)
  })

  test('a deleted light goes dark without leaving the set', () => {
    const h = house(4)
    for (const key of h.keys) h.on.set(key, true)
    h.settle()
    const key = h.cacheKey()
    h.sources.delete('light-0')
    h.on.delete('light-0')
    h.settle()
    expect(h.cacheKey()).toBe(key)
    expect((h.pool.lights as PointLight[]).filter((l) => l.intensity > 0)).toHaveLength(3)
  })

  test('assigned lights take their item’s colour, range and intensity', () => {
    const h = house(2)
    h.sources.set('light-1', source({ color: '#ff0000', distance: 3, intensityRange: [0.5, 4] }))
    h.on.set('light-1', true)
    h.settle()
    const lit = (h.pool.lights as PointLight[]).find((l) => l.intensity > 0)!
    expect(lit.color.getHexString()).toBe('ff0000')
    expect(lit.distance).toBe(3)
    expect(lit.intensity).toBeCloseTo(4, 3)
  })
})

describe('poolTargetIntensity', () => {
  test('off lights sit at the bottom of their range, on lights follow the slider', () => {
    const dimmer = { ...source({ intensityRange: [0.5, 4] }), sliderIndex: 1, hasSlider: true }
    dimmer.sliderMax = 100
    expect(poolTargetIntensity(dimmer, [false, 100])).toBe(0.5)
    expect(poolTargetIntensity(dimmer, [true, 100])).toBe(4)
    expect(poolTargetIntensity(dimmer, [true, 50])).toBeCloseTo(2.25)
    expect(poolTargetIntensity(dimmer, [true, undefined])).toBe(0.5)
  })

  test('a degenerate slider range reads as full brightness', () => {
    const dimmer = { ...source(), sliderIndex: 1, hasSlider: true, sliderMin: 1, sliderMax: 1 }
    expect(poolTargetIntensity(dimmer, [true, 1])).toBe(2)
  })
})
