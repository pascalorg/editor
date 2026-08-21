import { describe, expect, test } from 'bun:test'
import type { PrintLevelBundleReport } from '../../../../../lib/level-print-export'
import type { ModelExport, ModelExportOptions } from '../../../../../lib/model-export'
import type { PrintExportReport } from '../../../../../lib/print-export'
import { preparePrintExport } from './print-export-button'

const report: PrintExportReport = {
  kind: 'print-export-report',
  version: 2,
  format: '3mf',
  scale: 100,
  units: 'millimeter',
  orientation: 'z-up',
  status: 'pass',
  bounds: {
    min: { x: -25, y: -15, z: 0 },
    max: { x: 25, y: 15, z: 20 },
    width: 50,
    depth: 30,
    height: 20,
  },
  triangleCount: 12,
  invalidTriangleCount: 0,
  degenerateTriangleCount: 0,
  boundaryEdgeCount: 0,
  nonManifoldEdgeCount: 0,
  connectedComponentCount: 1,
  solidComponentCount: 1,
  invertedWinding: false,
  volumeMm3: 30_000,
  diagnostics: [],
}

describe('simple 3D print export', () => {
  test('uses one fixed safe print profile', async () => {
    const calls: { format?: string; options?: ModelExportOptions }[] = []
    const artifact = { blob: new Blob(['3mf']), filename: 'house.3mf', metadata: report }
    const modelExport: ModelExport = async (format, options) => {
      calls.push({ format, options })
      return artifact
    }

    const prepared = await preparePrintExport(modelExport, true)

    expect(calls).toEqual([
      {
        format: 'print-3mf',
        options: {
          onlyVisible: true,
          download: false,
          printScale: 100,
          printScope: 'levels',
          printContent: 'structure',
          printBase: 'none',
        },
      },
    ])
    expect(prepared).toEqual({ artifact, report })
  })

  test('blocks the download when preflight finds invalid geometry', async () => {
    const blockedReport: PrintExportReport = {
      ...report,
      status: 'blocked',
      diagnostics: [
        {
          severity: 'error',
          code: 'open_boundary',
          message: 'One wall has an open edge.',
        },
      ],
    }
    const modelExport: ModelExport = async () => ({
      blob: new Blob(['3mf']),
      filename: 'house.3mf',
      metadata: blockedReport,
    })

    await expect(preparePrintExport(modelExport, true)).rejects.toThrow(
      'One wall has an open edge.',
    )
  })

  test('shows a per-level preflight error when the bundle has no top-level error', async () => {
    const blockedPartReport: PrintExportReport = {
      ...report,
      status: 'blocked',
      diagnostics: [
        {
          severity: 'error',
          code: 'open_boundary',
          message: 'The upper level has an open edge.',
        },
      ],
    }
    const blockedBundleReport: PrintLevelBundleReport = {
      kind: 'print-level-export-report',
      version: 2,
      format: '3mf',
      scale: 100,
      units: 'millimeter',
      orientation: 'z-up',
      status: 'blocked',
      partCount: 1,
      parts: [
        {
          kind: 'level',
          levelId: 'upper-level',
          label: 'Upper level',
          objectName: 'Upper level',
          filename: null,
          sourceBaseMeters: 3,
          report: blockedPartReport,
        },
      ],
      excludedNodeIds: [],
      diagnostics: [],
    }
    const modelExport: ModelExport = async () => ({
      blob: new Blob(['3mf']),
      filename: 'house.zip',
      metadata: blockedBundleReport,
    })

    await expect(preparePrintExport(modelExport, true)).rejects.toThrow(
      'The upper level has an open edge.',
    )
  })

  test('rejects an exporter response without print metadata', async () => {
    const modelExport: ModelExport = async () => ({
      blob: new Blob(['3mf']),
      filename: 'house.3mf',
    })

    await expect(preparePrintExport(modelExport, false)).rejects.toThrow(
      'did not return a valid file',
    )
  })
})
