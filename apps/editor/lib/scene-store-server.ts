// TODO: auth — every call in this module currently runs unauthenticated.
// v0.1 skips auth; the factory should eventually receive a user context from
// middleware / a request-scoped session and propagate it into SceneStore.
// Only import this module from server code (route handlers, server components,
// server actions). Importing from client code will leak the Supabase service
// role key into the browser bundle.

import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'

/**
 * Inlined copies of the shared storage contract. The canonical source lives in
 * `packages/mcp/src/storage/types.ts`; re-declared here so the editor only
 * needs the runtime factory from `@pascal-app/mcp/storage` and type-checks
 * without a hard compile-time dependency on the MCP package's source tree.
 *
 * Keep this file in sync whenever the MCP storage types change.
 */
export type SceneId = string

export interface SceneMeta {
  id: SceneId
  name: string
  projectId: string | null
  thumbnailUrl: string | null
  version: number
  createdAt: string
  updatedAt: string
  ownerId: string | null
  sizeBytes: number
  nodeCount: number
}

export interface SceneWithGraph extends SceneMeta {
  graph: SceneGraph
}

export interface SceneSaveOptions {
  id?: SceneId
  name: string
  projectId?: string | null
  ownerId?: string | null
  graph: SceneGraph
  thumbnailUrl?: string | null
  expectedVersion?: number
}

export interface SceneListOptions {
  projectId?: string
  ownerId?: string
  limit?: number
}

export interface SceneMutateOptions {
  expectedVersion?: number
}

export interface SceneStore {
  readonly backend: 'filesystem' | 'supabase'
  save(opts: SceneSaveOptions): Promise<SceneMeta>
  load(id: SceneId): Promise<SceneWithGraph | null>
  list(opts?: SceneListOptions): Promise<SceneMeta[]>
  delete(id: SceneId, opts?: SceneMutateOptions): Promise<boolean>
  rename(id: SceneId, newName: string, opts?: SceneMutateOptions): Promise<SceneMeta>
}

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
