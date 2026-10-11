import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import {
  type HostedServiceExecutor,
  recordMade,
  type SceneNodes,
} from '@pascal-app/core/agent-operations'
import { REFERENCE_INPUTS_GUIDE } from '@pascal-app/core/agent-tools'
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
import type { PlanRasterDecoder } from './tools/reference-construction'
import type { PlanReadingHosts } from './tools/shared-tools'
import type { SourceResolver } from './tools/source-resolver'
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
  /** Asks an editor open on the project for a picture (`view_scene`); without it, refused. */
  sceneViews?: SceneViewHost
  /** Answers what a plan's labels name (furnish_from_plan); without it, candidates go by size. */
  planJudge?: PlanReadingHosts['planJudge']
  /** Draws furnish_from_plan's marked plan as an image; without it, it stays an SVG. */
  rasterizeSvg?: PlanReadingHosts['rasterizeSvg']
  /** Turns a raster plan into SVG, paid (vectorize_plan); without it, refused. */
  vectorizePlan?: PlanReadingHosts['vectorizePlan']
  /** What vectorize_plan says a plan costs, for a host that charges otherwise (a plan it holds is free). */
  vectorizePlanPricing?: PlanReadingHosts['vectorizePlanPricing']
  /** Decodes a raster plan's pixels so its walls are traced; without it a raster is for reading. */
  decodeRaster?: PlanRasterDecoder
  /** Resolves a file the host serves `request_upload` for; without it, images are inline only. */
  resolveSource?: SourceResolver
  /** Lines the host adds to what a client reads at connect (the person's own settings). */
  instructions?: string
}

export function createPascalMcpServer(opts: CreatePascalMcpServerOptions): McpServer {
  // A client shows these before the agent's first call.
  const server = new McpServer(
    { name: opts.name ?? 'pascal-mcp-server', version: opts.version ?? version },
    {
      instructions: `Pascal builds and edits 3D buildings; the agent guide is the resource pascal://agent-guide.\n${REFERENCE_INPUTS_GUIDE}${opts.instructions ? `\n${opts.instructions}` : ''}`,
    },
  )
  answerInvalidInputWithCode(server)
  const operations =
    opts.operations ?? createSceneOperations({ bridge: opts.bridge, store: opts.store })
  const executeTool = recordingWhatToolsMake(operations, opts.executeTool)
  if (executeTool) installToolExecutor(server, executeTool)
  const catalog = opts.catalog ? cachedCatalog(opts.catalog) : undefined
  registerTools(server, operations, {
    catalog,
    geometryScripts: opts.geometryScripts,
    sceneViews: opts.sceneViews,
    planJudge: opts.planJudge,
    rasterizeSvg: opts.rasterizeSvg,
    vectorizePlan: opts.vectorizePlan,
    vectorizePlanPricing: opts.vectorizePlanPricing,
    decodeRaster: opts.decodeRaster,
    resolveSource: opts.resolveSource,
  })
  registerVisionTools(server, operations)
  if (opts.services) registerHostedServiceTools(server, opts.services)
  registerResources(server, operations, catalog)
  registerPrompts(server, operations)
  normalizeToolSchemaDialect(server)
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
      if (!(error instanceof McpError && error.code === ErrorCode.InvalidParams)) throw error
      throw new Error(
        JSON.stringify({
          error: error.message.replace(/^MCP error -?\d+: /, ''),
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
        getNodes: () => operations.getNodes() as SceneNodes,
        readSession: () => session.read(),
        keep: (keep) => session.keep(keep),
      },
      input.execute,
    )
  return outer ? (input) => outer({ ...input, execute: () => recording(input) }) : recording
}

function installToolExecutor(server: McpServer, executeTool: PascalMcpToolExecutor): void {
  const registerTool = server.registerTool.bind(server)
  const wrappedRegisterTool: McpServer['registerTool'] = (name, config, callback) => {
    const runtimeCallback = callback as unknown as RuntimeToolCallback
    const registration = registerTool(
      name,
      config,
      wrapToolCallback(name, runtimeCallback, executeTool) as typeof callback,
    )
    return wrapRegisteredTool(registration, name, runtimeCallback, executeTool)
  }
  server.registerTool = wrappedRegisterTool

  const tool = server.tool.bind(server)
  server.tool = ((name: string, ...args: unknown[]) => {
    const callback = args.at(-1)
    if (typeof callback !== 'function') {
      return Reflect.apply(tool, undefined, [name, ...args])
    }
    const runtimeCallback = callback as RuntimeToolCallback
    args[args.length - 1] = wrapToolCallback(name, runtimeCallback, executeTool)
    const registration = Reflect.apply(tool, undefined, [name, ...args]) as RegisteredTool
    return wrapRegisteredTool(registration, name, runtimeCallback, executeTool)
  }) as McpServer['tool']
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
  return (args.at(-1) as { signal: AbortSignal }).signal
}
