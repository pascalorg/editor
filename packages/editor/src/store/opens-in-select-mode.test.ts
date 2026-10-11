import { describe, expect, test } from 'bun:test'
import { DEFAULT_PERSISTED_EDITOR_UI_STATE, editorUiStateOnOpen } from './use-editor'
import { sceneLayout } from './view-layout'

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
      toolMode: { mode: 'build', tool: 'wall' },
      mode: 'build',
      tool: 'wall',
      viewLayouts: { edit: sceneLayout('split') },
    })

    expect(state.toolMode).toEqual({ mode: 'select' })
    expect(state.mode).toBe('select')
    expect(state.tool).toBeNull()
    expect(state.phase).toBe('building')
    expect(state.viewLayouts).toEqual({ edit: sceneLayout('split') })
  })

  test('the 2D plan opens in select mode as well', () => {
    const state = editorUiStateOnOpen({
      phase: 'building',
      toolMode: { mode: 'build', tool: 'slab' },
      mode: 'build',
      tool: 'slab',
      viewLayouts: { edit: sceneLayout('2d') },
    })

    expect(state.viewLayouts).toEqual({ edit: sceneLayout('2d') })
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
      expect(editorUiStateOnOpen({ phase: stored as never }).phase).toBe('building')
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

  test('a blob from the Elements/Rooms layer days opens in select mode, its layer dropped', () => {
    const state = editorUiStateOnOpen({
      phase: 'building',
      structureLayer: 'zones',
      toolMode: { mode: 'build', tool: 'zone' },
      mode: 'build',
      tool: 'zone',
    } as never)

    expect(state).not.toHaveProperty('structureLayer')
    expect(state.mode).toBe('select')
    expect(state.tool).toBeNull()
  })

  test('an empty blob opens on the defaults', () => {
    expect(editorUiStateOnOpen(null)).toEqual(DEFAULT_PERSISTED_EDITOR_UI_STATE)
  })
})
