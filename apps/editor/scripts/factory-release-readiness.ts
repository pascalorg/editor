import fs from 'node:fs/promises'
import path from 'node:path'
import { findRepoRoot } from '../lib/generated-assets/manifest'
import { knownIndustryPackRequirements } from '../lib/ai-harness-runs/industry-pack-intent-resolver'
import { planFactoryRequest } from '../lib/ai-harness-runs/factory-planner'
import { matchProcessTemplateBySourcePack } from '../lib/ai-harness-runs/process-template-registry'
import {
  enabledProfilePackDirsSync,
  listCloudProfilePacks,
  listInstalledProfilePacks,
} from '../lib/profile-packs'

export type FactoryReleaseReadinessIssue = {
  code: string
  message: string
  severity: 'error' | 'warning'
}

export type FactoryReleaseReadinessReport = {
  ok: boolean
  generatedAt: string
  repoRoot: string
  installedIntentPackCount: number
  cloudIntentPackCount: number
  cwdChecks: Array<{
    cwd: string
    enabledPackDirCount: number
  }>
  templateChecks: Array<{
    id: string
    version: string
    label: string
    processId?: string
    plannerKind?: string
  }>
  issueCount: {
    error: number
    warning: number
  }
  issues: FactoryReleaseReadinessIssue[]
}

export type FactoryReleaseReadinessCliOptions = {
  outputDir?: string
}

export function parseFactoryReleaseReadinessArgs(
  argv: string[],
): FactoryReleaseReadinessCliOptions {
  const options: FactoryReleaseReadinessCliOptions = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg) continue
    if (arg === '--out-dir') {
      const value = argv[++index]
      if (!value) throw new Error('--out-dir requires a path')
      options.outputDir = value
      continue
    }
    if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'Usage: bun apps/editor/scripts/factory-release-readiness.ts [options]',
          '',
          'Options:',
          '  --out-dir <path>   Write factory-release-readiness.json and factory-v2-release-notes.md.',
          '  --help            Show this help.',
        ].join('\n'),
      )
      process.exit(0)
    }
    throw new Error(`Unknown option ${arg}`)
  }
  return options
}

function withCwd<T>(cwd: string, task: () => T): T {
  const previous = process.cwd()
  process.chdir(cwd)
  try {
    return task()
  } finally {
    process.chdir(previous)
  }
}

async function withCwdAsync<T>(cwd: string, task: () => Promise<T>): Promise<T> {
  const previous = process.cwd()
  process.chdir(cwd)
  try {
    return await task()
  } finally {
    process.chdir(previous)
  }
}

function issue(
  issues: FactoryReleaseReadinessIssue[],
  severity: FactoryReleaseReadinessIssue['severity'],
  code: string,
  message: string,
) {
  issues.push({ severity, code, message })
}

export async function buildFactoryReleaseReadinessReport(): Promise<FactoryReleaseReadinessReport> {
  const repoRoot = await findRepoRoot()
  const appRoot = path.join(repoRoot, 'apps', 'editor')
  const issues: FactoryReleaseReadinessIssue[] = []
  const requirements = knownIndustryPackRequirements()
  const installed = await listInstalledProfilePacks()
  const cloud = await listCloudProfilePacks()
  const installedIntentPacks = requirements.filter((requirement) =>
    installed.some(
      (pack) =>
        pack.id === requirement.id &&
        pack.version === requirement.version &&
        pack.enabled !== false &&
        (pack.processTemplateCount ?? 0) > 0,
    ),
  )
  const cloudIntentPacks = requirements.filter((requirement) =>
    cloud.some((pack) => pack.id === requirement.id && pack.version === requirement.version),
  )

  for (const requirement of requirements) {
    if (!cloud.some((pack) => pack.id === requirement.id && pack.version === requirement.version)) {
      issue(
        issues,
        'warning',
        'intent_pack_missing_from_cloud',
        `${requirement.id}@${requirement.version} is known to intent routing but is not present in the simulated cloud catalog.`,
      )
    }
  }

  const cwdChecks = [repoRoot, appRoot].map((cwd) => ({
    cwd,
    enabledPackDirCount: withCwd(cwd, () => enabledProfilePackDirsSync()).length,
  }))
  for (const check of cwdChecks) {
    if (installedIntentPacks.length > 0 && check.enabledPackDirCount === 0) {
      issue(
        issues,
        'error',
        'enabled_pack_dirs_empty',
        `No enabled profile pack directories were found when resolving from ${check.cwd}.`,
      )
    }
  }

  const templateChecks: FactoryReleaseReadinessReport['templateChecks'] = []
  for (const requirement of installedIntentPacks) {
    const prompt = `generate a ${requirement.label}`
    const matched = withCwd(appRoot, () =>
      matchProcessTemplateBySourcePack({
        id: requirement.id,
        version: requirement.version,
        prompt,
      }),
    )
    const planned = await withCwdAsync(appRoot, () =>
      planFactoryRequest({
        prompt,
        params: { e2eSmoke: true },
        requiredSourcePack: {
          id: requirement.id,
          version: requirement.version,
        },
      }),
    )
    templateChecks.push({
      id: requirement.id,
      version: requirement.version,
      label: requirement.label,
      ...(matched ? { processId: matched.processId } : {}),
      plannerKind: planned.plan.kind,
    })
    if (!matched) {
      issue(
        issues,
        'error',
        'installed_pack_template_missing',
        `${requirement.id}@${requirement.version} is installed but no process template resolves from the editor server cwd.`,
      )
    }
    if (planned.plan.kind !== 'process_line') {
      issue(
        issues,
        'error',
        'installed_pack_planner_not_process_line',
        `${requirement.id}@${requirement.version} resolved planner kind ${planned.plan.kind}; expected process_line.`,
      )
    }
  }

  if (installedIntentPacks.length === 0) {
    issue(
      issues,
      'warning',
      'no_installed_intent_packs',
      'No installed intent-routed industry packs with process templates were found.',
    )
  }

  const errorCount = issues.filter((item) => item.severity === 'error').length
  const warningCount = issues.filter((item) => item.severity === 'warning').length
  return {
    ok: errorCount === 0,
    generatedAt: new Date().toISOString(),
    repoRoot,
    installedIntentPackCount: installedIntentPacks.length,
    cloudIntentPackCount: cloudIntentPacks.length,
    cwdChecks,
    templateChecks,
    issueCount: {
      error: errorCount,
      warning: warningCount,
    },
    issues,
  }
}

export function buildFactoryReleaseNotesMarkdown(report: FactoryReleaseReadinessReport) {
  const status = report.ok ? 'Ready' : 'Blocked'
  const lines = [
    '# Factory V2 Release Notes',
    '',
    `Release readiness: ${status}`,
    `Generated: ${report.generatedAt}`,
    `Repository: ${report.repoRoot}`,
    '',
    '## User Experience',
    '',
    '- Users can ask for a factory in one sentence; the system routes known industries through installed industry packs.',
    '- Generated factories are semantic assemblies with process stations, editable equipment, ports, routes, source metadata, and quality reports.',
    '- Missing or disabled industry packs show an install gate instead of silently falling back to generic geometry.',
    '- Users can inspect why a run used a pack, profile, recipe, semantic profile-parts path, or fallback.',
    '- Large factory generation applies as one canvas change and can be undone as one workflow step.',
    '',
    '## Release Confidence',
    '',
    '- Installed intent-routed packs resolve process templates from both repository root and editor server working directories.',
    '- Known factory templates plan through the process-line path before heavier browser visual QA runs.',
    '- Release-candidate automation can run the fast gate, core tests, typecheck, and Biome from one command.',
    '- Optional visual smoke can produce refinery screenshots and full-run evidence when a local editor server is running.',
    '',
    '## Current Boundaries',
    '',
    '- The simulated cloud is local under the repository `cloud/` directory until the real cloud download service exists.',
    '- Not every industry device needs a recipe-backed implementation; semantic profile-parts remain a valid high-quality path.',
    '- Long-tail or unknown equipment can still fall back to generic editable geometry drafts.',
    '- User-managed WebSocket source add/remove UI is deferred; fixed data sources remain the current validation path.',
    '- Full OpenUSD, real physics simulation, node-graph authoring, and multi-user collaboration are outside this first release.',
    '',
    '## Pack Coverage',
    '',
    `- Installed intent-routed packs: ${report.installedIntentPackCount}`,
    `- Simulated cloud intent-routed packs: ${report.cloudIntentPackCount}`,
    '',
    '## Working Directory Checks',
    '',
    ...report.cwdChecks.map(
      (check) => `- ${check.cwd}: ${check.enabledPackDirCount} enabled pack directories`,
    ),
    '',
    '## Template Checks',
    '',
    ...report.templateChecks.map(
      (check) =>
        `- ${check.id}@${check.version}: ${check.processId ?? 'missing template'} (${check.plannerKind ?? 'unknown planner'})`,
    ),
    '',
    '## Issues',
    '',
    ...(report.issues.length
      ? report.issues.map((item) => `- ${item.severity}: ${item.code} - ${item.message}`)
      : ['- None']),
    '',
    '## Release Candidate Validation',
    '',
    '- `bun run --cwd apps/editor factory:release-candidate`',
    '- `bun run --cwd apps/editor factory:release-qa`',
    '- `bun test apps/editor/scripts/factory-release-readiness.test.ts`',
    '- `bun run --cwd apps/editor factory:release-candidate -- --with-visual-smoke --base-url http://localhost:3002` when screenshot evidence is required.',
    '- Refinery smoke visual QA should reach quality 100 before final release-candidate signoff.',
    '',
  ]
  return `${lines.join('\n')}\n`
}

async function writeReleaseReadinessArtifacts(
  report: FactoryReleaseReadinessReport,
  outputDir: string,
) {
  const resolved = path.isAbsolute(outputDir)
    ? path.resolve(outputDir)
    : path.resolve(report.repoRoot, outputDir)
  await fs.mkdir(resolved, { recursive: true })
  const reportPath = path.join(resolved, 'factory-release-readiness.json')
  const notesPath = path.join(resolved, 'factory-v2-release-notes.md')
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await fs.writeFile(notesPath, buildFactoryReleaseNotesMarkdown(report), 'utf8')
  return { reportPath, notesPath }
}

if (import.meta.main) {
  const options = parseFactoryReleaseReadinessArgs(process.argv.slice(2))
  const report = await buildFactoryReleaseReadinessReport()
  const artifacts = options.outputDir
    ? await writeReleaseReadinessArtifacts(report, options.outputDir)
    : undefined
  console.log(JSON.stringify({ ...report, ...(artifacts ? { artifacts } : {}) }, null, 2))
  if (!report.ok) process.exitCode = 1
}
