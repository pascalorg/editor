import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { armPaintFromShortcut } from '../hooks/use-keyboard'
import {
  bindPaintPickHold,
  isPaintErasing,
  paintPickReturnMode,
  paintRegionModeActive,
  resetPaintMode,
  usePaintRegionMode,
} from '../lib/paint-region-mode'
import useEditor from './use-editor'

const TILE = { materialPreset: 'library:tile', sourceTarget: 'wall' } as const
const sub = () => usePaintRegionMode.getState().mode
const editorMode = () => useEditor.getState().mode

function reset() {
  useEditor.getState().setPhase('structure')
  useEditor.getState().setStructureLayer('elements')
  useEditor.getState().armToolMode({ mode: 'select' })
  useEditor.getState().setActivePaintMaterial(null)
  resetPaintMode()
}
beforeEach(reset)
afterEach(reset)

describe('paint sub-mode state machine', () => {
  test('the eraser enters paint mode directly from select, with no colour picked', () => {
    expect(useEditor.getState().activePaintMaterial).toBeNull()
    useEditor.getState().armMaterialPaint(undefined, 'erase')
    expect(editorMode()).toBe('material-paint')
    expect(sub()).toBe('erase')
    expect(isPaintErasing()).toBe(true)
    // Erasing is not a region gesture: whole-surface clicks own the pointer.
    expect(paintRegionModeActive(editorMode())).toBe(false)
  })

  test('the paint tool enters on the last painting sub-mode, never on erase', () => {
    useEditor.getState().armMaterialPaint(undefined, 'rectangle')
    usePaintRegionMode.getState().setMode('erase')
    useEditor.getState().armToolMode({ mode: 'select' })
    useEditor.getState().armMaterialPaint()
    expect(editorMode()).toBe('material-paint')
    expect(sub()).toBe('rectangle')
    expect(paintRegionModeActive(editorMode())).toBe(true)
  })

  test('the P shortcut while erasing switches back to painting', () => {
    useEditor.getState().armMaterialPaint(undefined, 'polygon')
    usePaintRegionMode.getState().setMode('erase')
    armPaintFromShortcut()
    expect(editorMode()).toBe('material-paint')
    expect(sub()).toBe('polygon')
  })

  test('leaving paint mode by any route ends erasing and clears the notice', () => {
    for (const leave of [
      () => useEditor.getState().armToolMode({ mode: 'select' }),
      () => useEditor.getState().setMode('delete'),
      () => useEditor.getState().armToolMode({ mode: 'build', tool: 'wall' }),
      () => useEditor.getState().armToolMode({ mode: 'terrain-sculpt' }),
    ]) {
      reset()
      useEditor.getState().armMaterialPaint(undefined, 'rectangle')
      usePaintRegionMode.getState().setMode('erase')
      usePaintRegionMode.getState().setNotice('Up to 8 regions per wall face')
      leave()
      expect(editorMode()).not.toBe('material-paint')
      expect(sub()).toBe('rectangle')
      expect(usePaintRegionMode.getState().notice).toBeNull()
    }
  })

  test('picking a colour while erasing paints with it on the last painting sub-mode', () => {
    useEditor.getState().armMaterialPaint(undefined, 'rectangle')
    useEditor.getState().armMaterialPaint(undefined, 'erase')
    useEditor.getState().armMaterialPaint(TILE)
    expect(sub()).toBe('rectangle')
    expect(useEditor.getState().activePaintMaterial?.materialPreset).toBe('library:tile')

    usePaintRegionMode.getState().setMode('erase')
    useEditor.getState().setActivePaintMaterial(TILE)
    expect(sub()).toBe('rectangle')
  })

  test('switching sub-mode inside paint mode keeps the mode and remembers the drawing one', () => {
    useEditor.getState().armMaterialPaint(TILE)
    for (const mode of ['rectangle', 'erase', 'polygon', 'erase', 'surface'] as const) {
      usePaintRegionMode.getState().setMode(mode)
      expect(editorMode()).toBe('material-paint')
      expect(sub()).toBe(mode)
    }
    expect(usePaintRegionMode.getState().drawMode).toBe('surface')
  })

  test('a new project starts on whole-surface paint', () => {
    useEditor.getState().armMaterialPaint(undefined, 'polygon')
    useEditor.getState().armToolMode({ mode: 'select' })
    resetPaintMode()
    useEditor.getState().armMaterialPaint()
    expect(sub()).toBe('surface')
  })
})

describe('eyedropper sub-mode', () => {
  const key = (type: string, init: KeyboardEventInit) => {
    const event = new Event(type, { cancelable: true }) as KeyboardEvent
    Object.assign(event, { key: init.key, repeat: init.repeat ?? false })
    Object.defineProperty(event, 'target', { value: null })
    return event
  }

  test('the pick icon enters from select and a pick returns to the sub-mode it came from', () => {
    useEditor.getState().armMaterialPaint(undefined, 'rectangle')
    usePaintRegionMode.getState().setMode('pick')
    expect(sub()).toBe('pick')
    expect(paintRegionModeActive(editorMode())).toBe(false)
    expect(paintPickReturnMode()).toBe('rectangle')
    // What the paint path does with a picked material.
    useEditor.getState().armMaterialPaint(TILE, paintPickReturnMode())
    expect(sub()).toBe('rectangle')
    expect(useEditor.getState().activePaintMaterial?.materialPreset).toBe('library:tile')

    useEditor.getState().armToolMode({ mode: 'select' })
    useEditor.getState().armMaterialPaint(undefined, 'pick')
    expect(editorMode()).toBe('material-paint')
    expect(sub()).toBe('pick')
  })

  test('picking while erasing returns to painting, not erasing', () => {
    useEditor.getState().armMaterialPaint(undefined, 'polygon')
    usePaintRegionMode.getState().setMode('erase')
    usePaintRegionMode.getState().setMode('pick')
    expect(paintPickReturnMode()).toBe('polygon')
  })

  test('Alt held while painting picks; releasing, blur or Escape goes back; never while erasing', () => {
    const target = new EventTarget()
    const unbind = bindPaintPickHold(target)
    try {
      useEditor.getState().armMaterialPaint(TILE, 'surface')
      target.dispatchEvent(key('keydown', { key: 'Alt' }))
      expect(sub()).toBe('pick')
      target.dispatchEvent(key('keyup', { key: 'Alt' }))
      expect(sub()).toBe('surface')

      target.dispatchEvent(key('keydown', { key: 'Alt' }))
      expect(sub()).toBe('pick')
      target.dispatchEvent(new Event('blur'))
      expect(sub()).toBe('surface')

      target.dispatchEvent(key('keydown', { key: 'Alt' }))
      const escapeKey = key('keydown', { key: 'Escape' })
      target.dispatchEvent(escapeKey)
      expect(escapeKey.defaultPrevented).toBe(true)
      expect(sub()).toBe('surface')
      target.dispatchEvent(key('keyup', { key: 'Alt' }))

      // Erasing picks nothing: Alt does not turn the eyedropper on.
      usePaintRegionMode.getState().setMode('erase')
      target.dispatchEvent(key('keydown', { key: 'Alt' }))
      expect(sub()).toBe('erase')
      target.dispatchEvent(key('keyup', { key: 'Alt' }))

      // The region sub-modes keep Alt for free placement.
      usePaintRegionMode.getState().setMode('rectangle')
      target.dispatchEvent(key('keydown', { key: 'Alt' }))
      expect(sub()).toBe('rectangle')
      target.dispatchEvent(key('keyup', { key: 'Alt' }))

      // A pick taken while held is not undone by the release.
      usePaintRegionMode.getState().setMode('surface')
      target.dispatchEvent(key('keydown', { key: 'Alt' }))
      useEditor.getState().armMaterialPaint(TILE, paintPickReturnMode())
      target.dispatchEvent(key('keyup', { key: 'Alt' }))
      expect(sub()).toBe('surface')
    } finally {
      unbind()
    }
  })

  test('leaving paint mode ends the eyedropper', () => {
    useEditor.getState().armMaterialPaint(undefined, 'pick')
    usePaintRegionMode.setState({ picked: TILE })
    useEditor.getState().armToolMode({ mode: 'select' })
    expect(sub()).toBe('surface')
    expect(usePaintRegionMode.getState().picked).toBeNull()
  })
})
