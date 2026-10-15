import { z } from 'zod'
import { PROJECT_FILE_TOOL_CONTRACTS, type ProjectFileToolName } from '../agent-tools/project-files'
import { AgentRefusal } from '../agent-tools/refusal'

export type ProjectFileToolExecutor = (request: {
  name: ProjectFileToolName
  projectId?: string
  input: Record<string, unknown>
  signal?: AbortSignal
}) => Promise<unknown>

export async function executeProjectFileTool(
  name: string,
  raw: unknown,
  execute: ProjectFileToolExecutor,
  signal?: AbortSignal,
) {
  const contract = PROJECT_FILE_TOOL_CONTRACTS.find((tool) => tool.name === name)
  if (!contract)
    throw new AgentRefusal('unknown_file_tool', 'This project file tool is not available.')
  const parsed = z.object(contract.input).strict().safeParse(raw)
  if (!parsed.success)
    throw new AgentRefusal('invalid_file_input', 'Invalid project file input.', {
      issues: parsed.error.issues,
    })
  const { projectId, ...input } = parsed.data as { projectId?: string; [key: string]: unknown }
  if (name === 'upload_project_file') {
    const valid =
      input.phase === 'text'
        ? typeof input.content === 'string'
        : typeof input.size === 'number' &&
          (input.phase === 'prepare' ||
            (typeof input.fileId === 'string' && typeof input.storageKey === 'string'))
    if (!valid)
      throw new AgentRefusal(
        'invalid_file_input',
        'Text uploads need content; prepare needs size; complete needs size, fileId and storageKey.',
      )
  }
  signal?.throwIfAborted()
  return execute({ name: contract.name, projectId, input, signal })
}
