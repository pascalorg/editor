import type { ZodType } from 'zod'
import type { DesignBrief } from '../agent-tools/design-brief'
import type {
  AnyNode,
  AssetInput,
  Collection,
  CompiledGeometryScript,
  SceneMaterial,
  SceneMaterialId,
} from '../schema'
import type { AssetViewFacts } from './asset-views'
import type { SessionKeep, SessionRecord } from './scene-checkpoint'

export type SceneNodes = Readonly<Record<string, AnyNode>>

/**
 * What a surface knows beyond the scene: the chat knows the floor a person is viewing; a host
 * passes the agent's session so far (the moments it named, what it made), which verify_scene
 * compares the scene with. A host with an item library passes it as `catalog` (the chat and the
 * hosted MCP: the published library; the standalone MCP: its built-in list), resolved before the
 * call, as the operations are sync. A host that can store scene materials with the nodes that use
 * them passes the scene's `materials`: paint then checks scene refs against them and keeps a native
 * material as one.
 */
export type AgentContext = {
  activeLevelId: string | null
  /**
   * The schema the host checks a stored node of a kind by, for each kind it checks: a host that
   * validates its plugins' nodes at its own write boundary lends it, so verify_scene reports what
   * the host refuses. For a kind it does not check (undefined), the kind's registered schema, else
   * core's, else none: a kind no schema knows.
   */
  nodeSchema?: (kind: string) => ZodType | undefined
  /** Opaque here: its measure is the measure module's (scene-measure), which reads it. */
  checkpoint?: { name: string; measure: unknown }
  /** The agent's session so far. The host keeps it where its sessions live; it is never scene data. */
  session?: SessionRecord
  catalog?: readonly AssetInput[]
  /**
   * What a host read about catalog items before the call, by item id (`assetViewNeeds` says
   * which): their pictures for view_assets, the names of their paintable surfaces for it and for
   * paint. A host that cannot read them leaves them out.
   */
  assetViews?: Readonly<Record<string, AssetViewFacts>>
  materials?: Readonly<Record<SceneMaterialId, SceneMaterial>>
  /** Modules built by the host before run_batch, indexed by call position. */
  batchObjects?: Readonly<Record<number, BatchedObject>>
  batchCall?: number
  /**
   * The design brief in force on a host that gates furnishing on one: `null` while there is none
   * (placing or making furnishings is refused, `furnishingRefusal`), the brief once written. A
   * host that does not gate leaves it out.
   */
  designBrief?: DesignBrief | null
  /**
   * The person's words of the turn, on a host that has a person (the chat): the source quote of a
   * design brief is checked against it. A host with no person's message (MCP) leaves it out and the
   * quote is not checked.
   */
  requestText?: string
}

/** One add_object call of a batch, built by its host: the compiled module, or why it failed. */
export type BatchedObject =
  | { compiled: CompiledGeometryScript }
  | { failure: { code: string; message: string } }

/** A write's operations in order, as apply_patch and update_node carry them. */
export type NodeWrite =
  | { op: 'create'; node: AnyNode; parentId?: string }
  | { op: 'update'; id: string; data: Record<string, unknown> }
  | { op: 'delete'; id: string }

/** Edits an operation asks for; each surface applies them its own way, in one undo step. */
export type SceneChanges = {
  /** Scene materials to add, written before the nodes that use them. */
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

/** Operations by tool name: core's `AGENT_OPERATIONS`, or a plugin's `./agent-operations` export. */
export type AgentOperations = Readonly<Record<string, AgentOperation>>
