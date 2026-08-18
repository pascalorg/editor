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
