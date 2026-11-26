import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

// Skills whose tools ChatGPT's connection can call. `architect` needs the `architect:run` scope,
// which Pascal's OAuth server does not grant ChatGPT, so the ChatGPT package leaves it out.
export const chatGptSkillNames = ['pascal-3d', 'furniture-fit'] as const

export type PackageEntry = { path: string; source: string }

function skillFiles(root: string, name: string): PackageEntry[] {
  const directory = join(root, 'skills', name)
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter(
      (source) =>
        !relative(directory, source)
          .split('/')
          .some((part) => part.startsWith('.')),
    )
    .map((source) => ({ path: relative(root, source), source }))
}

/**
 * Every file in the ChatGPT directory ZIP, by its path inside the ZIP. The repository root
 * mcp.json is the local server Codex Git-marketplace installs read, so the ZIP takes its root
 * mcp.json from packaging/chatgpt/mcp.json. Claude, Cursor and ClawHub files stay out.
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
