import { describe, expect, test } from 'bun:test'
import { ScanNode } from './scan'

describe('ScanNode', () => {
  test('keeps legacy GLB-backed scans loadable', () => {
    const scan = ScanNode.parse({
      id: 'scan_legacy',
      type: 'scan',
      url: 'https://cdn.pascal.app/scans/room.glb',
    })

    expect(scan.url).toBe('https://cdn.pascal.app/scans/room.glb')
    expect(scan.captureSession).toBeNull()
    expect(scan.layers).toEqual({ model: true, deviceMotion: true })
  })

  test('accepts a capture session without a renderable mesh', () => {
    const scan = ScanNode.parse({
      id: 'scan_session',
      type: 'scan',
      captureSession: {
        sessionId: 'session_123',
        manifestUrl: '/api/projects/project_1/captures/capture_1/artifacts/manifest.json',
        schemaVersion: 1,
      },
    })

    expect(scan.url).toBeNull()
    expect(scan.captureSession).toEqual({
      sessionId: 'session_123',
      manifestUrl: '/api/projects/project_1/captures/capture_1/artifacts/manifest.json',
      schemaVersion: 1,
    })
    expect(scan.layers).toEqual({ model: true, deviceMotion: true })
  })

  test('persists independent model and device-motion visibility', () => {
    const scan = ScanNode.parse({
      id: 'scan_session',
      type: 'scan',
      layers: {
        model: false,
        deviceMotion: true,
      },
    })

    expect(scan.layers).toEqual({ model: false, deviceMotion: true })
  })

  test('preserves known layer defaults when a legacy scene stores a partial map', () => {
    const scan = ScanNode.parse({
      id: 'scan_session',
      type: 'scan',
      layers: { model: false },
    })

    expect(scan.layers).toEqual({ deviceMotion: true, model: false })
  })

  test('supports host-resolved sessions and future layer keys', () => {
    const scan = ScanNode.parse({
      id: 'scan_session',
      type: 'scan',
      captureSession: {
        sessionId: 'session_123',
        revisionId: 'revision_2',
      },
      layers: {
        model: true,
        pointCloud: false,
        wifiRanging: true,
      },
    })

    expect(scan.captureSession).toEqual({
      sessionId: 'session_123',
      revisionId: 'revision_2',
    })
    expect(scan.layers).toEqual({
      deviceMotion: true,
      model: true,
      pointCloud: false,
      wifiRanging: true,
    })
  })

  test('rejects unsafe manifest URLs', () => {
    const result = ScanNode.safeParse({
      id: 'scan_session',
      type: 'scan',
      captureSession: {
        sessionId: 'session_123',
        manifestUrl: 'javascript:alert(1)',
      },
    })

    expect(result.success).toBe(false)
  })
})
