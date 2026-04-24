// TODO: auth — every call in this module currently runs unauthenticated.
// v0.1 is scoped to local-first use on a developer machine. A hosted editor
// should pass request-scoped user context through this factory before exposing
// these routes publicly.

import type { SceneStore } from '@pascal-app/mcp/storage'

/**
 * Per-process singleton. The factory is async because backend modules are
 * dynamically imported — we cache the in-flight promise so concurrent calls
 * during a cold start share a single instantiation.
 */
let cached: Promise<SceneStore> | null = null

export function getSceneStore(): Promise<SceneStore> {
  if (!cached) {
    cached = (async () => {
      const mod = (await import('@pascal-app/mcp/storage')) as {
        createSceneStore: (env?: NodeJS.ProcessEnv) => Promise<SceneStore>
      }
      return mod.createSceneStore(process.env)
    })()
  }
  return cached
}

/**
 * Test-only helper to reset the cached singleton. Not exported for production
 * callers.
 */
export function __resetSceneStoreForTests(): void {
  cached = null
}
