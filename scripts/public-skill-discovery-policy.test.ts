import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  collectSkillDiscoveryEntries,
  intendedPublicSkillNames,
  publicSkillNames,
  type SkillDiscoveryEntry,
  validatePublicSkillDiscoverySurface,
} from './public-skill-discovery-policy'

const repositoryRoot = resolve(import.meta.dir, '..')
const canonicalEntries = collectSkillDiscoveryEntries(repositoryRoot)

function replaceEntry(path: string, replace: (content: string) => string): SkillDiscoveryEntry[] {
  return canonicalEntries.map((entry) =>
    entry.path === path ? { ...entry, content: replace(entry.content) } : entry,
  )
}

describe('public skill discovery policy', () => {
  test('exposes exactly the two product skills', () => {
    expect(validatePublicSkillDiscoverySurface(canonicalEntries)).toEqual([])
    expect(publicSkillNames(canonicalEntries)).toEqual(intendedPublicSkillNames)
  })

  test.each([
    '.agents/skills/open-pr/SKILL.md',
    '.agents/skills/open-pr2/SKILL.md',
    '.agents/skills/review-architecture/SKILL.md',
  ])('requires %s to remain internal', (path) => {
    const entries = replaceEntry(path, (content) => content.replace('  internal: true\n', ''))
    expect(validatePublicSkillDiscoverySurface(entries)).toContain(
      `${path} must declare metadata.internal: true`,
    )
  })

  test('rejects an explicit false value on a maintainer skill', () => {
    const path = '.agents/skills/open-pr/SKILL.md'
    const entries = replaceEntry(path, (content) =>
      content.replace('  internal: true', '  internal: false'),
    )
    expect(validatePublicSkillDiscoverySurface(entries)).toContain(
      `${path} must declare metadata.internal: true`,
    )
  })

  test('rejects hiding a product skill', () => {
    const path = 'skills/pascal-3d/SKILL.md'
    const entries = replaceEntry(path, (content) =>
      content.replace('metadata:\n', 'metadata:\n  internal: true\n'),
    )
    const failures = validatePublicSkillDiscoverySurface(entries)
    expect(failures).toContain(`${path} must remain publicly discoverable`)
    expect(
      failures.some((failure) => failure.startsWith('Public skill discovery must expose')),
    ).toBe(true)
  })

  test('rejects an unexpected discoverable skill', () => {
    const entries = [
      ...canonicalEntries,
      {
        path: 'skills/unreviewed/SKILL.md',
        content: '---\nname: unreviewed\ndescription: fixture\n---\n',
      },
    ]
    const failures = validatePublicSkillDiscoverySurface(entries)
    expect(failures).toContain(
      'Unexpected skill in the repository discovery roots: skills/unreviewed/SKILL.md',
    )
    expect(failures).toContain(
      `Public skill discovery must expose exactly ${intendedPublicSkillNames.join(', ')}; found ${[...intendedPublicSkillNames, 'unreviewed'].sort().join(', ')}`,
    )
  })

  test('collects nested skills so discovery cannot bypass the policy', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pascal-skill-discovery-'))
    try {
      const nestedSkillRoot = join(fixtureRoot, 'skills', 'nested', 'unreviewed')
      mkdirSync(nestedSkillRoot, { recursive: true })
      writeFileSync(
        join(nestedSkillRoot, 'SKILL.md'),
        '---\nname: nested-unreviewed\ndescription: fixture\n---\n',
      )
      expect(collectSkillDiscoveryEntries(fixtureRoot).map((entry) => entry.path)).toEqual([
        'skills/nested/unreviewed/SKILL.md',
      ])
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })

  test('rejects a frontmatter name that differs from its intended skill', () => {
    const path = 'skills/furniture-fit/SKILL.md'
    const entries = replaceEntry(path, (content) =>
      content.replace('name: furniture-fit', 'name: furniture-placement'),
    )
    expect(validatePublicSkillDiscoverySurface(entries)).toContain(
      `${path} must declare frontmatter name furniture-fit`,
    )
  })
})
