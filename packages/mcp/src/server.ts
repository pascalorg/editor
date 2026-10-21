import {
  McpServer,
  ProtocolError,
  ProtocolErrorCode,
  type RegisteredTool,
  type ServerContext,
} from '@modelcontextprotocol/server'
import {
  type HostedServiceExecutor,
  type ProjectFileToolExecutor,
  recordMade,
  type SceneNodes,
} from '@pascal-app/core/agent-operations'
import { untracked } from '@pascal-app/core/runtime'
import type { SceneBridge } from './bridge/scene-bridge'
import { createSceneOperations, type SceneOperations } from './operations'
import { registerPrompts } from './prompts'
import { registerResources } from './resources'
import type { SceneStore } from './storage/types'
import { registerTools } from './tools'
import type { GeometryScriptHost } from './tools/add-object'
import { type AssetCatalog, cachedCatalog } from './tools/asset-catalog'
import { registerHostedServiceTools } from './tools/hosted-services'
import { normalizeToolSchemaDialect } from './tools/normalize-schema-dialect'
import { registerProjectFileTools } from './tools/project-files'
import { answerRetiredTools } from './tools/retired-tools'
import type { PlanReadingHosts } from './tools/shared-tools'
import type { SceneViewHost } from './tools/view-scene'
import { registerVisionTools } from './tools/vision'
import { version } from './version'

export type PascalMcpToolExecutor = <Result>(input: {
  name: string
  /** The call's parsed arguments; undefined for a tool without inputs. */
  arguments: unknown
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
  /**
   * Wrap every regular tool handler, including callback updates.
   * Tool renames fail closed because the SDK registration lifecycle cannot safely rename twice.
   * Experimental task-based tool registrations are outside this hook.
   */
  executeTool?: PascalMcpToolExecutor
  /**
   * The items search_assets, place_items and furnish_room draw from, read once per server. The
   * hosted app passes its published library; without it, a small built-in list.
   */
  catalog?: AssetCatalog
  /** Runs and stores `add_object` modules; without it the tool answers `scripts_unavailable`. */
  geometryScripts?: GeometryScriptHost
  /** Optional authenticated hosted services; local scene tools remain usable without them. */
  services?: HostedServiceExecutor
  /** Authenticated project file catalog; absent for a local scene without hosted files. */
  files?: ProjectFileToolExecutor
  /** Asks an editor open on the project for a picture (`view_scene`); without it, refused. */
  sceneViews?: SceneViewHost
  /** Reads catalog items' pictures and surfaces before view_assets and paint. */
  assetViews?: PlanReadingHosts['assetViews']
  /** Lines the host adds to what a client reads at connect (the person's own settings). */
  instructions?: string
}

export function createPascalMcpServer(opts: CreatePascalMcpServerOptions): McpServer {
  // A client shows these before the agent's first call.
  const server = new McpServer(
    { name: opts.name ?? 'pascal-mcp-server', version: opts.version ?? version },
    {
      instructions: `Pascal builds and edits 3D buildings; the agent guide is the resource pascal://agent-guide.${opts.instructions ? `\n${opts.instructions}` : ''}`,
    },
  )
  answerInvalidInputWithCode(server)
  const operations =
    opts.operations ?? createSceneOperations({ bridge: opts.bridge, store: opts.store })
  const executeTool = recordingWhatToolsMake(operations, opts.executeTool)
  if (executeTool) installToolExecutor(server, executeTool)
  installSceneScope(server, operations)
  const catalog = opts.catalog ? cachedCatalog(opts.catalog) : undefined
  registerTools(server, operations, {
    catalog,
    geometryScripts: opts.geometryScripts,
    sceneViews: opts.sceneViews,
    assetViews: opts.assetViews,
  })
  registerVisionTools(server, operations)
  if (opts.services) registerHostedServiceTools(server, opts.services)
  if (opts.files) registerProjectFileTools(server, opts.files)
  registerResources(server, operations, catalog)
  registerPrompts(server, operations)
  normalizeToolSchemaDialect(server)
  answerRetiredTools(server)
  return server
}

/**
 * Arguments a tool's schema rejects come back with the code `invalid_input`, as every other refusal
 * names its code and as the chat answers them: the SDK's own answer is a bare message. The SDK
 * checks the arguments in its server's validateToolInput and turns what it throws into the tool's
 * error text, so a JSON message carries the code; `server-invalid-input.test` fails if an SDK upgrade
 * moves that check.
 */
function answerInvalidInputWithCode(server: McpServer): void {
  const sdk = server as unknown as {
    validateToolInput(tool: unknown, args: unknown, name: string): Promise<unknown>
  }
  const validate = sdk.validateToolInput.bind(server)
  sdk.validateToolInput = async (tool, args, name) => {
    try {
      return await validate(tool, args, name)
    } catch (error) {
      if (!(error instanceof ProtocolError && error.code === ProtocolErrorCode.InvalidParams))
        throw error
      throw new Error(
        JSON.stringify({
          error: error.message,
          code: 'invalid_input',
        }),
      )
    }
  }
}

/**
 * Inside the host's executor, so that what a call made is in the session by the time the host
 * saves it: every tool that writes, however it writes, leaves what it created with the agent's
 * session, and the first call of any kind begins it.
 */
function recordingWhatToolsMake(
  operations: SceneOperations,
  outer: PascalMcpToolExecutor | undefined,
): PascalMcpToolExecutor | undefined {
  const session = operations.agentSession
  if (!session) return outer
  const recording: PascalMcpToolExecutor = (input) =>
    recordMade(
      {
        // What the tool made is bookkeeping, not what it read: the scene as stored.
        getNodes: () => untracked(operations.getNodes()) as SceneNodes,
        readSession: () => session.read(),
        keep: (keep) => session.keep(keep),
      },
      input.execute,
    )
  return outer ? (input) => outer({ ...input, execute: () => recording(input) }) : recording
}

/**
 * Every handler starts in the scene's scope (`SceneOperations.runInScene`): ids it mints and
 * schema defaults it fills before its first await come from the scene's allocator, so a detached
 * scene recomputed from the same snapshot and effect mints the same ones. Work after an await
 * re-enters the scope itself (add_object, add_column).
 */
function installSceneScope(server: McpServer, operations: SceneOperations): void {
  const runInScene = operations.runInScene?.bind(operations)
  if (!runInScene) return
  const registerTool = server.registerTool.bind(server) as (
    name: string,
    config: unknown,
    callback: RuntimeToolCallback,
  ) => RegisteredTool
  server.registerTool = ((name: string, config: unknown, callback: RuntimeToolCallback) =>
    registerTool(name, config, (...args: unknown[]) =>
      runInScene(() => Reflect.apply(callback, undefined, args)),
    )) as McpServer['registerTool']
}

function installToolExecutor(server: McpServer, executeTool: PascalMcpToolExecutor): void {
  const registerTool = server.registerTool.bind(server) as (
    name: string,
    config: unknown,
    callback: RuntimeToolCallback,
  ) => RegisteredTool
  server.registerTool = ((name: string, config: unknown, callback: RuntimeToolCallback) => {
    const registration = registerTool(name, config, wrapToolCallback(name, callback, executeTool))
    return wrapRegisteredTool(registration, name, callback, executeTool)
  }) as McpServer['registerTool']
}

type RuntimeToolCallback = (...args: unknown[]) => unknown

function wrapToolCallback(
  name: string,
  callback: RuntimeToolCallback,
  executeTool: PascalMcpToolExecutor,
): RuntimeToolCallback {
  return (...args) =>
    executeTool({
      name,
      arguments: args.length > 1 ? args[0] : undefined,
      signal: toolRequestSignal(args),
      execute: () => Promise.resolve(Reflect.apply(callback, undefined, args)),
    })
}

function wrapRegisteredTool(
  registration: RegisteredTool,
  initialName: string,
  initialCallback: RuntimeToolCallback,
  executeTool: PascalMcpToolExecutor,
): RegisteredTool {
  let currentCallback = initialCallback
  const update = registration.update.bind(registration) as (
    updates: Record<string, unknown>,
  ) => void
  registration.update = ((updates: Record<string, unknown>) => {
    if (typeof updates.name === 'string') {
      throw new Error('MCP tool renaming is unsupported when executeTool is configured')
    }
    const callbackUpdate = updates.callback
    if (typeof callbackUpdate === 'function') {
      currentCallback = callbackUpdate as RuntimeToolCallback
    }
    update({
      ...updates,
      ...(typeof callbackUpdate === 'function'
        ? { callback: wrapToolCallback(initialName, currentCallback, executeTool) }
        : {}),
    })
  }) as RegisteredTool['update']
  return registration
}

function toolRequestSignal(args: readonly unknown[]): AbortSignal {
  return (args.at(-1) as ServerContext).mcpReq.signal
}
