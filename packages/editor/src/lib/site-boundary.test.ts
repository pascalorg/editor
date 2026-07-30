import { describe, expect, test } from 'bun:test'
import type { Mode, Phase } from '../store/use-editor'
import { siteBoundaryHandlesEnabled } from './site-boundary'

/**
 * The site handles are the one affordance both views draw from the same state, so
 * they are also the one place a 2D/3D parity break hides: each pane used to derive
 * this rule locally, and the sculpt exclusion existed in the 3D copy only.
 */

const MODES: Mode[] = ['select', 'edit', 'delete', 'build', 'material-paint', 'terrain-sculpt']
const PHASES: Phase[] = ['site', 'structure', 'furnish']

describe('siteBoundaryHandlesEnabled', () => {
  test('sculpt hides the handles in every phase', () => {
    // Including `site` — which is the case that matters, because arming sculpt
    // *promotes* the phase to `site`, so this is the only combination the brush is
    // ever actually in.
    for (const phase of PHASES) {
      expect(siteBoundaryHandlesEnabled({ mode: 'terrain-sculpt', phase })).toBe(false)
    }
  })

  test('the site phase offers them in every other mode', () => {
    for (const mode of MODES.filter((m) => m !== 'terrain-sculpt')) {
      expect(siteBoundaryHandlesEnabled({ mode, phase: 'site' })).toBe(true)
    }
  })

  test('select mode offers them outside the site phase', () => {
    // The flags double as the affordance that *enters* site editing, so select mode
    // has to show them from structure/furnish or the lot becomes unreachable.
    expect(siteBoundaryHandlesEnabled({ mode: 'select', phase: 'structure' })).toBe(true)
    expect(siteBoundaryHandlesEnabled({ mode: 'select', phase: 'furnish' })).toBe(true)
  })

  test('a drafting or painting mode outside the site phase hides them', () => {
    for (const mode of ['edit', 'delete', 'build', 'material-paint'] as Mode[]) {
      expect(siteBoundaryHandlesEnabled({ mode, phase: 'structure' })).toBe(false)
      expect(siteBoundaryHandlesEnabled({ mode, phase: 'furnish' })).toBe(false)
    }
  })

  test('sculpt is excluded before the phase term, not alongside it', () => {
    // Ordering is the whole fix: `phase === 'site' || mode === 'select'` alone is
    // *true* while sculpting, so an implementation that ORs the sculpt check in
    // rather than early-returning would still show the handles.
    const sculptInSite = siteBoundaryHandlesEnabled({ mode: 'terrain-sculpt', phase: 'site' })
    const selectInSite = siteBoundaryHandlesEnabled({ mode: 'select', phase: 'site' })
    expect(sculptInSite).toBe(false)
    expect(selectInSite).toBe(true)
  })
})
