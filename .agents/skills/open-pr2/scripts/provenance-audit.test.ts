import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { auditRepository, formatAuditMarkdown } from './provenance-audit'

const repositories: string[] = []

function git(repository: string, ...args: string[]): string {
  const result = Bun.spawnSync({
    cmd: ['git', '-C', repository, ...args],
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString().trim() || `git ${args.join(' ')} failed`)
  }
  return result.stdout.toString().trim()
}

function repository(): string {
  const path = mkdtempSync(join(tmpdir(), 'open-pr2-provenance-'))
  repositories.push(path)
  git(path, 'init', '-b', 'main')
  git(path, 'config', 'user.name', 'OpenPR2 Test')
  git(path, 'config', 'user.email', 'open-pr2@example.com')
  writeFileSync(join(path, 'base.txt'), 'base\n')
  git(path, 'add', 'base.txt')
  git(path, 'commit', '-m', 'base')
  return path
}

function commitFile(repository: string, path: string, content: string, subject: string): string {
  writeFileSync(join(repository, path), content)
  git(repository, 'add', path)
  git(repository, 'commit', '-m', subject)
  return git(repository, 'rev-parse', 'HEAD')
}

afterEach(() => {
  for (const path of repositories.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

describe('OpenPR2 provenance audit', () => {
  test('keeps first-parent commits and excludes files imported by a merge', () => {
    const path = repository()
    git(path, 'checkout', '-b', 'feature')
    const beforeMerge = commitFile(path, 'feature-before.txt', 'before\n', 'feature before merge')

    git(path, 'checkout', '-b', 'other', 'main')
    commitFile(path, 'imported.txt', 'imported\n', 'other branch feature')

    git(path, 'checkout', 'feature')
    git(path, 'merge', '--no-ff', 'other', '-m', 'merge other branch')
    const afterMerge = commitFile(path, 'feature-after.txt', 'after\n', 'feature after merge')

    const audit = auditRepository({ repository: path, baseRef: 'main', headRef: 'feature' })

    expect(audit.eligibleCommits.map((commit) => commit.sha)).toEqual([beforeMerge, afterMerge])
    expect(audit.excludedMerges).toHaveLength(1)
    expect(audit.branchOnlyFiles).toEqual(['feature-after.txt', 'feature-before.txt'])
    expect(audit.mergeOnlyFiles).toEqual(['imported.txt'])
    expect(audit.overlappingFiles).toEqual([])
    expect(audit.unexplainedFiles).toEqual([])
  })

  test('marks files changed by both a merge and a later branch commit as overlapping', () => {
    const path = repository()
    git(path, 'checkout', '-b', 'feature')
    git(path, 'checkout', '-b', 'other', 'main')
    commitFile(path, 'shared.txt', 'imported\n', 'other branch feature')

    git(path, 'checkout', 'feature')
    git(path, 'merge', '--no-ff', 'other', '-m', 'merge other branch')
    commitFile(path, 'shared.txt', 'imported\nfeature adjustment\n', 'adjust imported feature')

    const audit = auditRepository({ repository: path, baseRef: 'main', headRef: 'feature' })

    expect(audit.branchOnlyFiles).toEqual([])
    expect(audit.mergeOnlyFiles).toEqual([])
    expect(audit.overlappingFiles).toEqual(['shared.txt'])
  })

  test('does not describe eligible changes that were later reverted', () => {
    const path = repository()
    git(path, 'checkout', '-b', 'feature')
    commitFile(path, 'temporary.txt', 'temporary\n', 'add temporary feature')
    git(path, 'rm', 'temporary.txt')
    git(path, 'commit', '-m', 'remove temporary feature')

    const audit = auditRepository({ repository: path, baseRef: 'main', headRef: 'feature' })

    expect(audit.finalFiles).toEqual([])
    expect(audit.revertedEligibleFiles).toEqual(['temporary.txt'])
  })

  test('excludes a branch commit whose patch is already present on the base', () => {
    const path = repository()
    git(path, 'checkout', '-b', 'feature')
    const featureCommit = commitFile(path, 'same.txt', 'same\n', 'add shared change')

    git(path, 'checkout', 'main')
    commitFile(path, 'same.txt', 'same\n', 'land shared change upstream')

    const audit = auditRepository({ repository: path, baseRef: 'main', headRef: 'feature' })

    expect(audit.eligibleCommits).toEqual([])
    expect(audit.patchEquivalentCommits.map((commit) => commit.sha)).toEqual([featureCommit])
    expect(audit.finalFiles).toEqual(['same.txt'])
    expect(audit.patchEquivalentFiles).toEqual(['same.txt'])
    expect(audit.unexplainedFiles).toEqual([])
  })

  test('formats all provenance classifications for the agent audit', () => {
    const path = repository()
    git(path, 'checkout', '-b', 'feature')
    commitFile(path, 'feature.txt', 'feature\n', 'add feature')
    const markdown = formatAuditMarkdown(
      auditRepository({ repository: path, baseRef: 'main', headRef: 'feature' }),
    )

    expect(markdown).toContain('## Eligible first-parent commits')
    expect(markdown).toContain('## Merge commits excluded')
    expect(markdown).toContain('## Branch-only final files')
    expect(markdown).toContain('feature.txt')
  })
})
