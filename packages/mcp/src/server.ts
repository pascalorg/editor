import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneBridge } from './bridge/scene-bridge'
import { createSceneOperations, type SceneOperations } from './operations'
import { registerPrompts } from './prompts'
import { registerResources } from './resources'
import { createSceneStore } from './storage'
import type {
  SceneEvent,
  SceneEventAppendOptions,
  SceneEventListOptions,
  SceneListOptions,
  SceneMeta,
  SceneMutateOptions,
  SceneSaveOptions,
  SceneStore,
  SceneWithGraph,
} from './storage/types'
import { registerTools } from './tools'
import { registerVisionTools } from './tools/vision'

export type CreatePascalMcpServerOptions = {
  bridge: SceneBridge
  operations?: SceneOperations
  /** Injected `SceneStore`. When omitted, `createSceneStore()` is used lazily. */
  store?: SceneStore
  name?: string
  version?: string
}

export function createPascalMcpServer(opts: CreatePascalMcpServerOptions): McpServer {
  const server = new McpServer({
    name: opts.name ?? 'pascal-mcp',
    version: opts.version ?? '0.1.0',
  })
  const store = opts.store ?? createLazySceneStore()
  const operations = opts.operations ?? createSceneOperations({ bridge: opts.bridge, store })
  registerTools(server, operations)
  registerVisionTools(server, operations)
  registerResources(server, operations)
  registerPrompts(server, operations)
  return server
}

/**
 * Wrap `createSceneStore()` (which is async) behind a synchronous `SceneStore`
 * facade so that `createPascalMcpServer` can remain synchronous. Each method
 * resolves the underlying store on first use and memoizes it afterwards.
 */
function createLazySceneStore(): SceneStore {
  let cached: Promise<SceneStore> | null = null
  const resolve = (): Promise<SceneStore> => {
    if (!cached) cached = createSceneStore()
    return cached
  }
  return {
    get backend(): 'sqlite' {
      return 'sqlite'
    },
    async save(options: SceneSaveOptions): Promise<SceneMeta> {
      const real = await resolve()
      return real.save(options)
    },
    async load(id: string): Promise<SceneWithGraph | null> {
      const real = await resolve()
      return real.load(id)
    },
    async list(options?: SceneListOptions): Promise<SceneMeta[]> {
      const real = await resolve()
      return real.list(options)
    },
    async delete(id: string, options?: SceneMutateOptions): Promise<boolean> {
      const real = await resolve()
      return real.delete(id, options)
    },
    async rename(id: string, newName: string, options?: SceneMutateOptions): Promise<SceneMeta> {
      const real = await resolve()
      return real.rename(id, newName, options)
    },
    async appendSceneEvent(options: SceneEventAppendOptions): Promise<SceneEvent> {
      const real = await resolve()
      if (!real.appendSceneEvent) {
        throw new Error('scene_events_unavailable')
      }
      return real.appendSceneEvent(options)
    },
    async listSceneEvents(id: string, options?: SceneEventListOptions): Promise<SceneEvent[]> {
      const real = await resolve()
      if (!real.listSceneEvents) {
        throw new Error('scene_events_unavailable')
      }
      return real.listSceneEvents(id, options)
    },
  }
}
