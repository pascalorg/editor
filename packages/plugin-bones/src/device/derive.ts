import type { Fixture, WallSlice } from '../core/types'
import { deviceWallOf } from '../engines/electrical'
import type { DeviceKind } from './schema'

/**
 * The per-level DEVICE MANIFEST: every wall-mounted electrical device the
 * engine derived (receptacle / GFCI / switch — the fixtures carrying a
 * deterministic `meta.deviceId`), resolved to the wall-anchor form the
 * `bones:device` nodes store. computeLevel builds this from the
 * POST-override fixtures and the same deduped active walls the engines used,
 * so the reconciler (device/place.ts) sees devices exactly where they mount.
 */

export type DerivedDevice = {
  deviceId: string
  deviceKind: DeviceKind
  wallId: string
  /** 0..1 along the wall from `start`. */
  wallT: number
  /** Device-center height, m AFF. */
  heightAff: number
}

const DEVICE_FIXTURE_KINDS: ReadonlySet<Fixture['kind']> = new Set([
  'receptacle',
  'receptacle-gfci',
  'receptacle-wr-gfci',
  'switch',
])

export function deriveWallDevices(fixtures: Fixture[], walls: WallSlice[]): DerivedDevice[] {
  const out: DerivedDevice[] = []
  for (const fixture of fixtures) {
    if (!DEVICE_FIXTURE_KINDS.has(fixture.kind)) continue
    const deviceId = fixture.meta?.deviceId
    if (typeof deviceId !== 'string' || deviceId.length === 0) continue
    const wall = deviceWallOf(fixture, walls)
    if (!wall || wall.length < 0.1) continue
    const raw =
      (fixture.position[0] - wall.start[0]) * wall.dir[0] +
      (fixture.position[2] - wall.start[1]) * wall.dir[1]
    out.push({
      deviceId,
      deviceKind: fixture.kind as DeviceKind,
      wallId: wall.id,
      wallT: Math.max(0, Math.min(1, raw / wall.length)),
      heightAff: fixture.position[1],
    })
  }
  return out
}
