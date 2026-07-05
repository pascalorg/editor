import { describe, expect, test } from 'bun:test'
import { summarizeFactoryRunExperience } from './factory-run-experience-summary'

describe('factory run experience summary', () => {
  test('summarizes prepared scene patches without claiming canvas application', () => {
    const summary = summarizeFactoryRunExperience({
      applied: false,
      patches: [
        { op: 'create', node: { id: 'pump_1' } },
        { op: 'update', id: 'level_1' },
      ],
      nodeIds: ['pump_1'],
      qualityReport: { passed: true, score: 92, issues: [] },
    })

    expect(summary.applyState).toBe('prepared')
    expect(summary.patchCounts).toEqual({ create: 1, update: 1, delete: 0, total: 2 })
    expect(summary.alerts).toContainEqual(
      expect.objectContaining({
        label: 'Prepared for review',
        tone: 'info',
      }),
    )
    expect(summary.details).toContain('Applied to canvas: no')
  })

  test('surfaces fallback reasons as user-visible warnings', () => {
    const summary = summarizeFactoryRunExperience({
      patches: [{ op: 'create', node: { id: 'draft_1' } }],
      missingAssets: [
        {
          name: 'Atmospheric tower',
          reason: 'No registered equipment recipe matched; generic equipment fallback is required.',
        },
      ],
      qualityReport: {
        passed: false,
        score: 64,
        issues: [{ severity: 'warning', message: 'Generic fallback used for tower shell.' }],
      },
    })

    expect(summary.fallbackWarnings).toEqual([
      'Atmospheric tower: No registered equipment recipe matched; generic equipment fallback is required.',
    ])
    expect(summary.alerts.map((alert) => alert.label)).toContain('1 fallback used')
    expect(summary.alerts.map((alert) => alert.label)).toContain('Quality gate needs review (64/100)')
    expect(summary.details).toContain('Missing assets / fallbacks')
  })

  test('builds missing industry pack install guidance', () => {
    const summary = summarizeFactoryRunExperience({
      route: {
        requiredPack: {
          id: 'industry.refinery.basic',
          version: '0.1.0',
          label: 'Refinery Basic',
          installed: false,
          reason: 'Refinery generation requires the cloud industry pack.',
        },
      },
    })

    expect(summary.installGuidance).toMatchObject({
      id: 'industry.refinery.basic',
      version: '0.1.0',
      label: 'Refinery Basic',
    })
    expect(summary.alerts[0]).toMatchObject({
      label: 'Install industry.refinery.basic@0.1.0',
      tone: 'warning',
    })
    expect(summary.details).toContain('Required pack: industry.refinery.basic@0.1.0 is not installed')
  })

  test('includes before and after change preview lines', () => {
    const summary = summarizeFactoryRunExperience({
      applied: true,
      patches: [{ op: 'create', node: { id: 'box_new' } }],
      changePreview: {
        beforeNodeCount: 2,
        afterNodeCount: 3,
        created: [{ id: 'box_new', label: 'New box', type: 'box' }],
        updated: [],
        deleted: [],
        lines: ['Before: 2 nodes', 'After: 3 nodes', 'Create: New box'],
      },
    })

    expect(summary.changePreview).toMatchObject({
      beforeNodeCount: 2,
      afterNodeCount: 3,
      createdCount: 1,
    })
    expect(summary.alerts.map((alert) => alert.label)).toContain('Preview 2 -> 3 nodes')
    expect(summary.details).toContain('Before / after preview')
    expect(summary.details).toContain('Create: New box')
  })
})
