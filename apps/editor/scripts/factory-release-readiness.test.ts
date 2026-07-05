import { describe, expect, test } from 'bun:test'
import { buildFactoryReleaseReadinessReport } from './factory-release-readiness'

describe('factory release readiness script', () => {
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
