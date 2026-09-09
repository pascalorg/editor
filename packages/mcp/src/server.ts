import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneBridge } from './bridge/scene-bridge'
import { createSceneOperations, type SceneOperations } from './operations'
import { registerPrompts } from './prompts'
import { registerResources } from './resources'
import type { SceneStore } from './storage/types'
import { registerTools } from './tools'
import { registerVisionTools } from './tools/vision'
import { version } from './version'

export type PascalMcpToolExecutor = <Result>(input: {
  name: string
  signal: AbortSignal
  execute: () => Promise<Result>
}) => Promise<Result>

export type CreatePascalMcpServerOptions = {
  bridge: SceneBridge
  operations?: SceneOperations
  /** Required for persistence tools. Hosted apps and CLIs inject their own store. */
  store?: SceneStore
  name?: string
  version?: string
  /** Wrap every tool handler, for example to serialize access to a stateful bridge. */
  executeTool?: PascalMcpToolExecutor
}

export function createPascalMcpServer(opts: CreatePascalMcpServerOptions): McpServer {
  const server = new McpServer({
    name: opts.name ?? 'pascal-mcp-server',
    version: opts.version ?? version,
  })
  if (opts.executeTool) installToolExecutor(server, opts.executeTool)
  const operations =
    opts.operations ?? createSceneOperations({ bridge: opts.bridge, store: opts.store })
  registerTools(server, operations)
  registerVisionTools(server, operations)
  registerResources(server, operations)
  registerPrompts(server, operations)
  return server
}

function installToolExecutor(server: McpServer, executeTool: PascalMcpToolExecutor): void {
  const registerTool = server.registerTool.bind(server)
  const wrappedRegisterTool: McpServer['registerTool'] = (name, config, callback) =>
    registerTool(name, config, ((...args: Parameters<typeof callback>) =>
      executeTool({
        name,
        signal: toolRequestSignal(args),
        execute: () => Promise.resolve(Reflect.apply(callback, undefined, args)),
      })) as typeof callback)
  server.registerTool = wrappedRegisterTool

  const tool = server.tool.bind(server)
  server.tool = ((name: string, ...args: unknown[]) => {
    const callback = args.at(-1)
    if (typeof callback !== 'function') {
      return Reflect.apply(tool, undefined, [name, ...args])
    }
    args[args.length - 1] = (...callbackArgs: unknown[]) =>
      executeTool({
        name,
        signal: toolRequestSignal(callbackArgs),
        execute: () => Promise.resolve(Reflect.apply(callback, undefined, callbackArgs)),
      })
    return Reflect.apply(tool, undefined, [name, ...args])
  }) as McpServer['tool']
}

function toolRequestSignal(args: readonly unknown[]): AbortSignal {
  return (args.at(-1) as { signal: AbortSignal }).signal
}
