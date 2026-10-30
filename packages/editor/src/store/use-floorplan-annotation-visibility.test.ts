import { afterEach, describe, expect, test } from 'bun:test'

const STORAGE_KEY = 'pascal-floorplan-annotation-visibility'
const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
afterEach(() => {
  if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow)
  else Reflect.deleteProperty(globalThis, 'window')
})

/** A browser's localStorage, seeded with what an earlier session saved. */
function stubStorage(state?: Record<string, unknown>) {
  const values = new Map<string, string>(
    state ? [[STORAGE_KEY, JSON.stringify({ state, version: 0 })]] : [],
  )
  const localStorage: Partial<Storage> = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage } })
  return { read: () => JSON.parse(values.get(STORAGE_KEY) ?? 'null')?.state }
}

let fresh = 0
async function loadStore() {
  const { default: store } = await import(
    `./use-floorplan-annotation-visibility.ts?load=${++fresh}`
  )
  return store as typeof import('./use-floorplan-annotation-visibility').default
}

describe('Display dimension preferences', () => {
  test('a first visit shows dimensions and measures walls to both faces', async () => {
    stubStorage()
    const store = await loadStore()
    await store.persist.rehydrate()

    expect(store.getState().showDimensions).toBe(true)
    expect(store.getState().wallDimensionFaces).toBe('both')
  })

  test('a stale saved choice, from the retired Wall dimensions option, opens on Both', async () => {
    stubStorage({ wallDimensionReference: 'stud-faces', wallDimensionFaces: 'centerline' })
    const store = await loadStore()
    await store.persist.rehydrate()

    expect(store.getState().wallDimensionFaces).toBe('both')
    expect(store.getState()).not.toHaveProperty('wallDimensionReference')
  })

  test('Dimensions and Measure walls come back after a reload', async () => {
    const storage = stubStorage()
    const firstSession = await loadStore()
    await firstSession.persist.rehydrate()
    firstSession.getState().setShowDimensions(false)
    firstSession.getState().setWallDimensionFaces('interior')
    expect(storage.read()).toMatchObject({ showDimensions: false, wallDimensionFaces: 'interior' })

    const nextSession = await loadStore()
    await nextSession.persist.rehydrate()
    expect(nextSession.getState().showDimensions).toBe(false)
    expect(nextSession.getState().wallDimensionFaces).toBe('interior')
  })
})
