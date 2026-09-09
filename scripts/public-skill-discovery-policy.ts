import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

export type SkillDiscoveryEntry = {
  path: string
  content: string
}

type IntendedSkill = {
  name: string
  internal: boolean
}

export const intendedSkillDiscovery = new Map<string, IntendedSkill>([
  ['skills/pascal-3d/SKILL.md', { name: 'pascal-3d', internal: false }],
  ['skills/furniture-fit/SKILL.md', { name: 'furniture-fit', internal: false }],
  ['.agents/skills/open-pr/SKILL.md', { name: 'open-pr', internal: true }],
  ['.agents/skills/open-pr2/SKILL.md', { name: 'open-pr2', internal: true }],
  ['.agents/skills/review-architecture/SKILL.md', { name: 'review-architecture', internal: true }],
])

export const intendedPublicSkillNames = [...intendedSkillDiscovery.values()]
  .filter((skill) => !skill.internal)
  .map((skill) => skill.name)
  .sort()

function parseFrontmatter(content: string): string[] | undefined {
  const match = content.match(/^---\n([\s\S]*?)\n---/u)
  return match?.[1]?.split('\n')
}

export function parseSkillDiscoveryMetadata(content: string): {
  name?: string
  internal?: boolean
} {
  const lines = parseFrontmatter(content)
  if (!lines) return {}

  let name: string | undefined
  let internal: boolean | undefined
  let inMetadata = false

  for (const line of lines) {
    const topLevel = line.match(/^([A-Za-z][A-Za-z0-9-]*):(?:\s*(.*))?$/u)
    if (topLevel) {
      inMetadata = topLevel[1] === 'metadata'
      if (topLevel[1] === 'name') name = topLevel[2]?.replace(/^['"]|['"]$/gu, '')
      continue
    }

    if (!inMetadata) continue
    const internalField = line.match(/^ {2}internal:\s*(true|false)\s*$/u)
    if (internalField) internal = internalField[1] === 'true'
  }

  return { name, internal }
}

export function collectSkillDiscoveryEntries(repositoryRoot: string): SkillDiscoveryEntry[] {
  const entries: SkillDiscoveryEntry[] = []

  function collectFrom(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        collectFrom(path)
      } else if (entry.isFile() && entry.name === 'SKILL.md') {
        entries.push({
          path: relative(repositoryRoot, path).replaceAll('\\', '/'),
          content: readFileSync(path, 'utf8'),
        })
      }
    }
  }

  for (const skillsRoot of ['skills', '.agents/skills']) {
    const absoluteRoot = join(repositoryRoot, skillsRoot)
    if (existsSync(absoluteRoot)) collectFrom(absoluteRoot)
  }

  return entries.sort((a, b) => a.path.localeCompare(b.path))
}

export function publicSkillNames(entries: SkillDiscoveryEntry[]): string[] {
  return entries
    .map((entry) => parseSkillDiscoveryMetadata(entry.content))
    .filter((metadata) => metadata.internal !== true && metadata.name)
    .map((metadata) => metadata.name!)
    .sort()
}

export function validatePublicSkillDiscoverySurface(entries: SkillDiscoveryEntry[]): string[] {
  const failures: string[] = []
  const entriesByPath = new Map(entries.map((entry) => [entry.path, entry]))

  for (const entry of entries) {
    if (!intendedSkillDiscovery.has(entry.path)) {
      failures.push(`Unexpected skill in the repository discovery roots: ${entry.path}`)
    }
  }

  for (const [path, intended] of intendedSkillDiscovery) {
    const entry = entriesByPath.get(path)
    if (!entry) {
      failures.push(`Missing intended skill: ${path}`)
      continue
    }

    const metadata = parseSkillDiscoveryMetadata(entry.content)
    if (metadata.name !== intended.name) {
      failures.push(`${path} must declare frontmatter name ${intended.name}`)
    }
    if (intended.internal && metadata.internal !== true) {
      failures.push(`${path} must declare metadata.internal: true`)
    }
    if (!intended.internal && metadata.internal === true) {
      failures.push(`${path} must remain publicly discoverable`)
    }
  }

  const actualPublicSkillNames = publicSkillNames(entries)
  if (actualPublicSkillNames.join('\n') !== intendedPublicSkillNames.join('\n')) {
    failures.push(
      `Public skill discovery must expose exactly ${intendedPublicSkillNames.join(', ')}; found ${actualPublicSkillNames.join(', ') || 'none'}`,
    )
  }

  return failures
}
