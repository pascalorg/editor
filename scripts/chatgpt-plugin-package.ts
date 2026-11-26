import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

// The only skill the ChatGPT directory listing ships. `architect` needs the `architect:run` scope,
// which Pascal's OAuth server does not grant ChatGPT, and furniture fit is not promoted in
// directory listings.
export const chatGptSkillNames = ['pascal-3d'] as const

export type PackageEntry = { path: string; source: string }

// ZIP entry names always use `/`, whatever the platform's path separator.
const zipPath = (from: string, to: string) => relative(from, to).replaceAll('\\', '/')

function skillFiles(root: string, name: string): PackageEntry[] {
  const directory = join(root, 'skills', name)
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter(
      (source) =>
        !zipPath(directory, source)
          .split('/')
          .some((part) => part.startsWith('.')),
    )
    .map((source) => ({ path: zipPath(root, source), source }))
}

/**
 * Every file in the ChatGPT directory ZIP, by its path inside the ZIP. The repository root
 * mcp.json is the local server Codex Git-marketplace installs read, so the ZIP takes its root
 * mcp.json from packaging/chatgpt/mcp.json. Claude, Cursor and ClawHub files and other skills stay out.
 */
export function chatGptPackageEntries(root: string): PackageEntry[] {
  const manifest = JSON.parse(readFileSync(join(root, 'plugin.json'), 'utf8')) as {
    extensions?: { 'com.openai'?: { interface?: Record<string, unknown> } }
  }
  const listing = manifest.extensions?.['com.openai']?.interface ?? {}
  const icons = ['composerIcon', 'logo']
    .map((field) => listing[field])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.replace(/^\.\//u, ''))

  return [
    { path: 'plugin.json', source: join(root, 'plugin.json') },
    { path: 'mcp.json', source: join(root, 'packaging', 'chatgpt', 'mcp.json') },
    { path: 'LICENSE', source: join(root, 'LICENSE') },
    ...[...new Set(icons)].map((path) => ({ path, source: join(root, path) })),
    ...chatGptSkillNames.flatMap((name) => skillFiles(root, name)),
  ].toSorted((a, b) => a.path.localeCompare(b.path))
}
