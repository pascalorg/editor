import type { z } from 'zod'

/**
 * MCP tool annotations. Hints for clients and for a host's display, never authorization: a host
 * decides what a tool may do (write scope, retries, approvals) from its own review of the
 * operation, not from what a contract declares about itself.
 */
export type AgentToolAnnotations = {
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

/** The surfaces that register a shared agent tool: the MCP server and the hosted chat. */
export type AgentToolSurface = 'mcp' | 'chat'

/**
 * One agent tool as every surface registers it: the name and description the agent reads, and its
 * input schema. Zod only, so it can be imported where the hosted chat declares its tools.
 */
export type AgentToolContract<Input extends Record<string, z.ZodType> = Record<string, z.ZodType>> =
  {
    name: string
    title: string
    /** True on every surface: what one surface alone does goes in `surfaceNotes`. */
    description: string
    /**
     * What only one surface's agent reads, where the tool behaves differently there (what renders
     * a view, how long a record lasts). A surface registers `surfaceDescription(contract, surface)`.
     */
    surfaceNotes?: Partial<Record<AgentToolSurface, string>>
    input: Input
    annotations?: AgentToolAnnotations
  }

/** The description `surface` registers: the shared text, then that surface's own note. */
export function surfaceDescription(
  contract: Pick<AgentToolContract, 'description' | 'surfaceNotes'>,
  surface: AgentToolSurface,
): string {
  const note = contract.surfaceNotes?.[surface]
  return note ? `${contract.description}\n${note}` : contract.description
}

/**
 * Where a plugin's tool runs. `'operation'`: a pure `AgentOperation` over the scene's nodes,
 * exported from the plugin's `./agent-operations`, so any surface can run it, a server included.
 * `'editor'`: it needs the live editor (a renderer, the plugin's own stores, the browser), so it
 * runs in an editor tab open on the project; a surface without one refuses it or hands it to one.
 */
export type PluginAgentToolPlacement = 'operation' | 'editor'

export type PluginAgentTool = AgentToolContract & {
  runsIn: PluginAgentToolPlacement
  /** The call produces a view (a drawing, a report) the host may open beside the scene. */
  rendersView?: boolean
  /** How long a call may take, in milliseconds; the host clamps it to its own limits. */
  timeoutMs?: number
  /**
   * The plugin asks for this tool in a chat only (it needs the conversation, e.g. it asks the
   * person something). A request the host reviews, not a way around surface parity.
   */
  chatOnly?: boolean
}

/** Knowledge an agent loads on demand: the index shows `name` and `summary`, a load returns `body`. */
export type PluginSkill = { name: string; summary: string; body: string }

/**
 * Everything a plugin contributes to an agent, exported from its `./agent-tools` entry, which,
 * like this module, imports zod and its own dependency-free files only.
 */
export type PluginAgentTools = {
  /** The `Plugin.id` these tools belong to; a host offers them only where the plugin is installed. */
  pluginId: string
  /** The shape of this object. */
  apiVersion: 1
  /**
   * The revision of the plugin's contracts. Bump it whenever a tool's name, input or meaning
   * changes, so a host can pin the exact contracts a run was offered and refuse a stale executor.
   */
  version: string
  tools: readonly PluginAgentTool[]
  skills?: readonly PluginSkill[]
  /** Guidance added to the agent's instructions while the plugin is installed; the host may cap it. */
  instructions?: string
}
