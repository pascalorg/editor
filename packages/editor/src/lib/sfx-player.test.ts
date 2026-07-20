import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

type FakeContext = { id: string }

let activeContext: FakeContext = { id: 'first' }
let initialState: 'loaded' | 'loading' = 'loaded'
let throwOnPlay = false
const instances: FakeHowl[] = []

class FakeHowl {
  stateValue: 'loaded' | 'loading' | 'unloaded' = initialState
  unloadCount = 0
  playCount = 0
  stereoCalls: Array<[number, number | undefined]> = []
  volumeCalls: Array<[number, number | undefined]> = []

  constructor(_options: unknown) {
    instances.push(this)
  }

  play() {
    this.playCount++
    if (throwOnPlay) throw new DOMException('stale graph', 'InvalidAccessError')
    return 1
  }

  volume(value: number, id?: number) {
    this.volumeCalls.push([value, id])
    return this
  }

  stereo(value: number, id?: number) {
    this.stereoCalls.push([value, id])
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
  initialState = 'loaded'
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

  test('does not queue spatial mutations while a sound is still loading', () => {
    initialState = 'loading'

    playSFX('itemDelete', { source: 'remote', stereo: 0.65, volumeMultiplier: 0.25 })

    expect(instances.every((sound) => sound.playCount === 0)).toBe(true)
    expect(instances.every((sound) => sound.stereoCalls.length === 0)).toBe(true)
    expect(instances.every((sound) => sound.volumeCalls.length === 0)).toBe(true)
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

  test('applies bounded gain and stereo positioning to a remote cue', () => {
    playSFX('itemDelete', { source: 'remote', stereo: 0.65, volumeMultiplier: 0.25 })

    const played = instances.find((sound) => sound.playCount === 1)
    expect(played?.volumeCalls[0]?.[0]).toBeGreaterThanOrEqual(0.225)
    expect(played?.volumeCalls[0]?.[0]).toBeLessThanOrEqual(0.25)
    expect(played?.stereoCalls).toEqual([[0.65, 1]])
  })

  test('keeps local feedback audible after the same remote cue', () => {
    playSFX('itemDelete', { source: 'remote', volumeMultiplier: 0.25 })
    playSFX('itemDelete')

    expect(instances.reduce((total, sound) => total + sound.playCount, 0)).toBe(2)
  })
})
