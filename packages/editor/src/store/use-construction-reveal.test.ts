import { afterEach, describe, expect, test } from 'bun:test'
import { createJSONStorage } from 'zustand/middleware'
import useConstructionReveal, {
  CONSTRUCTION_REVEAL_LEVELS,
  CONSTRUCTION_REVEAL_STORAGE_KEY,
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
  useConstructionReveal.setState({ level: 'full' })
})

describe('the construction animation preference', () => {
  test('starts at full and offers four levels', () => {
    expect(useConstructionReveal.getState().level).toBe('full')
    expect(CONSTRUCTION_REVEAL_LEVELS).toEqual(['off', 'simple', 'full', 'framing'])
  })

  test('persists the chosen level under its own key', () => {
    const { items, storage } = memoryStorage()
    useConstructionReveal.persist.setOptions({ storage })
    useConstructionReveal.getState().setLevel('simple')
    expect(JSON.parse(items.get(CONSTRUCTION_REVEAL_STORAGE_KEY)!).state).toEqual({
      level: 'simple',
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
