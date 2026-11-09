import { expect, test } from 'bun:test'
import {
  executeProjectFileTool,
  type ProjectFileToolExecutor,
} from '@pascal-app/core/agent-operations'

test('file tools validate their upload phases before invoking the authenticated host', async () => {
  const calls: unknown[] = []
  const host: ProjectFileToolExecutor = async (request) => {
    calls.push(request)
    return { saved: true }
  }
  await expect(
    executeProjectFileTool(
      'upload_project_file',
      { phase: 'complete', name: 'File.csv', mimeType: 'text/csv', size: 2 },
      host,
    ),
  ).rejects.toMatchObject({ code: 'invalid_file_input' })
  expect(calls).toHaveLength(0)
  expect(
    await executeProjectFileTool(
      'upload_project_file',
      {
        phase: 'text',
        projectId: 'project_a',
        name: 'File.csv',
        mimeType: 'text/csv',
        content: 'a\n',
      },
      host,
    ),
  ).toEqual({ saved: true })
  expect(calls[0]).toMatchObject({
    name: 'upload_project_file',
    projectId: 'project_a',
    input: { content: 'a\n' },
  })
  await expect(
    executeProjectFileTool('delete_project_file', { fileId: 'asset_a', arbitrary: true }, host),
  ).rejects.toMatchObject({ code: 'invalid_file_input' })
  expect(calls).toHaveLength(1)
})
