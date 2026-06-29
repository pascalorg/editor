import { describe, expect, it } from 'bun:test'
import {
  cycleSnappingModeIn,
  DEFAULT_SNAPPING_MODE,
  defaultSnappingModeFor,
  nextSnappingMode,
  resolveSnapFlags,
  SNAPPING_MODES,
  snapContextOf,
  snappingModesFor,
} from './snapping-mode'

describe('resolveSnapFlags', () => {
  it('default mode is grid', () => {
    expect(DEFAULT_SNAPPING_MODE).toBe('grid')
  })

  it("modes are exclusive: 'grid' snaps to the lattice only", () => {
    expect(resolveSnapFlags('grid')).toEqual({ grid: true, magnetic: false, angles: false })
  })

  it("'off' disables grid, magnetic, and angles", () => {
    expect(resolveSnapFlags('off')).toEqual({ grid: false, magnetic: false, angles: false })
  })

  it("'lines' keeps magnetic but drops the grid lattice and angle lock", () => {
    expect(resolveSnapFlags('lines')).toEqual({ grid: false, magnetic: true, angles: false })
  })

  it("'angles' keeps the angle lock but drops grid and magnetic", () => {
    expect(resolveSnapFlags('angles')).toEqual({ grid: false, magnetic: false, angles: true })
  })

  it("'lines' and 'angles' are distinct", () => {
    expect(resolveSnapFlags('lines')).not.toEqual(resolveSnapFlags('angles'))
  })

  it('cycles through every mode and wraps', () => {
    const seen = [DEFAULT_SNAPPING_MODE]
    let mode = DEFAULT_SNAPPING_MODE
    for (let i = 0; i < SNAPPING_MODES.length - 1; i += 1) {
      mode = nextSnappingMode(mode)
      seen.push(mode)
    }
    expect(seen).toEqual(SNAPPING_MODES)
    expect(nextSnappingMode(mode)).toBe(DEFAULT_SNAPPING_MODE)
  })
})

describe('per-context snapping', () => {
  it('items default to free (lines) with no angle lock', () => {
    expect(defaultSnappingModeFor('item')).toBe('lines')
    expect(snappingModesFor('item')).toEqual(['lines', 'grid', 'off'])
    expect(snappingModesFor('item')).not.toContain('angles')
  })

  it('walls default to grid and expose the angle lock; polygons do NOT', () => {
    expect(defaultSnappingModeFor('wall')).toBe('grid')
    expect(defaultSnappingModeFor('polygon')).toBe('grid')
    expect(snappingModesFor('wall')).toContain('angles')
    // Angle lock is wall/fence-only — slabs, curves and translates never get it.
    expect(snappingModesFor('polygon')).not.toContain('angles')
    expect(snappingModesFor('polygon')).toEqual(['grid', 'lines', 'off'])
  })

  it('cycles within the context set and clamps a foreign value', () => {
    expect(cycleSnappingModeIn('item', 'lines')).toBe('grid')
    expect(cycleSnappingModeIn('item', 'off')).toBe('lines')
    // 'angles' isn't an item mode → restart at the first entry
    expect(cycleSnappingModeIn('item', 'angles')).toBe('lines')
  })
})

describe('snapContextOf (profile-driven, node-declared)', () => {
  // Stands in for the registry's declared `def.snapProfile` (the only per-kind
  // data) — the resolver itself has no kind switch.
  const declared: Record<string, 'item' | 'structural'> = {
    wall: 'structural',
    fence: 'structural',
    item: 'item',
    slab: 'structural',
    ceiling: 'structural',
    roof: 'structural',
    zone: 'structural',
  }
  const profileOf = (t: string) => declared[t]
  const ctx = (
    scope: { kind: string; nodeType?: string; reshape?: string; tool?: string },
    mode = 'select',
    tool: string | null = null,
  ) => snapContextOf({ scope, mode, tool, profileOf })

  it('translating a whole structural node has no angle (polygon, not wall)', () => {
    expect(ctx({ kind: 'moving', nodeType: 'wall' })).toBe('polygon')
    expect(ctx({ kind: 'moving', nodeType: 'slab' })).toBe('polygon')
    expect(ctx({ kind: 'placing', nodeType: 'item' }, 'build', 'item')).toBe('item')
  })

  it('endpoint reshape is angle-bearing (wall); curve + polygon vertex edits are not', () => {
    expect(ctx({ kind: 'reshaping', reshape: 'endpoint' })).toBe('wall')
    expect(ctx({ kind: 'reshaping', reshape: 'curve' })).toBe('polygon')
    expect(ctx({ kind: 'reshaping', reshape: 'boundary' })).toBe('polygon')
    expect(ctx({ kind: 'reshaping', reshape: 'hole' })).toBe('polygon')
  })

  it('drafting a structural kind (wall OR slab) is angle-bearing (wall)', () => {
    expect(ctx({ kind: 'idle' }, 'build', 'wall')).toBe('wall')
    expect(ctx({ kind: 'idle' }, 'build', 'slab')).toBe('wall')
    expect(ctx({ kind: 'idle' }, 'build', 'item')).toBe('item')
    expect(ctx({ kind: 'idle' }, 'select', null)).toBeNull()
  })

  it('an undeclared kind (no snapProfile) gets no snap context', () => {
    expect(ctx({ kind: 'moving', nodeType: 'door' })).toBeNull()
    expect(ctx({ kind: 'idle' }, 'build', 'shelf')).toBeNull()
  })

  it('drafting a non-directional structural kind is angle-less (polygon, not wall)', () => {
    // Roof / stair / elevator are placed as footprints, not directional draws →
    // declared `snapDraftDirectional: false`, so their draft context drops the
    // angle-lock mode. Directional structural kinds (no flag) stay `wall`.
    const draftDirectionalOf = (t: string) => t !== 'roof'
    const draftCtx = (tool: string) =>
      snapContextOf({ scope: { kind: 'idle' }, mode: 'build', tool, profileOf, draftDirectionalOf })
    expect(draftCtx('roof')).toBe('polygon')
    expect(draftCtx('wall')).toBe('wall')
    // Also via the explicit `drafting` scope path.
    expect(
      snapContextOf({
        scope: { kind: 'drafting', tool: 'roof' },
        mode: 'build',
        tool: 'roof',
        profileOf,
        draftDirectionalOf,
      }),
    ).toBe('polygon')
  })
})
