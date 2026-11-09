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
 * Pick panel `id` and expand a collapsed sidebar onto it, at a usable width.
 * The pick goes first: expanding first would reopen the panel left open for a
 * moment, and a host may arm that panel's tool as it opens (Paint).
 */
export function showSidebarPanel(id: string): void {
  useEditor.getState().setActiveSidebarPanel(id)
  const sidebar = useSidebarStore.getState()
  if (!sidebar.isCollapsed) return
  sidebar.setIsCollapsed(false)
  if (sidebar.width < SIDEBAR_MIN_WIDTH) sidebar.setWidth(SIDEBAR_MIN_WIDTH)
}

/**
 * Show the first of `preferred` the host provides (`showSidebarPanel`).
 * Returns the panel shown, or null when the host has none of them (e.g. on
 * mobile).
 */
export function openSidebarPanel(preferred: readonly string[]): string | null {
  const id = preferred.find((candidate) => sidebarTabIds.includes(candidate))
  if (!id) return null
  showSidebarPanel(id)
  return id
}

/**
 * The rail tab on screen: the panel picked in this workspace when the rail has
 * it, else the first tab with a panel. `activeSidebarPanel` follows what shows,
 * so every reader agrees with the screen, while the pick (`sidebarPanels`)
 * stays: a plugin's panel joins the rail only once the scene's plugins load,
 * so a panel restored on reload is missing for a moment and comes back then.
 */
export function useShownSidebarPanel(tabs: readonly SidebarTab[]): string {
  const activePanel = useEditor((s) => s.activeSidebarPanel)
  const pickedPanel = useEditor((s) => s.sidebarPanels[s.workspaceMode] ?? s.activeSidebarPanel)
  const shownPanel = tabs.some((tab) => tab.id === pickedPanel)
    ? pickedPanel
    : ((tabs.find((tab) => !tab.noPanel) ?? tabs[0])?.id ?? pickedPanel)

  useEffect(() => {
    if (shownPanel !== activePanel) useEditor.setState({ activeSidebarPanel: shownPanel })
  }, [shownPanel, activePanel])

  return shownPanel
}
