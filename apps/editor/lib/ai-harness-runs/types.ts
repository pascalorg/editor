export type AiHarnessRunMode = 'articraft' | 'image-to-3d' | 'primitive'

export type AiHarnessRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export type AiHarnessRunImage = {
  name: string
  type: string
  path: string
}

export type AiHarnessRun = {
  id: string
  conversationId: string
  mode: AiHarnessRunMode
  status: AiHarnessRunStatus
  prompt: string
  articraftMode?: 'articulated' | 'static'
  params?: Record<string, unknown>
  context?: unknown
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
  title?: string
  createdAt?: string
  updatedAt: string
}

export type AiConversationSummary = {
  id: string
  title: string
  messageCount: number
  activeRunCount: number
  createdAt?: string
  updatedAt: string
}
