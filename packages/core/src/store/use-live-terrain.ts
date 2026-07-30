import { create } from 'zustand'
import type { HeightPatch, TerrainField } from '../lib/terrain-field'

/**
 * In-progress terrain edits, held as a live `TerrainField` rather than as node
 * data.
 *
 * This is the sculpting analogue of `useLiveNodeOverrides`, and it exists because
 * that store cannot be reused here. An override stores *node* values, so a live
 * terrain override would have to be a `TerrainData` — meaning every dab of a
 * brush would base64-encode the whole field, ~11 KB at 65² and ~44 KB at 129²,
 * dozens of times a second. Holding the decoded field instead makes a dab cost
 * one `applyHeightPatch` (a typed-array copy) and nothing else.
 *
 * The store also carries the **stroke's starting field**, which is what makes the
 * saturating stroke model possible: a brush computes `snapshot + delta · mask`
 * rather than accumulating onto the current field, so re-crossing your own stroke
 * cannot compound. Without a snapshot the same drag deposits material twice
 * wherever it overlaps itself, which is the single most common way a sculpt tool
 * feels wrong.
 *
 * `lastPatch` is how the renderer knows what to upload: it takes the patch,
 * pushes exactly those rows, and never diffs the whole field.
 */

export type LiveTerrainStroke = {
  /** The field as it was at pointer-down. Never mutated during the stroke. */
  readonly snapshot: TerrainField
  /** The field as of the most recent dab — what the renderer and readers see. */
  readonly field: TerrainField
  /**
   * The most recent dab's patch, or null right after `begin`. The renderer
   * consumes this for the dirty-rect upload; a null means "nothing new to push".
   */
  readonly lastPatch: HeightPatch | null
}

type LiveTerrainState = {
  /** Keyed by site node id — a scene can hold more than one site. */
  strokes: Map<string, LiveTerrainStroke>
  /**
   * Start a stroke from `field`.
   *
   * A second `begin` for the same site *replaces* the stroke rather than being
   * rejected — and that is a hazard, not idempotence, which is why it is spelled
   * out here: the caller passes the field it is currently reading, and mid-stroke
   * that field is the live one, dabs included. So a re-begin adopts uncommitted
   * dabs as the new stroke's snapshot, where they become the saturating baseline
   * and get persisted by the next commit — visible on screen the whole time, yet
   * absent from history and unreachable by undo.
   *
   * `advance` takes the opposite stance for the same reason (a dab with no stroke
   * is ignored rather than inventing a snapshot): the invariant is that a snapshot
   * only ever comes from a deliberate stroke boundary. Callers own the boundary —
   * `end` first, or don't begin.
   */
  begin(siteId: string, field: TerrainField): void
  /** Record a dab. `field` must be the result of applying `patch`. */
  advance(siteId: string, field: TerrainField, patch: HeightPatch): void
  /** The live field for a site, or undefined when no stroke is in flight. */
  fieldOf(siteId: string): TerrainField | undefined
  strokeOf(siteId: string): LiveTerrainStroke | undefined
  /** End the stroke. The caller persists the field first if it wants to keep it. */
  end(siteId: string): void
  endAll(): void
}

const useLiveTerrain = create<LiveTerrainState>((set, get) => ({
  strokes: new Map(),

  begin: (siteId, field) =>
    set((state) => {
      const next = new Map(state.strokes)
      next.set(siteId, { snapshot: field, field, lastPatch: null })
      return { strokes: next }
    }),

  advance: (siteId, field, patch) =>
    set((state) => {
      const current = state.strokes.get(siteId)
      // A dab with no stroke is a bug in the caller, not something to paper over
      // by inventing a snapshot — that would silently disable the saturating
      // model and reintroduce compounding.
      if (!current) return state
      const next = new Map(state.strokes)
      next.set(siteId, { snapshot: current.snapshot, field, lastPatch: patch })
      return { strokes: next }
    }),

  fieldOf: (siteId) => get().strokes.get(siteId)?.field,
  strokeOf: (siteId) => get().strokes.get(siteId),

  end: (siteId) =>
    set((state) => {
      if (!state.strokes.has(siteId)) return state
      const next = new Map(state.strokes)
      next.delete(siteId)
      return { strokes: next }
    }),

  endAll: () => set((state) => (state.strokes.size === 0 ? state : { strokes: new Map() })),
}))

export default useLiveTerrain
