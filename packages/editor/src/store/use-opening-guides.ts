// Ephemeral store for the 3D opening proximity/alignment guides published by the
// door/window move + placement tools during a drag — the wall-plane counterpart
// of `useAlignmentGuides` (which only carries floor-plane XZ guides). Guides are
// already transformed into the move tool's render frame — the same building-local
// frame as the drag cursor (ToolManager's group) — so the renderer stays dumb.
// Producers clear on commit, cancel, leave, and unmount.

import { create } from 'zustand'

export type OpeningGuideVec3 = [number, number, number]

// A stable identity per guide slot (`sill`, `head`, `gap:left`, `vertical`,
// `spacing:0`, …) so the renderer can key by semantic role: as the guide set
// churns each drag tick, a slot that persists keeps its React element — and its
// drei `<Html>` portal — mounted instead of remounting when the list shape
// shifts under index keys.
export type OpeningGuide3D =
  // A measured line + distance pill: sill (floor → bottom edge), head (top edge
  // → wall top), or along-wall edge-to-edge proximity.
  | { kind: 'dimension'; id: string; from: OpeningGuideVec3; to: OpeningGuideVec3; value: number }
  // A dashed line connecting two openings that share a sill / centre / top.
  | { kind: 'align-line'; id: string; from: OpeningGuideVec3; to: OpeningGuideVec3 }
  // A Figma-style "=" badge marking one gap in an equal-spacing run.
  | { kind: 'badge'; id: string; at: OpeningGuideVec3; value: number }

type OpeningGuidesState = {
  guides: OpeningGuide3D[]
  set(guides: OpeningGuide3D[]): void
  clear(): void
}

const useOpeningGuides = create<OpeningGuidesState>((set) => ({
  guides: [],
  set: (guides) => set({ guides }),
  // No-op when already empty so the common no-guide hover frame (fallback
  // cursor, invalid target, roof hover) doesn't push a fresh `[]` and notify
  // subscribers — the layer would re-render to the same nothing every tick.
  clear: () => set((s) => (s.guides.length > 0 ? { guides: [] } : s)),
}))

export default useOpeningGuides
