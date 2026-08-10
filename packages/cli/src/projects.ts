import type { EditorState } from './editor-process.js'
import { CliError } from './errors.js'

export interface LocalProject {
  id: string
  name: string
  updatedAt: string
  version: number
  nodeCount: number
}

export async function listLocalProjects(state: EditorState): Promise<LocalProject[]> {
  const response = await fetch(`http://127.0.0.1:${state.port}/api/scenes?limit=500`, {
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) {
    throw new CliError('project_list_failed', `Scene API returned ${response.status}.`)
  }
  const body = (await response.json()) as { scenes?: unknown }
  if (!Array.isArray(body.scenes)) {
    throw new CliError('project_list_failed', 'Scene API returned an invalid project list.')
  }
  return body.scenes.map(parseProject)
}

export function resolveLocalProject(projects: LocalProject[], selector?: string): LocalProject {
  if (!selector) {
    const latest = projects[0]
    if (!latest) throw new CliError('project_not_found', 'No local projects exist yet.')
    return latest
  }

  const query = selector.trim()
  const exactId = projects.find((project) => project.id === query)
  if (exactId) return exactId

  const normalized = query.toLowerCase()
  const exactNames = projects.filter((project) => project.name.toLowerCase() === normalized)
  if (exactNames.length === 1) return exactNames[0]!
  if (exactNames.length > 1) throw ambiguousProject(selector, exactNames)

  const idPrefixes = projects.filter((project) => project.id.startsWith(query))
  if (idPrefixes.length === 1) return idPrefixes[0]!
  if (idPrefixes.length > 1) throw ambiguousProject(selector, idPrefixes)

  throw new CliError('project_not_found', `No local project matches "${selector}".`, {
    selector,
  })
}

export function projectUrl(state: EditorState, project: LocalProject): string {
  return `${state.url}/scene/${encodeURIComponent(project.id)}`
}

function parseProject(value: unknown): LocalProject {
  if (!(typeof value === 'object' && value !== null)) {
    throw new CliError('project_list_failed', 'Scene API returned invalid project metadata.')
  }
  const project = value as Record<string, unknown>
  if (
    typeof project.id !== 'string' ||
    typeof project.name !== 'string' ||
    typeof project.updatedAt !== 'string' ||
    typeof project.version !== 'number' ||
    typeof project.nodeCount !== 'number'
  ) {
    throw new CliError('project_list_failed', 'Scene API returned invalid project metadata.')
  }
  return {
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt,
    version: project.version,
    nodeCount: project.nodeCount,
  }
}

function ambiguousProject(selector: string, matches: LocalProject[]): CliError {
  return new CliError(
    'project_ambiguous',
    `More than one local project matches "${selector}". Use one of these IDs: ${matches.map(({ id }) => id).join(', ')}.`,
    {
      selector,
      matches: matches.map(({ id, name }) => ({ id, name })),
    },
  )
}
