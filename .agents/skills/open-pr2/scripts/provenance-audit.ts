export type CommitAudit = {
  sha: string
  shortSha: string
  subject: string
  parents: string[]
  changedFiles: string[]
  patchEquivalent: boolean
}

export type ProvenanceAudit = {
  repository: string
  baseRef: string
  headRef: string
  mergeBase: string
  eligibleCommits: CommitAudit[]
  patchEquivalentCommits: CommitAudit[]
  excludedMerges: CommitAudit[]
  finalFiles: string[]
  branchOnlyFiles: string[]
  mergeOnlyFiles: string[]
  patchEquivalentFiles: string[]
  overlappingFiles: string[]
  unexplainedFiles: string[]
  revertedEligibleFiles: string[]
}

type AuditOptions = {
  repository: string
  baseRef: string
  headRef?: string
}

function runGit(repository: string, args: string[]): string {
  const result = Bun.spawnSync({
    cmd: ['git', '-C', repository, ...args],
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = result.stdout.toString()
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim()
    throw new Error(`git ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`)
  }
  return stdout
}

function lines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function nulSeparated(value: string): string[] {
  return value.split('\0').filter(Boolean).sort()
}

function changedFiles(repository: string, from: string | null, to: string): string[] {
  if (!from) {
    return nulSeparated(
      runGit(repository, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z', to]),
    )
  }
  return nulSeparated(runGit(repository, ['diff', '--name-only', '-z', from, to]))
}

function intersection(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((value) => right.has(value)).sort()
}

function difference(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((value) => !right.has(value)).sort()
}

function commitAudit(
  repository: string,
  sha: string,
  patchEquivalentShas: Set<string>,
): CommitAudit {
  const parents = lines(runGit(repository, ['show', '-s', '--format=%P', sha]).trim().replaceAll(' ', '\n'))
  const subject = runGit(repository, ['show', '-s', '--format=%s', sha]).trim()
  return {
    sha,
    shortSha: sha.slice(0, 10),
    subject,
    parents,
    changedFiles: changedFiles(repository, parents[0] ?? null, sha),
    patchEquivalent: patchEquivalentShas.has(sha),
  }
}

export function auditRepository(options: AuditOptions): ProvenanceAudit {
  const { repository, baseRef, headRef = 'HEAD' } = options
  runGit(repository, ['rev-parse', '--verify', baseRef])
  runGit(repository, ['rev-parse', '--verify', headRef])

  const mergeBases = lines(runGit(repository, ['merge-base', '--all', baseRef, headRef]))
  if (mergeBases.length !== 1) {
    throw new Error(
      `expected exactly one merge base for ${baseRef} and ${headRef}; found ${mergeBases.length}`,
    )
  }

  const patchEquivalentShas = new Set(
    lines(runGit(repository, ['cherry', baseRef, headRef]))
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2).split(' ')[0]!)
      .filter(Boolean),
  )
  const firstParentShas = lines(
    runGit(repository, ['rev-list', '--first-parent', '--reverse', `${baseRef}..${headRef}`]),
  )
  const commits = firstParentShas.map((sha) => commitAudit(repository, sha, patchEquivalentShas))
  const excludedMerges = commits.filter((commit) => commit.parents.length > 1)
  const branchCommits = commits.filter((commit) => commit.parents.length <= 1)
  const patchEquivalentCommits = branchCommits.filter((commit) => commit.patchEquivalent)
  const eligibleCommits = branchCommits.filter((commit) => !commit.patchEquivalent)

  const finalFiles = nulSeparated(
    runGit(repository, ['diff', '--name-only', '-z', `${baseRef}...${headRef}`]),
  )
  const finalSet = new Set(finalFiles)
  const eligibleSet = new Set(eligibleCommits.flatMap((commit) => commit.changedFiles))
  const patchEquivalentSet = new Set(
    patchEquivalentCommits.flatMap((commit) => commit.changedFiles),
  )
  const importedSet = new Set(excludedMerges.flatMap((commit) => commit.changedFiles))
  const branchCandidates = new Set(intersection(finalSet, eligibleSet))
  const importCandidates = new Set(intersection(finalSet, importedSet))

  return {
    repository,
    baseRef,
    headRef,
    mergeBase: mergeBases[0]!,
    eligibleCommits,
    patchEquivalentCommits,
    excludedMerges,
    finalFiles,
    branchOnlyFiles: difference(branchCandidates, importedSet),
    mergeOnlyFiles: difference(importCandidates, eligibleSet),
    patchEquivalentFiles: intersection(finalSet, patchEquivalentSet),
    overlappingFiles: intersection(branchCandidates, importedSet),
    unexplainedFiles: difference(
      difference(difference(finalSet, eligibleSet), importedSet),
      patchEquivalentSet,
    ),
    revertedEligibleFiles: difference(eligibleSet, finalSet),
  }
}

function markdownList(values: string[]): string {
  return values.length === 0 ? '- None' : values.map((value) => `- ${value}`).join('\n')
}

function commitTable(commits: CommitAudit[]): string {
  if (commits.length === 0) return '_None_'
  return [
    '| Commit | Subject | Files |',
    '|---|---|---:|',
    ...commits.map(
      (commit) =>
        `| \`${commit.shortSha}\` | ${commit.subject.replaceAll('|', '\\|')} | ${commit.changedFiles.length} |`,
    ),
  ].join('\n')
}

export function formatAuditMarkdown(audit: ProvenanceAudit): string {
  return [
    '# OpenPR2 provenance audit',
    '',
    `- Base: \`${audit.baseRef}\``,
    `- Head: \`${audit.headRef}\``,
    `- Merge base: \`${audit.mergeBase}\``,
    '',
    '## Eligible first-parent commits',
    '',
    commitTable(audit.eligibleCommits),
    '',
    '## Patch-equivalent commits excluded',
    '',
    commitTable(audit.patchEquivalentCommits),
    '',
    '## Merge commits excluded',
    '',
    commitTable(audit.excludedMerges),
    '',
    '## Branch-only final files',
    '',
    markdownList(audit.branchOnlyFiles),
    '',
    '## Merge-only final files',
    '',
    markdownList(audit.mergeOnlyFiles),
    '',
    '## Patch-equivalent final files',
    '',
    markdownList(audit.patchEquivalentFiles),
    '',
    '## Overlapping files requiring hunk review',
    '',
    markdownList(audit.overlappingFiles),
    '',
    '## Unexplained final files',
    '',
    markdownList(audit.unexplainedFiles),
    '',
    '## Eligible files absent from the final diff',
    '',
    markdownList(audit.revertedEligibleFiles),
  ].join('\n')
}

function readArgument(name: string): string | undefined {
  const index = Bun.argv.indexOf(name)
  return index >= 0 ? Bun.argv[index + 1] : undefined
}

if (import.meta.main) {
  const baseRef = readArgument('--base')
  const headRef = readArgument('--head') ?? 'HEAD'
  const repository = readArgument('--repo') ?? process.cwd()
  const format = readArgument('--format') ?? 'markdown'

  if (!baseRef || !['json', 'markdown'].includes(format)) {
    console.error(
      'Usage: bun provenance-audit.ts --base <canonical-base-ref> [--head HEAD] [--repo path] [--format markdown|json]',
    )
    process.exit(1)
  }

  try {
    const audit = auditRepository({ repository, baseRef, headRef })
    process.stdout.write(
      format === 'json' ? `${JSON.stringify(audit, null, 2)}\n` : `${formatAuditMarkdown(audit)}\n`,
    )
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(2)
  }
}
