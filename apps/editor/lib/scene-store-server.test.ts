import { beforeEach, describe, expect, mock, test } from 'bun:test'

describe('getSceneStore', () => {
  beforeEach(() => {
    mock.module('@pascal-app/mcp/storage', () => {
      let callCount = 0
      return {
        createSceneStore: async (_env?: NodeJS.ProcessEnv) => {
          callCount++
          return {
            backend: 'filesystem' as const,
            __instanceNumber: callCount,
            save: async () => ({}) as never,
            load: async () => null,
            list: async () => [],
            delete: async () => false,
            rename: async () => ({}) as never,
          }
        },
      }
    })
  })

  test('returns the same promise on repeated calls', async () => {
    const mod = await import('./scene-store-server')
    mod.__resetSceneStoreForTests()

    const a = mod.getSceneStore()
    const b = mod.getSceneStore()

    expect(a).toBe(b)
  })

  test('resolves to the same store instance across calls', async () => {
    const mod = await import('./scene-store-server')
    mod.__resetSceneStoreForTests()

    const storeA = await mod.getSceneStore()
    const storeB = await mod.getSceneStore()

    expect(storeA).toBe(storeB)
    // Factory should have been invoked exactly once — asserted indirectly via
    // our mock's instance counter.
    expect((storeA as unknown as { __instanceNumber: number }).__instanceNumber).toBe(1)
    expect((storeB as unknown as { __instanceNumber: number }).__instanceNumber).toBe(1)
  })

  test('reset helper clears the cached singleton', async () => {
    const mod = await import('./scene-store-server')
    mod.__resetSceneStoreForTests()

    const first = await mod.getSceneStore()
    mod.__resetSceneStoreForTests()
    const second = await mod.getSceneStore()

    expect(first).not.toBe(second)
  })
})
