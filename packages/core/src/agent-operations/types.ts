import type { AnyNode, AssetInput, Collection } from '../schema'

export type SceneNodes = Readonly<Record<string, AnyNode>>

/**
 * What a surface knows beyond the scene: the chat knows the floor a person is viewing; a host that
 * keeps checkpoints passes the one asked for, and verify_scene compares the scene with it. A host
 * with an item library passes it as `catalog` (the chat and the hosted MCP: the published library;
 * the standalone MCP: its built-in list), resolved before the call, as the operations are sync.
 */
export type AgentContext = {
  activeLevelId: string | null
  /** Opaque here: its measure is the measure module's (scene-measure), which reads it. */
  checkpoint?: { name: string; measure: unknown }
  catalog?: readonly AssetInput[]
}

/** Edits an operation asks for; each surface applies them its own way, in one undo step. */
export type SceneChanges = {
  create?: { node: AnyNode; parentId?: string }[]
  update?: { id: string; data: Partial<AnyNode> }[]
  /** Ids to remove; as with the editor's Delete, each goes with everything under it. */
  delete?: string[]
  /** Collection records to write by id; `null` removes one. */
  collections?: Record<string, Collection | null>
}

export type AgentOperationOutcome = {
  result: Record<string, unknown>
  changes?: SceneChanges
  /**
   * For an edit that depends on construction the host derives from `changes` (rooms re-derived
   * from walls and separators, auto ceilings, floor plates), whose ids an operation cannot know:
   * the host reconciles after `changes`, calls this with the scene it then holds, applies what it
   * returns, reconciles again and answers with its result — one undo step (`applyAgentOutcome`).
   */
  afterReconcile?: (nodes: SceneNodes) => {
    result: Record<string, unknown>
    changes?: SceneChanges
  }
}

/**
 * One agent tool's behaviour, shared by every surface: plan from the scene, or refuse. Input is
 * what the tool's contract parses; `never` by default so any operation fits a registry.
 */
export type AgentOperation<Input = never> = (
  nodes: SceneNodes,
  input: Input,
  context: AgentContext,
) => AgentOperationOutcome

/** Operations by tool name: core's `AGENT_OPERATIONS`, or a plugin's `./agent-operations` export. */
export type AgentOperations = Readonly<Record<string, AgentOperation>>
