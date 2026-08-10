import { beforeEach, describe, expect, test } from 'bun:test'
import { encodeTerrainField } from '../lib/terrain-codec'
import {
  applyHeightPatch,
  createTerrainField,
  flattenPatch,
  heightAt,
  type TerrainField,
} from '../lib/terrain-field'
import { persistedTerrainFieldOf, terrainFieldOf } from '../lib/terrain-source'
import useLiveTerrain from './use-live-terrain'

function flatten(field: TerrainField, metres: number) {
  const patch = flattenPatch(field, { minX: 1, minZ: 1, maxX: 4, maxZ: 4 }, metres)
  return { patch: patch as never, field: applyHeightPatch(field, patch as never) }
}

beforeEach(() => {
  useLiveTerrain.getState().endAll()
})

describe('useLiveTerrain', () => {
  test('begin / advance / end lifecycle', () => {
    const store = useLiveTerrain.getState()
    const base = createTerrainField({ cols: 9, rows: 9, spacing: 1 })

    expect(store.fieldOf('site_1')).toBeUndefined()

    store.begin('site_1', base)
    expect(useLiveTerrain.getState().fieldOf('site_1')).toBe(base)

    const dab = flatten(base, 2)
    useLiveTerrain.getState().advance('site_1', dab.field, dab.patch)
    expect(heightAt(useLiveTerrain.getState().fieldOf('site_1') as never, 2, 2)).toBeCloseTo(2, 6)

    useLiveTerrain.getState().end('site_1')
    expect(useLiveTerrain.getState().fieldOf('site_1')).toBeUndefined()
  })

  test('the snapshot survives every dab — the anti-compounding invariant', () => {
    const base = createTerrainField({ cols: 9, rows: 9, spacing: 1 })
    useLiveTerrain.getState().begin('site_1', base)

    let field = base
    for (const height of [1, 2, 3, 4]) {
      const dab = flatten(field, height)
      field = dab.field
      useLiveTerrain.getState().advance('site_1', field, dab.patch)
    }

    // Four dabs later, the snapshot is still the field the stroke started from.
    // A brush computes `snapshot + delta * mask` from this, which is why
    // re-crossing your own stroke cannot compound.
    expect(useLiveTerrain.getState().strokeOf('site_1')?.snapshot).toBe(base)
    expect(heightAt(useLiveTerrain.getState().fieldOf('site_1') as never, 2, 2)).toBeCloseTo(4, 6)
  })

  test('lastPatch is what the renderer uploads, and is null right after begin', () => {
    const base = createTerrainField({ cols: 9, rows: 9, spacing: 1 })
    useLiveTerrain.getState().begin('site_1', base)
    expect(useLiveTerrain.getState().strokeOf('site_1')?.lastPatch).toBeNull()

    const dab = flatten(base, 3)
    useLiveTerrain.getState().advance('site_1', dab.field, dab.patch)
    expect(useLiveTerrain.getState().strokeOf('site_1')?.lastPatch).toBe(dab.patch)
  })

  test('a dab with no stroke is ignored rather than inventing a snapshot', () => {
    const base = createTerrainField({ cols: 9, rows: 9, spacing: 1 })
    const dab = flatten(base, 5)
    useLiveTerrain.getState().advance('site_1', dab.field, dab.patch)
    expect(useLiveTerrain.getState().fieldOf('site_1')).toBeUndefined()
  })

  test('a second begin adopts the dabs so far as its snapshot — the hazard callers own', () => {
    // Pinned rather than left to the doc comment because the shape reads like
    // harmless idempotence. Mid-stroke the field a caller is reading *is* the live
    // one, dabs included, so re-beginning promotes uncommitted dabs to the
    // saturating baseline: they survive the next commit while never appearing in
    // history. Callers `end` first (see `abandonLiveStroke` in the editor's
    // `terrain-sculpt`), and this asserts why they must.
    const base = createTerrainField({ cols: 9, rows: 9, spacing: 1 })
    useLiveTerrain.getState().begin('site_1', base)
    const dab = flatten(base, 5)
    useLiveTerrain.getState().advance('site_1', dab.field, dab.patch)

    const live = useLiveTerrain.getState().fieldOf('site_1') as TerrainField
    useLiveTerrain.getState().begin('site_1', live)

    // Not `base`: the 5 m dab is now the floor the next stroke computes from.
    expect(
      heightAt(useLiveTerrain.getState().strokeOf('site_1')?.snapshot as never, 2, 2),
    ).toBeCloseTo(5, 6)
  })

  test('strokes are per site — one does not leak into another', () => {
    const base = createTerrainField({ cols: 9, rows: 9, spacing: 1 })
    useLiveTerrain.getState().begin('site_1', base)
    const dab = flatten(base, 7)
    useLiveTerrain.getState().advance('site_1', dab.field, dab.patch)

    expect(useLiveTerrain.getState().fieldOf('site_2')).toBeUndefined()
    useLiveTerrain.getState().end('site_1')
    expect(useLiveTerrain.getState().fieldOf('site_1')).toBeUndefined()
  })

  test('local strokes take precedence over remote previews without adopting them', () => {
    const base = createTerrainField({ cols: 9, rows: 9, spacing: 1 })
    const remote = flatten(base, 3)
    const local = flatten(base, 7)

    useLiveTerrain.getState().previewRemote('site_1', 'session_remote', remote.field, remote.patch)
    expect(heightAt(useLiveTerrain.getState().fieldOf('site_1') as never, 2, 2)).toBeCloseTo(3, 6)

    useLiveTerrain.getState().begin('site_1', base)
    useLiveTerrain.getState().advance('site_1', local.field, local.patch)
    expect(heightAt(useLiveTerrain.getState().fieldOf('site_1') as never, 2, 2)).toBeCloseTo(7, 6)

    useLiveTerrain.getState().end('site_1')
    expect(heightAt(useLiveTerrain.getState().fieldOf('site_1') as never, 2, 2)).toBeCloseTo(3, 6)
    useLiveTerrain.getState().endRemote('site_1', 'another_session')
    expect(useLiveTerrain.getState().remoteStrokeOf('site_1')).toBeDefined()
    useLiveTerrain.getState().endRemoteSource('session_remote')
    expect(useLiveTerrain.getState().fieldOf('site_1')).toBeUndefined()
  })
})

describe('terrainFieldOf sees the live stroke', () => {
  test('a stroke wins over the persisted terrain', () => {
    const persisted = createTerrainField({ cols: 9, rows: 9, spacing: 1 })
    const site = { id: 'site_1', terrain: encodeTerrainField(persisted) }
    expect(heightAt(terrainFieldOf(site) as never, 2, 2)).toBeCloseTo(0, 6)

    const dab = flatten(persisted, 6)
    useLiveTerrain.getState().begin('site_1', persisted)
    useLiveTerrain.getState().advance('site_1', dab.field, dab.patch)

    // Every consumer that goes through terrainFieldOf now sees the in-progress
    // ground — that is what keeps the mesh and the raycast from disagreeing.
    expect(heightAt(terrainFieldOf(site) as never, 2, 2)).toBeCloseTo(6, 6)
  })

  test('ending the stroke reverts readers to the persisted terrain', () => {
    const persisted = createTerrainField({ cols: 9, rows: 9, spacing: 1 })
    const site = { id: 'site_1', terrain: encodeTerrainField(persisted) }
    const dab = flatten(persisted, 9)
    useLiveTerrain.getState().begin('site_1', persisted)
    useLiveTerrain.getState().advance('site_1', dab.field, dab.patch)
    useLiveTerrain.getState().end('site_1')

    expect(heightAt(terrainFieldOf(site) as never, 2, 2)).toBeCloseTo(0, 6)
  })

  test('a stroke on a site with no persisted terrain is still visible', () => {
    // Sculpting a virgin site: there is no `site.terrain` yet, so without the
    // live lookup the first stroke would render nothing until commit.
    const base = createTerrainField({ cols: 9, rows: 9, spacing: 1 })
    const dab = flatten(base, 4)
    useLiveTerrain.getState().begin('site_1', base)
    useLiveTerrain.getState().advance('site_1', dab.field, dab.patch)

    const site = { id: 'site_1', terrain: undefined }
    expect(terrainFieldOf(site)).not.toBeNull()
    expect(heightAt(terrainFieldOf(site) as never, 2, 2)).toBeCloseTo(4, 6)
  })

  test('a site with no id and no terrain is still null — no crash', () => {
    expect(terrainFieldOf({ terrain: undefined })).toBeNull()
  })

  test('the persisted-only read ignores local and remote previews', () => {
    const persisted = createTerrainField({ cols: 9, rows: 9, spacing: 1 })
    const site = { id: 'site_1', terrain: encodeTerrainField(persisted) }
    const remote = flatten(persisted, 4)
    useLiveTerrain.getState().previewRemote(site.id, 'session_remote', remote.field, remote.patch)

    expect(persistedTerrainFieldOf(site)).toBe(persistedTerrainFieldOf(site))
    expect(heightAt(persistedTerrainFieldOf(site) as never, 2, 2)).toBeCloseTo(0, 6)
    expect(heightAt(terrainFieldOf(site) as never, 2, 2)).toBeCloseTo(4, 6)
  })
})
