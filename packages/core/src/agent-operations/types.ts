import type { AnyNode, AssetInput, Collection, SceneMaterial, SceneMaterialId } from '../schema'
import type { SessionKeep, SessionRecord } from './scene-checkpoint'

export type SceneNodes = Readonly<Record<string, AnyNode>>

/**
 * What a surface knows beyond the scene: the chat knows the floor a person is viewing; a host
 * passes the agent's session so far (the moments it named, what it made), which verify_scene
 * compares the scene with. A host with an item library passes it as `catalog` (the chat and the
 * hosted MCP: the published library; the standalone MCP: its built-in list), resolved before the
 * call, as the operations are sync.
 */
export type AgentContext = {
  activeLevelId: string | null
  /** Opaque here: its measure is the measure module's (scene-measure), which reads it. */
  checkpoint?: { name: string; measure: unknown }
  /** The agent's session so far. The host keeps it where its sessions live; it is never scene data. */
  session?: SessionRecord
  catalog?: readonly AssetInput[]
  /** Absent when the host cannot author native scene materials. */
  materials?: Readonly<Record<SceneMaterialId, SceneMaterial>>
  /**
   * A host's fast judge's answers to an operation's questions, asked before the call as the
   * catalog is fetched (furnish_from_plan: what each plan label names), by question id.
   */
  planAnswers?: Readonly<Record<string, { choice: string; sure: number } | null>>
  /**
   * A raster plan as the host's vectoriser drew it (vectorize_plan), fetched before the call as
   * the catalog is: its SVG, or why there is none. `cost` is the host's word for what it paid.
   */
  planVector?: {
    guideId: string
    svg?: string
    model?: string
    cost?: string
    error?: string
    /** The host refused to vectorise this plan, with its own code, before any spend. */
    refusal?: { code: string; message: string }
  }
}

/** Edits an operation asks for; each surface applies them its own way, in one undo step. */
export type SceneChanges = {
  /** Material upserts, committed before dependent nodes in the same undo step. */
  materials?: readonly SceneMaterial[]
  create?: { node: AnyNode; parentId?: string }[]
  update?: { id: string; data: Partial<AnyNode> }[]
  /** Ids to remove; as with the editor's Delete, each goes with everything under it. */
  delete?: string[]
  /** Collection records to write by id; `null` removes one. */
  collections?: Record<string, Collection | null>
}

export type AgentOperationOutcome = {
  result: Record<string, unknown>
  /** What the operation asks the host to keep with the session: a checkpoint it took. */
  keep?: SessionKeep
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
