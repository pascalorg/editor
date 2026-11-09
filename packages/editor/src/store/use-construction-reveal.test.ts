import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import type { AnyNodeDefinition } from '@pascal-app/core'
import { BaseNode, loadPlugin, nodeRegistry, nodeType, objectId, useScene } from '@pascal-app/core'
import { ANIMATION_SPEEDS } from '@pascal-app/viewer'
import { createJSONStorage } from 'zustand/middleware'
import useConstructionReveal, {
  CONSTRUCTION_REVEAL_LEVELS,
  CONSTRUCTION_REVEAL_STORAGE_KEY,
  FRAMING_KIND,
  getConstructionRevealLevel,
  isFramingAvailable,
  resolveConstructionLevel,
} from './use-construction-reveal'

function memoryStorage() {
  const items = new Map<string, string>()
  return {
    items,
    storage: createJSONStorage(() => ({
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key),
    })),
  }
}

afterEach(() => {
  useConstructionReveal.setState({ level: 'full', chosen: false, speed: 1 })
})

describe('the construction animation preference', () => {
  test('starts at full, with no choice of the person’s own, and offers four levels', () => {
    expect(useConstructionReveal.getState().level).toBe('full')
    expect(useConstructionReveal.getState().chosen).toBe(false)
    expect(CONSTRUCTION_REVEAL_LEVELS).toEqual(['off', 'simple', 'full', 'framing'])
  })

  test('persists the chosen level and the speed under its own key', () => {
    const { items, storage } = memoryStorage()
    useConstructionReveal.persist.setOptions({ storage })
    useConstructionReveal.getState().setLevel('simple')
    expect(JSON.parse(items.get(CONSTRUCTION_REVEAL_STORAGE_KEY)!).state).toEqual({
      level: 'simple',
      chosen: true,
      speed: 1,
    })
    expect(CONSTRUCTION_REVEAL_STORAGE_KEY).not.toBe('pascal-audio-settings')
  })

  test('restores a saved level, and an unknown one falls back to full', async () => {
    const { items, storage } = memoryStorage()
    useConstructionReveal.persist.setOptions({ storage })
    items.set(CONSTRUCTION_REVEAL_STORAGE_KEY, JSON.stringify({ state: { level: 'off' } }))
    await useConstructionReveal.persist.rehydrate()
    expect(useConstructionReveal.getState().level).toBe('off')

    items.set(CONSTRUCTION_REVEAL_STORAGE_KEY, JSON.stringify({ state: { level: 'cinematic' } }))
    await useConstructionReveal.persist.rehydrate()
    expect(useConstructionReveal.getState().level).toBe('full')
  })
})

describe('the animation speed preference', () => {
  test('starts at ×1', () => {
    expect(useConstructionReveal.getState().speed).toBe(1)
  })

  test.each([...ANIMATION_SPEEDS])('×%d persists and reloads', async (speed) => {
    const { items, storage } = memoryStorage()
    useConstructionReveal.persist.setOptions({ storage })
    useConstructionReveal.getState().setSpeed(speed)
    const saved = items.get(CONSTRUCTION_REVEAL_STORAGE_KEY)!
    expect(JSON.parse(saved).state.speed).toBe(speed)
    // A new page: the store starts from its defaults and reads what was saved.
    useConstructionReveal.setState({ speed: 1 })
    items.set(CONSTRUCTION_REVEAL_STORAGE_KEY, saved)
    await useConstructionReveal.persist.rehydrate()
    expect(useConstructionReveal.getState().speed).toBe(speed)
  })

  test('a person saved before the setting is at ×1, and a stray value snaps to a step', async () => {
    const { items, storage } = memoryStorage()
    useConstructionReveal.persist.setOptions({ storage })
    items.set(CONSTRUCTION_REVEAL_STORAGE_KEY, JSON.stringify({ state: { level: 'full' } }))
    await useConstructionReveal.persist.rehydrate()
    expect(useConstructionReveal.getState().speed).toBe(1)
    items.set(CONSTRUCTION_REVEAL_STORAGE_KEY, JSON.stringify({ state: { speed: 1.6 } }))
    await useConstructionReveal.persist.rehydrate()
    expect(useConstructionReveal.getState().speed).toBe(1.5)
    items.set(CONSTRUCTION_REVEAL_STORAGE_KEY, JSON.stringify({ state: { speed: 'fast' } }))
    await useConstructionReveal.persist.rehydrate()
    expect(useConstructionReveal.getState().speed).toBe(1)
  })
})

describe('the level that plays follows the project', () => {
  const none = { level: 'full', chosen: false } as const

  test('with no choice of the person’s own: Framing with the framing plugin, Full without', () => {
    expect(resolveConstructionLevel(none, true)).toBe('framing')
    expect(resolveConstructionLevel(none, false)).toBe('full')
  })

  test('a choice is kept while the plugin stays installed', () => {
    for (const level of CONSTRUCTION_REVEAL_LEVELS)
      expect(resolveConstructionLevel({ level, chosen: true }, true)).toBe(level)
  })

  test('without the plugin Framing falls back to Full; every other choice stays', () => {
    expect(resolveConstructionLevel({ level: 'framing', chosen: true }, false)).toBe('full')
    expect(resolveConstructionLevel({ level: 'off', chosen: true }, false)).toBe('off')
    expect(resolveConstructionLevel({ level: 'simple', chosen: true }, false)).toBe('simple')
    // The saved choice is not erased: the plugin coming back brings Framing back.
    expect(resolveConstructionLevel({ level: 'framing', chosen: true }, true)).toBe('framing')
  })

  test('a level saved before the default followed the project is a choice', async () => {
    const { items, storage } = memoryStorage()
    useConstructionReveal.persist.setOptions({ storage })
    items.set(CONSTRUCTION_REVEAL_STORAGE_KEY, JSON.stringify({ state: { level: 'full' } }))
    await useConstructionReveal.persist.rehydrate()
    expect(useConstructionReveal.getState().chosen).toBe(true)
    items.set(CONSTRUCTION_REVEAL_STORAGE_KEY, JSON.stringify({ state: {} }))
    await useConstructionReveal.persist.rehydrate()
    expect(useConstructionReveal.getState().chosen).toBe(false)
  })
})

describe('the framing plugin of a project', () => {
  const framing = {
    kind: FRAMING_KIND,
    schemaVersion: 1,
    schema: BaseNode.extend({ id: objectId('framing'), type: nodeType(FRAMING_KIND) }),
    category: 'structure',
    defaults: () => ({}),
    capabilities: {},
    geometry: () => null,
  } as unknown as AnyNodeDefinition
  let restore: () => void = () => {}
  const wasInstalled = useScene.getState().installedPlugins

  beforeAll(async () => {
    restore = nodeRegistry._snapshot()
    nodeRegistry._reset()
    await loadPlugin({ id: 'fixture:framing', apiVersion: 1, nodes: [framing] })
  })
  afterAll(() => {
    restore()
    useScene.setState({ installedPlugins: wasInstalled })
  })

  test('is available where the plugin that carries the kind is installed', () => {
    expect(isFramingAvailable([])).toBe(false)
    expect(isFramingAvailable(['fixture:other'])).toBe(false)
    expect(isFramingAvailable(['fixture:framing'])).toBe(true)
  })

  test('is not available where no loaded plugin carries the kind at all', () => {
    const snapshot = nodeRegistry._snapshot()
    nodeRegistry._reset()
    expect(isFramingAvailable(['fixture:framing'])).toBe(false)
    snapshot()
  })

  test('the level that plays is read from the open project', () => {
    useScene.setState({ installedPlugins: [] })
    expect(getConstructionRevealLevel()).toBe('full')
    useScene.setState({ installedPlugins: ['fixture:framing'] })
    expect(getConstructionRevealLevel()).toBe('framing')
    useConstructionReveal.getState().setLevel('full')
    expect(getConstructionRevealLevel()).toBe('full')
  })
})
