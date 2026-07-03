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
  repairRounds: number
  remainingIssueCount: number
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
  executionSteps?: Array<{
    phase: 'structure' | 'openings' | 'furnishing' | 'verification'
    status: 'completed' | 'failed'
    label: string
  }>
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
