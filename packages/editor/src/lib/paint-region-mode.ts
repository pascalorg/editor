import { create } from 'zustand'
import type { ActivePaintMaterial } from './material-paint'
import { isTypingTarget } from './typing-target'

/**
 * What a paint click does: paint the whole surface under it, draw part of a
 * surface first, or erase. The one source of truth for the paint sub-mode — the
 * panel, the HUD, the cursor and the gestures all read `mode` here.
 *   - `surface`   — a click paints the whole surface under it
 *   - `rectangle` — a box on a wall face, pressed anywhere on it, or on a room floor
 *   - `polygon`   — clicked points on a room floor
 *   - `erase`     — a click removes a painted part, or resets a painted surface
 *   - `pick`      — the eyedropper: a click takes the material shown under it
 */
export type PaintRegionMode = 'surface' | 'rectangle' | 'polygon'
export type PaintMode = PaintRegionMode | 'erase' | 'pick'

export const usePaintRegionMode = create<{
  mode: PaintMode
  /** The last painting (not erasing) sub-mode: where the paint tool and a colour pick return. */
  drawMode: PaintRegionMode
  /** The sub-mode the eyedropper came from, where it returns. */
  pickReturn: PaintMode
  /** What the eyedropper would take from the surface under the cursor. */
  picked: ActivePaintMaterial | null
  setMode: (mode: PaintMode) => void
  /** Short text the HUD shows for a refused gesture (e.g. the per-face cap). */
  notice: string | null
  setNotice: (notice: string | null) => void
}>((set) => ({
  mode: 'surface',
  drawMode: 'surface',
  pickReturn: 'surface',
  picked: null,
  setMode: (mode) =>
    set((state) => ({
      mode,
      notice: null,
      picked: null,
      ...(mode === 'pick'
        ? state.mode === 'pick'
          ? {}
          : { pickReturn: state.mode }
        : mode === 'erase'
          ? {}
          : { drawMode: mode }),
    })),
  notice: null,
  setNotice: (notice) => set({ notice }),
}))

export function isPaintErasing(): boolean {
  return usePaintRegionMode.getState().mode === 'erase'
}

export function isPaintPicking(): boolean {
  return usePaintRegionMode.getState().mode === 'pick'
}

/**
 * Where the eyedropper goes once it took a material: the sub-mode it came from,
 * except erase — a picked material is for painting.
 */
export function paintPickReturnMode(): PaintRegionMode {
  const { pickReturn, drawMode } = usePaintRegionMode.getState()
  return pickReturn === 'erase' || pickReturn === 'pick' ? drawMode : pickReturn
}

/** Leaves the eyedropper without taking anything (the held key released). */
export function endPaintPick(): void {
  const { mode, pickReturn } = usePaintRegionMode.getState()
  if (mode === 'pick')
    usePaintRegionMode.getState().setMode(pickReturn === 'pick' ? 'surface' : pickReturn)
}

/** Erasing and the eyedropper end with the paint session: the next one starts on the last painting sub-mode. */
export function endPaintSession(): void {
  const { mode, drawMode, notice, picked } = usePaintRegionMode.getState()
  if (mode !== drawMode || notice !== null || picked !== null)
    usePaintRegionMode.setState({ mode: drawMode, notice: null, picked: null })
}

/** A new project starts on whole-surface paint. */
export function resetPaintMode(): void {
  usePaintRegionMode.setState({
    mode: 'surface',
    drawMode: 'surface',
    pickReturn: 'surface',
    picked: null,
    notice: null,
  })
}

/** Whether a region sub-mode owns the paint tool's pointer (not whole-surface paint or erase). */
export function paintRegionModeActive(editorMode: string): boolean {
  const { mode } = usePaintRegionMode.getState()
  return editorMode === 'material-paint' && (mode === 'rectangle' || mode === 'polygon')
}

/** Which surfaces a sub-mode draws on. */
export function paintRegionTargets(mode: PaintMode): { wall: boolean; floor: boolean } {
  return { wall: mode === 'rectangle', floor: mode === 'rectangle' || mode === 'polygon' }
}

/** What the HUD asks for while the pointer is over nothing the sub-mode draws on. */
export function paintRegionHoverHint(mode: 'rectangle' | 'polygon'): string {
  return mode === 'polygon' ? 'Hover a floor or ceiling' : 'Hover a wall, floor or ceiling'
}

/**
 * Holding Alt/Option while painting whole surfaces turns the eyedropper on;
 * letting go (or the window losing focus) turns it off, and Escape leaves it
 * from its icon too. Erasing picks nothing, and the region sub-modes keep Alt
 * for placing a point freely.
 */
export function bindPaintPickHold(target: EventTarget): () => void {
  let holding = false
  const release = () => {
    if (!holding) return
    holding = false
    endPaintPick()
  }
  const down = (event: Event) => {
    const key = event as KeyboardEvent
    if (key.key !== 'Alt' || key.repeat || holding || isTypingTarget(key.target)) return
    if (usePaintRegionMode.getState().mode !== 'surface') return
    key.preventDefault()
    holding = true
    usePaintRegionMode.getState().setMode('pick')
  }
  const up = (event: Event) => {
    if ((event as KeyboardEvent).key === 'Alt') release()
  }
  // Escape leaves the eyedropper for the sub-mode it came from, not paint mode.
  const onEscape = (event: Event) => {
    const key = event as KeyboardEvent
    if (key.key !== 'Escape' || !isPaintPicking() || isTypingTarget(key.target)) return
    key.preventDefault()
    key.stopPropagation()
    holding = false
    endPaintPick()
  }
  target.addEventListener('keydown', onEscape, true)
  target.addEventListener('keydown', down)
  target.addEventListener('keyup', up)
  target.addEventListener('blur', release)
  return () => {
    target.removeEventListener('keydown', onEscape, true)
    target.removeEventListener('keydown', down)
    target.removeEventListener('keyup', up)
    target.removeEventListener('blur', release)
    release()
  }
}
