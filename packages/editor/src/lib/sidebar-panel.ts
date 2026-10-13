import { useEffect } from 'react'
import { useSidebarStore } from '../components/ui/primitives/sidebar'
import type { SidebarTab } from '../components/ui/sidebar/tab-bar'
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

/**
 * The rail tab on screen: the panel picked in this workspace when the rail has
 * it, else the first tab with a panel. The pick is never reset to what shows: a
 * plugin's panel joins the rail only once the scene's plugins load, so a panel
 * restored on reload is missing for a moment, and a reset would lose it. A
 * workspace with nothing picked yet takes the tab it shows, so what reads the
 * store agrees with the screen.
 */
export function useShownSidebarPanel(tabs: readonly SidebarTab[]): string {
  const activePanel = useEditor((s) => s.activeSidebarPanel)
  const hasPickedPanel = useEditor((s) => s.sidebarPanels[s.workspaceMode] !== undefined)
  const shownPanel = tabs.some((tab) => tab.id === activePanel)
    ? activePanel
    : ((tabs.find((tab) => !tab.noPanel) ?? tabs[0])?.id ?? activePanel)

  useEffect(() => {
    if (!hasPickedPanel && shownPanel !== activePanel) {
      useEditor.getState().setActiveSidebarPanel(shownPanel)
    }
  }, [hasPickedPanel, shownPanel, activePanel])

  return shownPanel
}
