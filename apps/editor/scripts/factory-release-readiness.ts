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

if (import.meta.main) {
  const report = await buildFactoryReleaseReadinessReport()
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exitCode = 1
}
