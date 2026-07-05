import { describe, expect, test } from 'bun:test'
import {
  buildFactoryReleaseNotesMarkdown,
  buildFactoryReleaseReadinessReport,
  parseFactoryReleaseReadinessArgs,
  type FactoryReleaseReadinessReport,
} from './factory-release-readiness'

const baseReport: FactoryReleaseReadinessReport = {
  ok: true,
  generatedAt: '2026-07-05T00:00:00.000Z',
  repoRoot: '/repo',
  installedIntentPackCount: 1,
  cloudIntentPackCount: 1,
  cwdChecks: [
    { cwd: '/repo', enabledPackDirCount: 1 },
    { cwd: '/repo/apps/editor', enabledPackDirCount: 1 },
  ],
  templateChecks: [
    {
      id: 'industry.refinery.basic',
      version: '0.1.0',
      label: 'Refinery',
      processId: 'refinery_basic_complex',
      plannerKind: 'process_line',
    },
  ],
  issueCount: { error: 0, warning: 0 },
  issues: [],
}

describe('factory release readiness script', () => {
  test('parses artifact output options', () => {
    expect(parseFactoryReleaseReadinessArgs(['--out-dir', 'qa/release'])).toEqual({
      outputDir: 'qa/release',
    })
  })

  test('builds product-facing release notes from the readiness report', () => {
    const notes = buildFactoryReleaseNotesMarkdown(baseReport)

    expect(notes).toContain('Release readiness: Ready')
    expect(notes).toContain('## User Experience')
    expect(notes).toContain('Users can ask for a factory in one sentence')
    expect(notes).toContain('## Current Boundaries')
    expect(notes).toContain('semantic profile-parts remain a valid high-quality path')
    expect(notes).toContain('industry.refinery.basic@0.1.0: refinery_basic_complex')
    expect(notes).toContain('factory:release-candidate -- --with-visual-smoke')
  })

  test('verifies installed intent packs resolve templates from editor server cwd', async () => {
    const report = await buildFactoryReleaseReadinessReport()

    expect(report.ok).toBe(true)
    expect(report.cwdChecks.every((check) => check.enabledPackDirCount > 0)).toBe(true)
    expect(report.templateChecks).toContainEqual(
      expect.objectContaining({
        id: 'industry.refinery.basic',
        processId: 'refinery_basic_complex',
        plannerKind: 'process_line',
      }),
    )
  })
})
