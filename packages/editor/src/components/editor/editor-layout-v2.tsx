'use client'

import { usePascalI18n } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { X } from 'lucide-react'
import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef } from 'react'
import { useIsMobile } from '../../hooks/use-mobile'
import {
  openSidebarPanel,
  SIDEBAR_MIN_WIDTH,
  setColumnPanelId,
  setSidebarTabIds,
  showSidebarPanel,
  useShownSidebarPanel,
} from '../../lib/sidebar-panel'
import useEditor from '../../store/use-editor'

import { useSidebarStore } from '../ui/primitives/sidebar'
import { type SidebarTab, SideMenu } from '../ui/sidebar/tab-bar'
import { EditorLayoutMobile } from './editor-layout-mobile'
import { useSceneSpan } from './views/scene-region'
import { ViewBarRow } from './views/view-bar'

const SIDEBAR_MAX_WIDTH = 800
const CHAT_MIN_WIDTH = 320
const CHAT_MAX_WIDTH = 600
// A docked tool panel never takes more than this share of the stage.
const DOCK_MAX_SHARE = '45%'
const DOCK_MARGIN = 8
// Under a docked tool panel: room for the tool menu along the stage's foot.
const DOCK_BOTTOM_MENU_CLEARANCE = 88

/** Follow the pointer from a resize handle until it is let go. */
function startResize(onMove: (clientX: number) => void, onEnd?: () => void) {
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  const move = (event: PointerEvent) => onMove(event.clientX)
  const up = () => {
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    onEnd?.()
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

// ── Side menu: every tool by name ────────────────────────────────────────────

function MenuColumn({
  tabs,
  footer,
  dockClosed,
}: {
  tabs: SidebarTab[]
  footer?: ReactNode
  dockClosed: boolean
}) {
  const isCollapsed = useSidebarStore((s) => s.isCollapsed)
  const setIsCollapsed = useSidebarStore((s) => s.setIsCollapsed)
  const activePanel = useShownSidebarPanel(tabs)
  const setActivePanel = useEditor((s) => s.setActiveSidebarPanel)

  // Publish the menu's tabs so keyboard shortcuts (B, P) can open a panel.
  useEffect(() => {
    setSidebarTabIds(tabs.map((tab) => tab.id))
    return () => setSidebarTabIds([])
  }, [tabs])

  // A stage entry whose surface has left the stage (its view closed from the
  // view bar) hands the menu back to the panel that was open before it.
  const lastPanelTab = useRef<string | null>(null)
  const activeTab = tabs.find((t) => t.id === activePanel)
  if (activeTab && !activeTab.noPanel) lastPanelTab.current = activeTab.id
  useEffect(() => {
    if (activeTab?.stageActive !== false) return
    const fallback = tabs.find((t) => t.id === lastPanelTab.current) ?? tabs.find((t) => !t.noPanel)
    if (fallback) setActivePanel(fallback.id)
  }, [activeTab, tabs, setActivePanel])

  // Leaving the items tab with the item tool in hand drops back to select mode
  useEffect(() => {
    if (activePanel === 'items') return
    const { mode, tool, setMode } = useEditor.getState()
    if (mode === 'build' && tool === 'item') {
      setMode('select')
    }
  }, [activePanel])

  // Paint mode entered without the panel (command palette, a material's "paint
  // with") brings the host's Paint panel along, so the menu reflects the mode.
  useEffect(
    () =>
      useEditor.subscribe((state, prev) => {
        if (state.mode !== prev.mode && state.mode === 'material-paint') {
          openSidebarPanel(['paint'])
        }
      }),
    [],
  )

  // Closing the tool panel disarms any build tool back to select
  useEffect(() => {
    if (!isCollapsed) return
    const { mode, setMode } = useEditor.getState()
    if (mode === 'build') {
      setMode('select')
    }
  }, [isCollapsed])

  // Menu click: open a closed panel (at a usable width), close it when
  // re-clicking the open entry, otherwise switch panels.
  const handleTabClick = useCallback(
    (id: string) => {
      const tab = tabs.find((t) => t.id === id)
      if (id !== activePanel) tabs.find((t) => t.id === activePanel)?.onDeselect?.()
      tab?.onSelect?.()
      // noPanel entries drive the stage, not the panel — leave its state alone.
      if (tab?.noPanel) {
        setActivePanel(id)
        return
      }
      if (dockClosed) {
        showSidebarPanel(id)
        return
      }
      if (id === activePanel) {
        setIsCollapsed(true)
        return
      }
      setActivePanel(id)
    },
    [tabs, dockClosed, activePanel, setIsCollapsed, setActivePanel],
  )

  return (
    <SideMenu
      activeTab={activePanel}
      collapsed={dockClosed}
      footer={footer}
      onTabClick={handleTabClick}
      tabs={tabs}
    />
  )
}

// ── Chat column: the host's column tab, always beside the menu ───────────────

function ChatColumn({
  tabId,
  children,
  overlay,
}: {
  tabId: string
  children: ReactNode
  overlay?: ReactNode
}) {
  const width = useSidebarStore((s) => s.chatWidth)
  const setWidth = useSidebarStore((s) => s.setChatWidth)
  const columnRef = useRef<HTMLDivElement>(null)

  // While the column is on screen, showing its tab leaves the tool panel be.
  useEffect(() => {
    setColumnPanelId(tabId)
    return () => setColumnPanelId(null)
  }, [tabId])

  const handleResizerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      const left = columnRef.current?.getBoundingClientRect().left ?? 0
      startResize((x) => setWidth(Math.max(CHAT_MIN_WIDTH, Math.min(x - left, CHAT_MAX_WIDTH))))
    },
    [setWidth],
  )

  return (
    <div
      className="relative flex h-full shrink-0 flex-col border-border/50 border-r"
      data-surface="chat-column"
      ref={columnRef}
      style={{ width }}
    >
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
        {overlay && <div className="absolute inset-0 z-50">{overlay}</div>}
      </div>
      <div
        className="absolute inset-y-0 -right-1.5 z-[100] w-3 cursor-col-resize"
        onPointerDown={handleResizerDown}
      />
    </div>
  )
}

// ── Tool dock: the picked tool's panel, over the left of the stage ───────────

function dockWidth(width: number): string {
  return `clamp(${SIDEBAR_MIN_WIDTH}px, ${width}px, ${DOCK_MAX_SHARE})`
}

/** The menu entry whose panel is docked over the stage, if one is open. */
function useDockedTab(tabs: SidebarTab[], dockClosed: boolean): SidebarTab | undefined {
  const activePanel = useShownSidebarPanel(tabs)
  const tab = tabs.find((t) => t.id === activePanel)
  return dockClosed || !tab || tab.noPanel ? undefined : tab
}

function ToolDock({
  tab,
  renderTabContent,
  overlay,
  reserveBottomMenu,
}: {
  tab: SidebarTab
  renderTabContent: (tabId: string) => ReactNode
  overlay?: ReactNode
  reserveBottomMenu: boolean
}) {
  const i18n = usePascalI18n()
  const width = useSidebarStore((s) => s.width)
  const setWidth = useSidebarStore((s) => s.setWidth)
  const setIsCollapsed = useSidebarStore((s) => s.setIsCollapsed)
  const isDragging = useSidebarStore((s) => s.isDragging)
  const setIsDragging = useSidebarStore((s) => s.setIsDragging)
  const dockRef = useRef<HTMLDivElement>(null)

  // Esc closes the panel once there is nothing else for it to do: a tool in
  // hand or a selection goes first (the editor's own Escape), dialogs and
  // menus keep theirs, and typing keeps it unless the field is in the panel.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target?.closest('[role="dialog"],[role="menu"],[data-radix-popper-content-wrapper]')) {
        return
      }
      const inDock = target !== null && dockRef.current?.contains(target) === true
      if (!inDock) {
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target?.isContentEditable
        ) {
          return
        }
        // Paint's brush is the panel's own mode: it closes with it.
        const mode = useEditor.getState().mode
        if (mode !== 'select' && mode !== 'material-paint') return
        if (useViewer.getState().selection.selectedIds.length > 0) return
      }
      setIsCollapsed(true)
    }
    // Capture: decide on the state before the editor's Escape changes it.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [setIsCollapsed])

  const handleResizerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      const left = dockRef.current?.getBoundingClientRect().left ?? 0
      setIsDragging(true)
      startResize(
        (x) => setWidth(Math.max(SIDEBAR_MIN_WIDTH, Math.min(x - left, SIDEBAR_MAX_WIDTH))),
        () => setIsDragging(false),
      )
    },
    [setWidth, setIsDragging],
  )

  const closeLabel = i18n._({ id: 'editor.sidebar.toolDock.close', message: 'Close panel' })
  return (
    <div
      className="absolute z-40 flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-sidebar text-sidebar-foreground shadow-2xl"
      data-surface="tool-panel-dock"
      ref={dockRef}
      style={{
        top: DOCK_MARGIN,
        bottom: reserveBottomMenu ? DOCK_BOTTOM_MENU_CLEARANCE : DOCK_MARGIN,
        left: DOCK_MARGIN,
        width: dockWidth(width),
        transition: isDragging ? 'none' : 'width 150ms ease',
      }}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-border/50 border-b pr-1.5 pl-4">
        <p className="min-w-0 flex-1 truncate font-medium text-sm">{tab.label}</p>
        <button
          aria-label={closeLabel}
          className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          onClick={() => setIsCollapsed(true)}
          title={closeLabel}
          type="button"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {renderTabContent(tab.id)}
        {overlay && <div className="absolute inset-0 z-50">{overlay}</div>}
      </div>
      <div
        className="absolute inset-y-0 right-0 z-[100] w-2 cursor-col-resize"
        onPointerDown={handleResizerDown}
      />
    </div>
  )
}

// ── Work area: view tabs over the stage ──────────────────────────────────────

/**
 * Host toolbars floating over the stage. The right one carries scene controls
 * (wall mode, display), so it sits at the right edge of the scene panes; the
 * left one floats only when there is no view bar row to carry it.
 */
function StageToolbar({
  toolbarLeft,
  toolbarRight,
}: {
  toolbarLeft?: ReactNode
  toolbarRight?: ReactNode
}) {
  const scene = useSceneSpan()
  return (
    <div className="pointer-events-none absolute top-3 right-0 left-0 z-20 h-8">
      {toolbarLeft && (
        <div className="pointer-events-auto absolute top-0 left-3 flex items-center gap-2">
          {toolbarLeft}
        </div>
      )}
      {toolbarRight && scene && (
        <div
          className="pointer-events-auto absolute top-0 flex items-center gap-2"
          style={{ right: `calc(${(1 - scene.right) * 100}% + 12px)` }}
        >
          {toolbarRight}
        </div>
      )}
    </div>
  )
}

function RightColumn({
  toolbarLeft,
  toolbarRight,
  viewBar,
  children,
  overlays,
  stageOverlay,
  dock,
  dockInset,
}: {
  toolbarLeft?: ReactNode
  toolbarRight?: ReactNode
  viewBar: boolean
  children: ReactNode
  overlays?: ReactNode
  stageOverlay?: ReactNode
  dock?: ReactNode
  dockInset?: string
}) {
  return (
    <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* The view bar row sits above the stage, one bar per pane; the host's
          left toolbar rides after the first pane's views. */}
      {viewBar && <ViewBarRow leading={toolbarLeft} />}
      <div
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
        style={
          {
            borderTopLeftRadius: 16,
            clipPath: 'inset(0 0 0 0 round 16px 0 0 0)',
            boxShadow: '-4px -2px 16px rgba(0, 0, 0, 0.08), -1px 0 4px rgba(0, 0, 0, 0.04)',
            '--tool-dock-inset': dockInset,
          } as CSSProperties
        }
      >
        {((!viewBar && toolbarLeft) || toolbarRight) && (
          <StageToolbar
            toolbarLeft={viewBar ? undefined : toolbarLeft}
            toolbarRight={toolbarRight}
          />
        )}
        {/* Canvas area. `isolate` matters: drei's `<Html>` computes a z-index
            from camera distance and defaults to a range topping out at
            16,777,271, and without a stacking context here those values compete
            directly with the viewer toolbar (z-20), the stage overlay (z-10) and
            the overlay band (z-30) — so an in-scene tool badge painted over all
            three. Isolating pins every in-scene HTML layer inside the canvas,
            where it belongs, and leaves their order relative to each other
            untouched. */}
        <div className="relative isolate flex-1 overflow-hidden">{children}</div>
        {/* Stage overlay — replaces the whole stage visually (e.g. the item
            builder) while keeping the canvas mounted. The view bar row steps
            aside for it (see `EditorLayoutV2`); the host's toolbars stay above. */}
        {stageOverlay && <div className="absolute inset-0 z-10">{stageOverlay}</div>}
        {/* Overlays scoped to the stage. `data-viewer-bounds` marks the
            draggable region the floating inspector clamps itself to. */}
        {overlays && (
          <div
            className="pointer-events-none absolute inset-0 z-30"
            data-viewer-bounds
            style={{ transform: 'translateZ(0)' }}
          >
            {overlays}
          </div>
        )}
        {dock}
      </div>
    </div>
  )
}

// ── Main v2 layout ───────────────────────────────────────────────────────────

export interface EditorLayoutV2Props {
  navbarSlot?: ReactNode
  sidebarTabs?: SidebarTab[]
  /** The tab shown as its own column beside the side menu (desktop). */
  columnTabId?: string
  /** Pinned at the bottom of the side menu (desktop). */
  sideMenuFooter?: ReactNode
  /** The tool menu runs along the stage's foot: a docked tool panel stops above it. */
  reserveBottomMenu?: boolean
  renderTabContent: (tabId: string) => ReactNode
  sidebarOverlay?: ReactNode
  viewerToolbarLeft?: ReactNode
  viewerToolbarRight?: ReactNode
  viewerContent: ReactNode
  overlays?: ReactNode
  stageOverlay?: ReactNode
  /** Show each pane's view bar. Off for hosts that present one fixed view. */
  viewBar?: boolean
}

export function EditorLayoutV2({
  navbarSlot,
  sidebarTabs = [],
  columnTabId,
  sideMenuFooter,
  reserveBottomMenu = false,
  renderTabContent,
  sidebarOverlay,
  viewerToolbarLeft,
  viewerToolbarRight,
  viewerContent,
  overlays,
  stageOverlay,
  viewBar = true,
}: EditorLayoutV2Props) {
  const isCaptureMode = useEditor((s) => s.isCaptureMode)
  const isMobile = useIsMobile()
  const columnTab = sidebarTabs.find((t) => t.id === columnTabId)
  const menuTabs = columnTab ? sidebarTabs.filter((t) => t !== columnTab) : sidebarTabs
  const showSideColumns = !(isMobile || isCaptureMode) && menuTabs.length > 0
  // On a phone the column tab is one more sheet, so it stays a pickable tab.
  const isCollapsed = useSidebarStore((s) => s.isCollapsed)
  // The column tab picked before its column was there to take it (a host
  // asking for the chat as the page opens): the chat shows, no tool panel.
  const columnPicked = useEditor(
    (s) =>
      columnTab !== undefined &&
      (s.sidebarPanels[s.workspaceMode] ?? s.activeSidebarPanel) === columnTab.id,
  )
  const dockClosed = isCollapsed || (!isMobile && columnPicked)
  const dockedTab = useDockedTab(isMobile ? sidebarTabs : menuTabs, dockClosed)
  const width = useSidebarStore((s) => s.width)

  if (isMobile) {
    return (
      <EditorLayoutMobile
        navbarSlot={navbarSlot}
        overlays={overlays}
        renderTabContent={renderTabContent}
        sidebarOverlay={sidebarOverlay}
        sidebarTabs={sidebarTabs.filter((t) => !t.noPanel || t.onSelect)}
        viewerContent={viewerContent}
        viewBar={viewBar}
        viewerToolbarLeft={viewerToolbarLeft}
        viewerToolbarRight={viewerToolbarRight}
      />
    )
  }

  const dock = showSideColumns && dockedTab ? dockedTab : undefined
  return (
    <div className="flex h-full w-full flex-col bg-sidebar text-foreground">
      {/* Top navbar */}
      {navbarSlot}

      {/* Main content: side menu, chat column, work area */}
      <div className="flex min-h-0 flex-1">
        {showSideColumns && (
          <MenuColumn dockClosed={dockClosed} footer={sideMenuFooter} tabs={menuTabs} />
        )}
        {showSideColumns && columnTab && (
          <ChatColumn overlay={sidebarOverlay} tabId={columnTab.id}>
            {renderTabContent(columnTab.id)}
          </ChatColumn>
        )}
        <RightColumn
          dock={
            dock && (
              <ToolDock
                overlay={sidebarOverlay}
                renderTabContent={renderTabContent}
                reserveBottomMenu={reserveBottomMenu}
                tab={dock}
              />
            )
          }
          dockInset={dock ? `calc(${dockWidth(width)} + ${DOCK_MARGIN}px)` : undefined}
          overlays={overlays}
          stageOverlay={stageOverlay}
          toolbarLeft={isCaptureMode ? undefined : viewerToolbarLeft}
          toolbarRight={isCaptureMode ? undefined : viewerToolbarRight}
          viewBar={viewBar && !isCaptureMode && !stageOverlay}
        >
          {viewerContent}
        </RightColumn>
      </div>
    </div>
  )
}
