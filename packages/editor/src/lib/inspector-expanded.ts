import { create } from 'zustand'

// One choice for every right-side inspector panel (room, wall, item…): opened
// expanded or folded to its header, kept per viewer until they fold it again.
// Its own key, read when the module loads: the editor's persisted preferences
// rehydrate after the first render, too late for a panel that opens with the
// editor. Storage can be missing or refuse (private windows, blocked site
// data); the panel then opens folded, as it always has.
const STORAGE_KEY = 'pascal-editor:inspector-expanded'

function readExpanded(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function writeExpanded(expanded: boolean) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, String(expanded))
  } catch {
    // Not remembered this time; the panel still follows the choice until reload.
  }
}

export const useInspectorExpanded = create<{
  expanded: boolean
  setExpanded: (expanded: boolean) => void
}>((set) => ({
  expanded: readExpanded(),
  setExpanded: (expanded) => {
    writeExpanded(expanded)
    set({ expanded })
  },
}))
