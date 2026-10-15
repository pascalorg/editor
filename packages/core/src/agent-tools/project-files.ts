import { z } from 'zod'

const project = {
  projectId: z
    .string()
    .min(1)
    .max(128)
    .optional()
    .describe('Hosted project ID. Omit to use the active project.'),
}
const file = { ...project, fileId: z.string().min(1).max(128) }
const read = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

export const getProjectAssetsTool = {
  name: 'get_project_assets',
  title: 'List project files',
  description:
    'List and search the project file catalog: user uploads, plugin documents, snapshots, and completed Studio images, materials and videos. Returns file IDs, names, MIME types and download URLs. Threads and messages are not files. Follow nextCursor to retrieve more files.',
  input: {
    ...project,
    type: z.enum(['scan', 'guide', 'image', 'document', 'other']).optional(),
    query: z.string().max(300).optional(),
    cursor: z.string().max(1000).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  },
  annotations: read,
} as const

export const getProjectFileTool = {
  name: 'get_project_file',
  title: 'Read project file',
  description:
    'Get one project file and its download URL by fileId from get_project_assets. Requires membership in the project workspace, including for public projects.',
  input: file,
  annotations: read,
} as const

export const uploadProjectFileTool = {
  name: 'upload_project_file',
  title: 'Upload project file',
  description:
    'Keep a deliverable or reference in the project file catalog. Use phase text with UTF-8 content for CSV, Markdown, JSON and other text files. For binary or large files, phase prepare with size returns a signedUrl: PUT the bytes there, then call phase complete with the same name, mimeType, size, returned fileId and storageKey. Limit 500 MB; SVG is refused. A file is listed only after completion. After a lost text-upload response, list files before retrying to avoid duplicates.',
  input: {
    ...project,
    phase: z.enum(['text', 'prepare', 'complete']),
    name: z.string().trim().min(1).max(400),
    mimeType: z.string().min(1).max(200),
    content: z
      .string()
      .max(2 * 1024 * 1024)
      .optional(),
    size: z
      .number()
      .int()
      .min(0)
      .max(500 * 1024 * 1024)
      .optional(),
    fileId: z
      .string()
      .regex(/^asset_[A-Za-z0-9_-]+$/)
      .optional(),
    storageKey: z.string().max(700).optional(),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
} as const

export const renameProjectFileTool = {
  name: 'rename_project_file',
  title: 'Rename project file',
  description:
    'Rename a file in the project catalog. The file ID and content URL stay stable; a Studio file is also renamed in Studio.',
  input: { ...file, name: z.string().trim().min(1).max(400) },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const

export const deleteProjectFileTool = {
  name: 'delete_project_file',
  title: 'Delete project file',
  description:
    'Remove a file from the project catalog. A Studio file is removed from Studio too. Only do this when the user requests deletion. Existing scene or chat references may still retain the bytes; this is not guaranteed storage erasure.',
  input: file,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const

export const PROJECT_FILE_TOOL_CONTRACTS = [
  getProjectAssetsTool,
  getProjectFileTool,
  uploadProjectFileTool,
  renameProjectFileTool,
  deleteProjectFileTool,
] as const
export type ProjectFileToolName = (typeof PROJECT_FILE_TOOL_CONTRACTS)[number]['name']
