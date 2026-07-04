export type AiHarnessRunMode = 'articraft' | 'image-to-3d' | 'primitive' | 'factory'

export type AiHarnessRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export type AiConversationPurpose = 'factory' | 'asset'

export type AiHarnessRunImage = {
  name: string
  type: string
  path: string
}

export type AiHarnessRunIntentRouteEvidence = {
  kind: string
  confidence: number
  reason: string
  previewId?: string
  requiredPack?: {
    id: string
    version?: string
    installed: boolean
    reason?: string
  }
}

export type AiHarnessRun = {
  id: string
  conversationId: string
  mode: AiHarnessRunMode
  status: AiHarnessRunStatus
  prompt: string
  articraftMode?: 'articulated' | 'static'
  maxTurns?: number
  params?: Record<string, unknown>
  context?: unknown
  intentRoute?: AiHarnessRunIntentRouteEvidence
  image?: AiHarnessRunImage
  createdAt: string
  startedAt?: string
  updatedAt: string
  completedAt?: string
  result?: unknown
  error?: string
}

export type AiHarnessRunEventType =
  | 'status'
  | 'progress'
  | 'message'
  | 'tool-call'
  | 'tool-result'
  | 'result'
  | 'error'

export type AiHarnessRunEvent = {
  id: number
  runId: string
  type: AiHarnessRunEventType
  message?: string
  data?: unknown
  createdAt: string
}

export type AiConversation = {
  id: string
  messages: unknown[]
  activeRunIds: string[]
  conversationPurpose?: AiConversationPurpose
  title?: string
  createdAt?: string
  updatedAt: string
}

export type AiConversationSummary = {
  id: string
  title: string
  messageCount: number
  activeRunCount: number
  conversationPurpose?: AiConversationPurpose
  createdAt?: string
  updatedAt: string
}
