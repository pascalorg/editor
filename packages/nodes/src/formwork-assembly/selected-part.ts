import { create } from 'zustand'

/**
 * Which part of a shutter is being looked at.
 *
 * A part is not a node — it is a row of a derived list — so it cannot go in
 * `useViewer.selection`, which holds node ids and drives the transform gizmo, the
 * outliner and the delete key. Clicking a waler still selects the assembly the
 * normal way; this is the extra bit of "which one", read by the part inspector and
 * written by the scene-action dispatch on the same click.
 *
 * Keyed by assembly id rather than global, so selecting a panel on one wall does not
 * leave a stale mark highlighted on the shutter next to it — and cleared per assembly
 * when the mark stops resolving, which the inspector detects and this store cannot.
 *
 * Lives in the nodes package for the same reason `liquid-line/options.ts` does: the
 * definition's `sceneAction` writes it and the inspector's panel reads it, and they
 * are on opposite sides of the registry.
 */
type SelectedPartState = {
  /** Assembly node id → the mark being inspected. */
  byAssembly: Readonly<Record<string, string>>
  select: (assemblyId: string, mark: string) => void
  clear: (assemblyId: string) => void
}

export const useSelectedPart = create<SelectedPartState>((set) => ({
  byAssembly: {},
  select: (assemblyId, mark) =>
    set((state) => ({ byAssembly: { ...state.byAssembly, [assemblyId]: mark } })),
  clear: (assemblyId) =>
    set((state) => {
      if (state.byAssembly[assemblyId] === undefined) return state
      const byAssembly = { ...state.byAssembly }
      delete byAssembly[assemblyId]
      return { byAssembly }
    }),
}))

/** The mark a click on the 3D shutter put on this assembly, if any. */
export function selectedPartMark(assemblyId: string | undefined): string | undefined {
  return assemblyId === undefined ? undefined : useSelectedPart.getState().byAssembly[assemblyId]
}
