import { describe, expect, test } from 'bun:test'
import type { SceneExport, SceneExportOptions } from '@pascal-app/viewer'
import type { PrintExportReport } from '../../../../../lib/print-export'
import { preparePrintExport } from './print-export-card'

const report: PrintExportReport = {
  kind: 'print-stl-report',
  version: 1,
  scale: 50,
  units: 'millimeter',
  orientation: 'z-up',
  status: 'pass',
  bounds: {
    min: { x: -50, y: -30, z: 0 },
    max: { x: 50, y: 30, z: 40 },
    width: 100,
    depth: 60,
    height: 40,
  },
  triangleCount: 12,
  invalidTriangleCount: 0,
  degenerateTriangleCount: 0,
  boundaryEdgeCount: 0,
  nonManifoldEdgeCount: 0,
  volumeMm3: 240_000,
  diagnostics: [],
}

describe('print export card contract', () => {
  test('prepares a visible-only scaled artifact without downloading immediately', async () => {
    const calls: { format?: string; options?: SceneExportOptions }[] = []
    const artifact = { blob: new Blob(['stl']), filename: 'house.stl', metadata: report }
    const exportScene: SceneExport = async (format, options) => {
      calls.push({ format, options })
      return artifact
    }

    const prepared = await preparePrintExport(exportScene, true, '50')

    expect(calls).toEqual([
      {
        format: 'print-stl',
        options: { onlyVisible: true, download: false, printScale: 50 },
      },
    ])
    expect(prepared).toEqual({ artifact, report })
  })

  test('rejects invalid scale input before invoking the exporter', async () => {
    let invoked = false
    const exportScene: SceneExport = async () => {
      invoked = true
      return null
    }

    await expect(preparePrintExport(exportScene, true, '0')).rejects.toThrow(
      'Enter a positive scale denominator',
    )
    expect(invoked).toBe(false)
  })

  test('rejects an artifact without the print preflight contract', async () => {
    const exportScene: SceneExport = async () => ({
      blob: new Blob(['stl']),
      filename: 'house.stl',
    })

    await expect(preparePrintExport(exportScene, false, '100')).rejects.toThrow(
      'did not return a preflight report',
    )
  })
})
