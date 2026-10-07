import { describe, expect, test } from 'bun:test'
import { DEFAULT_PERSISTED_EDITOR_UI_STATE, editorUiStateOnOpen } from './use-editor'

/**
 * A project always opens in select mode.
 *
 * The armed tool used to ride along in the persisted UI preferences, so whatever
 * the last session left armed came back on the next load and the first canvas
 * click drew a wall (or dropped an item) instead of selecting what the user
 * clicked on. `partialize` no longer writes the tool, and a blob written before
 * that must not re-arm one either — which is what these cover. Everything else
 * in the blob is a real preference and still has to come back.
 */
describe('opening a project', () => {
  test('a persisted wall tool is not armed, and the preferences beside it survive', () => {
    const state = editorUiStateOnOpen({
      phase: 'building',
      structureLayer: 'elements',
      toolMode: { mode: 'build', tool: 'wall' },
      mode: 'build',
      tool: 'wall',
      viewMode: '3d',
    })

    expect(state.toolMode).toEqual({ mode: 'select' })
    expect(state.mode).toBe('select')
    expect(state.tool).toBeNull()
    expect(state.phase).toBe('building')
    expect(state.structureLayer).toBe('elements')
    expect(state.viewMode).toBe('3d')
  })

  test('the 2D plan opens in select mode as well', () => {
    const state = editorUiStateOnOpen({
      phase: 'building',
      toolMode: { mode: 'build', tool: 'slab' },
      mode: 'build',
      tool: 'slab',
      viewMode: '2d',
    })

    expect(state.viewMode).toBe('2d')
    expect(state.isFloorplanOpen).toBe(true)
    expect(state.mode).toBe('select')
    expect(state.tool).toBeNull()
  })

  test('a persisted item tool leaves no catalog category armed either', () => {
    const state = editorUiStateOnOpen({
      phase: 'building',
      toolMode: { mode: 'build', tool: 'item' },
      mode: 'build',
      tool: 'item',
      catalogCategory: 'kitchen',
    })

    expect(state.phase).toBe('building')
    expect(state.mode).toBe('select')
    expect(state.tool).toBeNull()
    expect(state.catalogCategory).toBeNull()
  })

  test('a phase stored before Structure and Furnish merged opens inside the building', () => {
    // Browsers still hold `structure` / `furnish` from before the merge.
    for (const stored of ['structure', 'furnish']) {
      const state = editorUiStateOnOpen({ phase: stored as never, structureLayer: 'zones' })
      expect(state.phase).toBe('building')
      expect(state.structureLayer).toBe('zones')
    }
    expect(editorUiStateOnOpen({ phase: 'site' }).phase).toBe('site')
    expect(editorUiStateOnOpen({ phase: 'garden' as never }).phase).toBe('site')
  })

  test('the brush modes do not come back armed', () => {
    // Paint and sculpt hold an interaction scope for the whole mode, so opening
    // into one is the same class of surprise as opening into a build tool.
    expect(editorUiStateOnOpen({ phase: 'site', mode: 'terrain-sculpt' }).mode).toBe('select')
    expect(editorUiStateOnOpen({ phase: 'building', mode: 'material-paint' }).mode).toBe('select')
  })

  test('the zones layer is a preference — it comes back without arming the zone tool', () => {
    const state = editorUiStateOnOpen({
      phase: 'building',
      structureLayer: 'zones',
      toolMode: { mode: 'build', tool: 'zone' },
      mode: 'build',
      tool: 'zone',
    })

    expect(state.structureLayer).toBe('zones')
    expect(state.mode).toBe('select')
    expect(state.tool).toBeNull()
  })

  test('an empty blob opens on the defaults', () => {
    expect(editorUiStateOnOpen(null)).toEqual(DEFAULT_PERSISTED_EDITOR_UI_STATE)
  })
})
