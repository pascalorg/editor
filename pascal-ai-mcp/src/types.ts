import type { LayoutIntent, LayoutPlan, RoomType } from './layout-plan'
import type { StrategyDecision } from './strategy'

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export type TextContent = { type: 'text'; text: string }
export type ImageContent = {
  type: 'image_url'
  image_url: { url: string; detail?: 'auto' | 'low' | 'high' }
}

export type ChatMessage = {
  role: ChatRole
  content?: string | null | Array<TextContent | ImageContent>
  name?: string
  tool_call_id?: string
  tool_calls?: ToolCall[]
}

export type ToolCall = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export type ChatCompletionMessage = {
  role: 'assistant'
  content?: string | null
  tool_calls?: ToolCall[]
}

export type ChatCompletionResponse = {
  choices: Array<{
    message: ChatCompletionMessage
    finish_reason?: string
  }>
}

export type OpenAiTool = {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
  }
}

export type InformationSource =
  | 'user'
  | 'system_recognition'
  | 'agent_inference'
  | 'default_assumption'
  | 'pending_confirmation'

export type ConfirmationStatus = 'unconfirmed' | 'confirmed' | 'rejected'

export type RequirementFact = {
  key: string
  label: string
  value: string | number | boolean | string[]
  source: InformationSource
  confidence: number
  confirmationStatus: ConfirmationStatus
  evidence?: string
}

export type DesignBrief = {
  existingCondition: RequirementFact[]
  designGoals: RequirementFact[]
  hardConstraints: RequirementFact[]
  assumptions: RequirementFact[]
  uncertainties: RequirementFact[]
  conflicts: Array<{
    key: string
    existingValue: string
    requestedValue: string
    question: string
  }>
}

export type Availability = 'usable' | 'partially_usable' | 'unusable'
export type WorkflowPhase =
  | 'intake'
  | 'clarifying'
  | 'awaiting_confirmation'
  | 'awaiting_modification_confirmation'
  | 'inspecting'
  | 'generating'
  | 'modifying'
  | 'completed'
  | 'completed_with_issues'
  | 'cancelled'
  | 'failed'

// A current-state furniture placement problem, computed deterministically
// from the scene graph (rotated footprints vs room polygons / other items /
// door clearance) — as opposed to `furnitureIssues`, which records historical
// placement-tool events (e.g. furnish_room declining to place an item).
export type FurniturePlacementIssue = {
  kind: 'overlap' | 'out_of_bounds' | 'door_clearance'
  itemId: string
  itemName?: string
  otherItemId?: string
  room?: string
  message: string
}

export type SceneResult = {
  sceneId: string | null
  editorUrl: string | null
  version: number | null
  validation: { valid: boolean; errors: string[] }
  verificationIssues: string[]
  collisions: Array<{ aId: string; bId: string; kind: string }>
  doorlessRooms: string[]
  strayWindows: string[]
  requirementMismatches: string[]
  isolatedBedrooms: string[]
  // Furniture that wasn't placed as intended (overlap, out-of-bounds, catalog
  // miss / not placed). Previously only surfaced in the reply text and not
  // counted anywhere; now structured here and folded into remainingIssueCount.
  furnitureIssues: string[]
  // Deterministic current-state placement check results (see
  // FurniturePlacementIssue). Optional so sessions persisted by older builds
  // still parse.
  furniturePlacement?: FurniturePlacementIssue[]
  repairRounds: number
  remainingIssueCount: number
  // Deterministic scene-executor findings (failed MCP calls, missing host
  // walls, as-built area drift). Observability only: the same underlying
  // problems are re-detected live by collectDiagnostics, so these are NOT
  // folded into remainingIssueCount — that would double-count them.
  executionIssues?: string[]
  // Model API attempts this generate/modify turn actually used (sum over
  // toolTrace phases), so eval reports can assert call budgets per case.
  modelCallsUsed?: number
  // Completion hard-gate failures (§5). Empty array = all gates passed.
  // Absent on sessions persisted by pre-批次D builds. Gate failures overlap
  // with the diagnostics above, so they gate the `completed` phase but are
  // NOT added to remainingIssueCount (that would double-count).
  gateFailures?: string[]
  // layout-metrics quality score for the as-built scene (0-100).
  layoutQuality?: number
  // Deterministic furniture executor tallies, for the ≥90% placement-rate
  // eval assertion. `required` = placed + missing.
  furniture?: { placed: number; required: number }
}

// Per-phase model/tool call trace, recorded while the scene agent runs. This
// exists to make non-convergence diagnosable from an eval report alone: how
// many completions a phase used, the exact tool call sequence (so "which room
// did it get to before hitting the round limit" is answerable), per-tool
// counts, and whether the phase converged or was rescued by a continuation.
export type PhaseToolTrace = {
  phase: string
  modelCalls: number
  toolCalls: Array<{ name: string; ok: boolean; detail?: string }>
  toolCounts: Record<string, number>
  converged: boolean
  continuationAttempts: number
}

export type WorkflowSession = {
  sessionId: string
  sceneId?: string
  inputType: 'text' | 'image'
  phase: WorkflowPhase
  availability: Availability
  brief: DesignBrief
  questions: string[]
  reasons: string[]
  summary: string
  messages: ChatMessage[]
  clarificationRounds: number
  // Cumulative count of model API attempts made across every turn of this
  // session, enforced against config.maxModelCallsPerSession.
  modelCallsTotal?: number
  confirmedAt?: string
  sceneResult?: SceneResult
  pendingModification?: string
  pendingOperation?: 'create' | 'update' | 'delete'
  // Scene ids created by a fresh-build `generate()` attempt that then
  // failed partway through construction. `session.sceneId` gets rolled
  // back so a retry doesn't mistake the half-built wreckage for a real
  // existing project (see `generate()`'s catch block), but the abandoned
  // project itself is left in storage (never auto-deleted) — recorded here
  // purely as an audit trail / for manual cleanup.
  abandonedSceneIds?: string[]
  // Reply language, detected from the user's most recent message each turn
  // (kana→ja, han→zh, otherwise en). Replies render through src/lang/i18n.ts
  // in this language; internal strings (prompts, diagnostics, sceneResult)
  // stay Chinese regardless.
  language?: 'zh' | 'ja' | 'en'
  // Plan-first generation (GENERATION_REDESIGN.md): the confirmed model
  // intent and the validated deterministic plan the scene was built from.
  // Persisted so modify turns can quote the plan as the factual room list
  // and so eval reports can compare plan vs as-built.
  layoutIntent?: LayoutIntent
  layoutPlan?: LayoutPlan
  // Deterministic strategy decision the plan was built under
  // (LAYOUT_STRATEGY_DESIGN.md §2) — persisted for modify turns and eval.
  strategy?: StrategyDecision
  // Authoritative zoneId→RoomType mapping recorded when the deterministic
  // executor builds the plan's rooms. Lets the gates/diagnostics use real
  // types instead of guessing from names — which makes room names
  // language-independent (中/日/英). Name-based classification remains the
  // fallback for modify-path and legacy scenes.
  zoneRoomTypes?: Record<string, RoomType>
  executionSteps?: Array<{
    phase: 'structure' | 'openings' | 'furnishing' | 'verification'
    status: 'completed' | 'failed'
    label: string
  }>
  // Reset at the start of each generate/modify turn; one entry per scene-agent
  // phase (structure, openings, repair round, ...). See PhaseToolTrace.
  toolTrace?: PhaseToolTrace[]
  createdAt: string
  updatedAt: string
}

export type ChatInput = {
  sessionId: string
  message?: string
  imageDataUrl?: string
  sceneId?: string
  action?: 'confirm' | 'cancel'
}

export type ChatResult = {
  sessionId: string
  reply: string
  session: WorkflowSession
}
