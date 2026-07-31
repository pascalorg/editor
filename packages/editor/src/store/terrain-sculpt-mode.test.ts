import { afterEach, describe, expect, test } from 'bun:test'
import useEditor, { isBrushMode, type Mode, normalizePersistedEditorUiState } from './use-editor'
import useInteractionScope from './use-interaction-scope'

/**
 * The mode-lifecycle contract for terrain sculpting.
 *
 * These are not tests of the brush — that lives in `core`'s terrain-brush tests.
 * They cover the part the user experiences as "does the tool fight the rest of
 * the editor": entering sculpt mode must not leave conflicting affordances
 * armed, and leaving it must not leak sculpt-only state into select mode.
 */

function reset() {
  // These come first: each one forces `mode: 'select'` on entry, so leaving one
  // latched would make the next test's `setMode('terrain-sculpt')` a no-op.
  useEditor.getState().setPreviewMode(false)
  useEditor.getState().setFirstPersonMode(false)
  useEditor.getState().setWorkspaceMode('edit')
  // Before the mode: `setViewMode('2d')` disarms sculpt, and leaving a stale view
  // behind would silently change what the next test's `setMode` does.
  useEditor.getState().setViewMode('3d')
  useEditor.getState().setMode('select')
  useEditor.getState().setTerrainVerb('flatten')
  useEditor.getState().setTerrainSampling(false)
  useInteractionScope.getState().end()
}
afterEach(reset)

describe('terrain-sculpt mode lifecycle', () => {
  test('entering claims the sculpting scope for the whole mode', () => {
    useEditor.getState().setMode('terrain-sculpt')
    // Held by the mode, not by a pointer gesture: an active scope is what makes
    // every other node's handles and the floating action menu step back.
    expect(useInteractionScope.getState().scope.kind).toBe('sculpting')
  })

  test('leaving releases it, so selection works again', () => {
    useEditor.getState().setMode('terrain-sculpt')
    useEditor.getState().setMode('select')
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
  })

  test('arming sculpt from another phase moves to the site phase', () => {
    useEditor.getState().setPhase('structure')
    useEditor.getState().setMode('terrain-sculpt')
    // Otherwise `normalizeModeForPhase` rejects the mode on the next rehydrate
    // and the UI shows a mode the store does not hold.
    expect(useEditor.getState().phase).toBe('site')
    expect(useEditor.getState().mode).toBe('terrain-sculpt')
  })

  test('a phase switch out of site drops the scope', () => {
    useEditor.getState().setMode('terrain-sculpt')
    // This path rewrites `mode` without going through `setMode`, which is
    // exactly why the scope sync is its own function.
    useEditor.getState().setPhase('structure')
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
  })
})

describe('the eyedropper arm is not allowed to outlive sculpt mode', () => {
  test('leaving via setMode disarms it', () => {
    useEditor.getState().setMode('terrain-sculpt')
    useEditor.getState().setTerrainSampling(true)
    useEditor.getState().setMode('select')
    // A one-shot arm that survived would swallow the user's first click back in
    // select mode, with the panel that showed it as armed already unmounted.
    expect(useEditor.getState().terrainSampling).toBe(false)
  })

  test('leaving via a phase switch disarms it too', () => {
    useEditor.getState().setMode('terrain-sculpt')
    useEditor.getState().setTerrainSampling(true)
    useEditor.getState().setPhase('furnish')
    expect(useEditor.getState().terrainSampling).toBe(false)
  })

  test('switching away from flatten disarms it', () => {
    useEditor.getState().setMode('terrain-sculpt')
    useEditor.getState().setTerrainSampling(true)
    useEditor.getState().setTerrainVerb('raise')
    expect(useEditor.getState().terrainSampling).toBe(false)
  })

  test('staying on flatten keeps it armed', () => {
    useEditor.getState().setMode('terrain-sculpt')
    useEditor.getState().setTerrainSampling(true)
    useEditor.getState().setTerrainVerb('flatten')
    expect(useEditor.getState().terrainSampling).toBe(true)
  })

  test('picking a target consumes the arm', () => {
    useEditor.getState().setMode('terrain-sculpt')
    useEditor.getState().setTerrainSampling(true)
    useEditor.getState().setTerrainFlattenTarget(2.5)
    expect(useEditor.getState().terrainFlattenTarget).toBe(2.5)
    expect(useEditor.getState().terrainSampling).toBe(false)
  })
})

describe('the brush and the 3D canvas travel together', () => {
  // In `2d` the 3D pane is still mounted but `display: none`, so nothing about an
  // armed brush is observable and no pointer event can reach it. Every path that
  // could pair the two has to resolve it, and they resolve it in opposite
  // directions on purpose: arming the mode asks for the ground (so the view
  // moves), while choosing the floorplan asks for the floorplan (so the mode
  // yields).
  test('arming from the 2D floorplan opens a 3D pane beside it', () => {
    useEditor.getState().setViewMode('2d')
    useEditor.getState().setMode('terrain-sculpt')
    // `split`, not `3d`: the floorplan was a deliberate choice, so keep it.
    expect(useEditor.getState().viewMode).toBe('split')
    expect(useEditor.getState().isFloorplanOpen).toBe(true)
    expect(useEditor.getState().mode).toBe('terrain-sculpt')
  })

  test('switching to the 2D floorplan disarms the brush', () => {
    useEditor.getState().setMode('terrain-sculpt')
    useEditor.getState().setViewMode('2d')
    expect(useEditor.getState().mode).toBe('select')
    // And the scope goes with it — otherwise selection stays suppressed in the
    // floorplan the user just asked for, with no visible way out.
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
  })

  test('split keeps it armed — the canvas is right there', () => {
    useEditor.getState().setMode('terrain-sculpt')
    useEditor.getState().setViewMode('split')
    expect(useEditor.getState().mode).toBe('terrain-sculpt')
  })

  test('rehydrating the pair resolves it to select', () => {
    // Mode and view persist independently and rehydrate runs neither setter, so
    // this is the one reconciliation the setters cannot cover.
    const state = normalizePersistedEditorUiState({
      phase: 'site',
      mode: 'terrain-sculpt',
      viewMode: '2d',
    })
    expect(state.mode).toBe('select')
  })

  test('rehydrating sculpt beside a visible canvas restores the mode', () => {
    const state = normalizePersistedEditorUiState({
      phase: 'site',
      mode: 'terrain-sculpt',
      viewMode: 'split',
    })
    expect(state.mode).toBe('terrain-sculpt')
  })
})

describe('the modes that hide the editing canvas release the brush', () => {
  // Preview / walkthrough / studio all unmount `ToolManager` (via `noEditing`),
  // so the sculpt tool that would release the scope on unmount is gone. Each one
  // resets `mode` with a raw `set` rather than `setMode`, which is exactly the
  // bug class `setPhase` had: a `sculpting` scope leaked here disables selection
  // across the whole editor with nothing left mounted to clear it.
  test('entering preview releases it', () => {
    useEditor.getState().setMode('terrain-sculpt')
    useEditor.getState().setPreviewMode(true)
    expect(useEditor.getState().mode).toBe('select')
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
  })

  test('entering the first-person walkthrough releases it', () => {
    useEditor.getState().setMode('terrain-sculpt')
    useEditor.getState().setFirstPersonMode(true)
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
  })

  test('entering the studio workspace releases it', () => {
    useEditor.getState().setMode('terrain-sculpt')
    useEditor.getState().setWorkspaceMode('studio')
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
  })

  test('a structure-layer switch releases it', () => {
    useEditor.getState().setMode('terrain-sculpt')
    // Reachable from the layer toggle while sculpt is armed, and it takes the
    // same raw-`set` path — the mode resets, so the scope has to follow.
    useEditor.getState().setStructureLayer('zones')
    expect(useEditor.getState().mode).toBe('select')
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
  })
})

describe('entering sculpt mode stands other affordances down', () => {
  test('the armed build tool is cleared', () => {
    useEditor.getState().setPhase('structure')
    useEditor.getState().setMode('build')
    useEditor.getState().setTool('wall')
    useEditor.getState().setMode('terrain-sculpt')
    // A ghost still armed under the brush would place a wall on the first dab.
    expect(useEditor.getState().tool).toBeNull()
  })
})

describe('isBrushMode', () => {
  /**
   * The set of modes that hold their interaction scope for the whole mode rather
   * than for a pointer gesture. It matters outside the store because a scope is
   * single-owner: anything calling `begin()` while a brush mode holds its scope
   * evicts it silently, leaving the brush armed and painting while the editor
   * believes a drag is running. Nearly every producer needs a selection — which
   * entering a brush mode clears — but the clipboard paths read the clipboard, so
   * `pasteSelectionAndPickUp` asks this before picking clones up.
   */
  test('is exactly the two modes that hold a scope for their duration', () => {
    const modes: Mode[] = ['select', 'edit', 'delete', 'build', 'material-paint', 'terrain-sculpt']
    const held: Mode[] = []
    for (const mode of modes) {
      useEditor.getState().setMode(mode)
      const kind = useInteractionScope.getState().scope.kind
      if (kind === 'painting' || kind === 'sculpting') held.push(mode)
    }
    // Derived from observed scope behaviour rather than restating the literal, so
    // a third brush mode that forgets `isBrushMode` fails here.
    expect(held.filter(isBrushMode)).toEqual(held)
    expect(modes.filter(isBrushMode)).toEqual(held)
  })
})
