import type { AnyNode, Collection } from '../schema'

export type SceneNodes = Readonly<Record<string, AnyNode>>

/** What a surface knows beyond the scene: the chat knows the floor a person is viewing. */
export type AgentContext = { activeLevelId: string | null }

/** Edits an operation asks for; each surface applies them its own way, in one undo step. */
export type SceneChanges = {
  create?: { node: AnyNode; parentId?: string }[]
  update?: { id: string; data: Partial<AnyNode> }[]
  /** Ids to remove; as with the editor's Delete, each goes with everything under it. */
  delete?: string[]
  /** Collection records to write by id; `null` removes one. */
  collections?: Record<string, Collection | null>
}

export type AgentOperationOutcome = { result: Record<string, unknown>; changes?: SceneChanges }

/**
 * One agent tool's behaviour, shared by every surface: plan from the scene, or refuse. Input is
 * what the tool's contract parses; `never` by default so any operation fits a registry.
 */
export type AgentOperation<Input = never> = (
  nodes: SceneNodes,
  input: Input,
  context: AgentContext,
) => AgentOperationOutcome
