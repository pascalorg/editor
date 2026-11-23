import { describe, expect, test } from 'bun:test'
import { CameraSchema } from './camera'
import { SiteNode } from './nodes/site'

describe('CameraSchema', () => {
  test('parses a legacy { position, target } camera without defaulting mode and round-trips cleanly', () => {
    const legacy = {
      position: [10, 12, 14] as [number, number, number],
      target: [0, 1, 0] as [number, number, number],
    }

    const parsed = CameraSchema.parse(legacy)
    expect(parsed.mode).toBeUndefined()
    expect(parsed.fov).toBeUndefined()
    expect(parsed.zoom).toBeUndefined()
    expect(parsed).toEqual(legacy)

    const roundTripped = CameraSchema.parse(JSON.parse(JSON.stringify(parsed)))
    expect(roundTripped.mode).toBeUndefined()
    expect(roundTripped).toEqual(legacy)

    const site = SiteNode.parse({
      id: 'site_legacy_cam',
      camera: legacy,
    })
    expect(site.camera?.mode).toBeUndefined()
    const siteRoundTripped = SiteNode.parse(JSON.parse(JSON.stringify(site)))
    expect(siteRoundTripped.camera).toEqual(legacy)
    expect(siteRoundTripped.camera?.mode).toBeUndefined()
  })

  test('preserves explicit projection mode and lens fields on round-trip', () => {
    const persp = {
      position: [14, 7, 18] as [number, number, number],
      target: [2, 1.2, -3] as [number, number, number],
      mode: 'perspective' as const,
      fov: 34,
    }
    const ortho = {
      position: [16, 12, 20] as [number, number, number],
      target: [3, 1.5, -2] as [number, number, number],
      mode: 'orthographic' as const,
      zoom: 85,
    }

    expect(CameraSchema.parse(JSON.parse(JSON.stringify(CameraSchema.parse(persp))))).toEqual(persp)
    expect(CameraSchema.parse(JSON.parse(JSON.stringify(CameraSchema.parse(ortho))))).toEqual(ortho)
  })
})
