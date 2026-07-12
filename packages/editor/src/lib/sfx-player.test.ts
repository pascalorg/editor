import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

type FakeContext = { id: string }

let activeContext: FakeContext = { id: 'first' }
let throwOnPlay = false
const instances: FakeHowl[] = []

class FakeHowl {
  stateValue: 'loaded' | 'unloaded' = 'loaded'
  unloadCount = 0
  playCount = 0

  constructor(_options: unknown) {
    instances.push(this)
  }

  play() {
    this.playCount++
    if (throwOnPlay) throw new DOMException('stale graph', 'InvalidAccessError')
    return 1
  }

  volume() {
    return this
  }

  rate() {
    return this
  }

  state() {
    return this.stateValue
  }

  unload() {
    this.unloadCount++
    this.stateValue = 'unloaded'
    return null
  }
}

const fakeHowler = {
  get ctx() {
    return activeContext
  },
}

mock.module('howler', () => ({ Howl: FakeHowl, Howler: fakeHowler }))
mock.module('../store/use-audio', () => ({
  default: {
    getState: () => ({ masterVolume: 100, muted: false, sfxVolume: 100 }),
  },
}))

const { disposeSFX, playSFX, preloadSFX } = await import('./sfx-player')
const { disposeSFXBus, initSFXBus, triggerSFX } = await import('./sfx-bus')

beforeEach(() => {
  disposeSFXBus()
  activeContext = { id: 'first' }
  throwOnPlay = false
  instances.length = 0
})

afterAll(() => {
  disposeSFXBus()
  mock.restore()
})

describe('SFX audio context lifecycle', () => {
  test('reuses the preloaded cache while the Howler context is unchanged', () => {
    preloadSFX()
    const initialCount = instances.length

    playSFX('itemDelete')

    expect(instances).toHaveLength(initialCount)
  })

  test('rebuilds every cached Howl before playing against a new context', () => {
    preloadSFX()
    const oldSounds = [...instances]
    const initialCount = instances.length
    activeContext = { id: 'second' }

    playSFX('itemDelete')

    expect(oldSounds.every((sound) => sound.unloadCount === 1)).toBe(true)
    expect(instances.length).toBe(initialCount * 2)
    expect(instances.slice(initialCount).some((sound) => sound.playCount === 1)).toBe(true)
  })

  test('contains a stale graph failure and backs off instead of rebuilding per cue', () => {
    preloadSFX()
    const initialCount = instances.length
    throwOnPlay = true

    expect(() => playSFX('menuHover')).not.toThrow()
    expect(instances.slice(0, initialCount).every((sound) => sound.unloadCount === 1)).toBe(true)

    throwOnPlay = false
    playSFX('menuHover')
    expect(instances.length).toBe(initialCount)
  })

  test('disposes idempotently and recreates sounds after remount', () => {
    preloadSFX()
    const initialCount = instances.length

    disposeSFX()
    disposeSFX()
    playSFX('itemDelete')

    expect(instances.length).toBe(initialCount * 2)
  })

  test('does not let an emitted SFX failure escape an editor callback', () => {
    initSFXBus()
    throwOnPlay = true

    expect(() => triggerSFX('sfx:item-delete')).not.toThrow()
  })
})
