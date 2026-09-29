import type { Discipline, DisplayFamily, DisplayMode } from '@pascal-app/core'

/**
 * Personal display state (F4, owner decision O3, frozen): kept per project in
 * this browser like `showScans`, never shared with collaborators and never a
 * geometry edit. Additive to `levelMode` / `wallMode`, which keep their
 * meaning. It composes through a `display` layer-hold reason and never
 * touches `object.visible`. Inside it `isolate` wins over `families`, which
 * win over the mode default. "Save look" writes the project default to
 * `site.presentation` (core `SitePresentation`); the canonical bake is
 * independent of both. Not wired into the viewer store yet.
 */
export type DisplayState = {
  mode: DisplayMode
  families?: Partial<Record<DisplayFamily, boolean>>
  disciplines: Record<Discipline, boolean>
  xray: boolean
  /** 0..1 presentation offset. */
  separation: number
  colorBy: 'material' | 'service'
  isolate?: { kind: 'system' | 'owner'; id: string }
}
