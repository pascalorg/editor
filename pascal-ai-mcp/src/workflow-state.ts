import { Annotation } from '@langchain/langgraph'
import type { ChatInput, WorkflowSession } from './types'

export const WorkflowState = Annotation.Root({
  input: Annotation<ChatInput>,
  session: Annotation<WorkflowSession>,
  reply: Annotation<string>,
  next: Annotation<'evaluate' | 'generate' | 'inspect' | 'modify' | 'finish'>,
})

export type WorkflowGraphState = typeof WorkflowState.State
