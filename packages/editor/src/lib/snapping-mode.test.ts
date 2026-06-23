import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_SNAPPING_MODE,
  nextSnappingMode,
  resolveSnapFlags,
  SNAPPING_MODES,
} from './snapping-mode'

describe('resolveSnapFlags', () => {
  it('default mode is grid', () => {
    expect(DEFAULT_SNAPPING_MODE).toBe('grid')
  })

  it("default 'grid' reproduces today's full snapping (grid + magnetic + angles on)", () => {
    expect(resolveSnapFlags('grid')).toEqual({ grid: true, magnetic: true, angles: true })
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
