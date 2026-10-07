import { useSidebarStore } from '../components/ui/primitives/sidebar'
import useEditor from '../store/use-editor'

/** The narrowest a reopened sidebar panel may be (the layout's resize floor). */
export const SIDEBAR_MIN_WIDTH = 300

// The desktop layout's rail tabs, published while it is mounted. Hosts pick
// their own tabs, so a shortcut names the panels it would like, in order, and
// gets the first one the host has.
let sidebarTabIds: readonly string[] = []

export function setSidebarTabIds(ids: readonly string[]): void {
  sidebarTabIds = ids
}

/**
 * Show a sidebar panel: expands a collapsed sidebar
 * and switches to the first of `preferred` the host provides. Returns the
 * panel shown, or null when the host has none of them (e.g. on mobile).
 */
export function openSidebarPanel(preferred: readonly string[]): string | null {
  const id = preferred.find((candidate) => sidebarTabIds.includes(candidate))
  if (!id) return null
  const sidebar = useSidebarStore.getState()
  if (sidebar.isCollapsed) {
    sidebar.setIsCollapsed(false)
    if (sidebar.width < SIDEBAR_MIN_WIDTH) sidebar.setWidth(SIDEBAR_MIN_WIDTH)
  }
  useEditor.getState().setActiveSidebarPanel(id)
  return id
}
