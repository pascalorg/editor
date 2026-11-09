'use client'

import { usePascalI18n } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { PanelLeftOpen, X } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useRef } from 'react'
import { useIsMobile } from '../../hooks/use-mobile'
import {
  openSidebarPanel,
  SIDEBAR_MIN_WIDTH,
  setColumnPanelId,
  setSidebarTabIds,
  showSidebarPanel,
  useShownSidebarPanel,
} from '../../lib/sidebar-panel'
import { cn } from '../../lib/utils'
import useEditor from '../../store/use-editor'

import { useSidebarStore } from '../ui/primitives/sidebar'
import { type SidebarTab, SideMenu } from '../ui/sidebar/tab-bar'
import { EditorLayoutMobile } from './editor-layout-mobile'
import { useSceneSpan } from './views/scene-region'
import { ViewBarRow } from './views/view-bar'

const CHAT_MIN_WIDTH = 320
const CHAT_MAX_WIDTH = 600
// The tool column is narrower at most than the chat can be: the stage stays the widest surface.
const TOOL_MAX_WIDTH = 520

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
  toolClosed,
  columnTabId,
}: {
  tabs: SidebarTab[]
  footer?: ReactNode
  toolClosed: boolean
  /** The column's own tab (the chat): lit whenever no tool panel takes its place. */
  columnTabId?: string
}) {
  const isCollapsed = useSidebarStore((s) => s.isCollapsed)
  const setIsCollapsed = useSidebarStore((s) => s.setIsCollapsed)
  const activePanel = useShownSidebarPanel(tabs)
  const setActivePanel = useEditor((s) => s.setActiveSidebarPanel)
  const setIsMenuHidden = useSidebarStore((s) => s.setIsMenuHidden)

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
      if (id === columnTabId) {
        // The column shows its tab once no tool panel is open in its place.
        setActivePanel(id)
        return
      }
      if (toolClosed) {
        showSidebarPanel(id)
        return
      }
      if (id === activePanel) {
        setIsCollapsed(true)
        return
      }
      setActivePanel(id)
    },
    [tabs, toolClosed, activePanel, columnTabId, setIsCollapsed, setActivePanel],
  )

  const columnShown = toolClosed && columnTabId !== undefined && activeTab?.noPanel !== true
  return (
    <SideMenu
      activeTab={columnShown ? columnTabId : activePanel}
      collapsed={toolClosed && !columnShown}
      footer={footer}
      onHide={() => setIsMenuHidden(true)}
      onTabClick={handleTabClick}
      tabs={tabs}
    />
  )
}

// ── Chat column: the host's column tab, beside the menu while no tool is open ─

function ChatColumn({
  tabId,
  children,
  overlay,
  hidden,
}: {
  tabId: string
  children: ReactNode
  overlay?: ReactNode
  /** A tool panel has its place: the chat stays mounted, so a running turn keeps streaming. */
  hidden: boolean
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
      className={cn(
        'relative h-full shrink-0 flex-col border-border/50 border-r',
        hidden ? 'hidden' : 'flex',
      )}
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

// ── Tool column: the picked tool's panel, in the chat's place ───────────────

/** The menu entry whose panel is open in the column, if any. */
function useOpenTool(
  tabs: SidebarTab[],
  toolClosed: boolean,
  columnTabId: string | undefined,
): SidebarTab | undefined {
  // The same tab list as the menu's: two lists would each pull the shown panel their way.
  const activePanel = useShownSidebarPanel(tabs)
  const tab = tabs.find((t) => t.id === activePanel)
  return toolClosed || !tab || tab.noPanel || tab.id === columnTabId ? undefined : tab
}

function ToolColumn({
  tab,
  renderTabContent,
  overlay,
}: {
  tab: SidebarTab
  renderTabContent: (tabId: string) => ReactNode
  overlay?: ReactNode
}) {
  const i18n = usePascalI18n()
  const width = useSidebarStore((s) => s.width)
  const setWidth = useSidebarStore((s) => s.setWidth)
  const setIsCollapsed = useSidebarStore((s) => s.setIsCollapsed)
  const isDragging = useSidebarStore((s) => s.isDragging)
  const setIsDragging = useSidebarStore((s) => s.setIsDragging)
  const toolRef = useRef<HTMLDivElement>(null)

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
      const inTool = target !== null && toolRef.current?.contains(target) === true
      if (!inTool) {
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
      const left = toolRef.current?.getBoundingClientRect().left ?? 0
      setIsDragging(true)
      startResize(
        (x) => setWidth(Math.max(SIDEBAR_MIN_WIDTH, Math.min(x - left, TOOL_MAX_WIDTH))),
        () => setIsDragging(false),
      )
    },
    [setWidth, setIsDragging],
  )

  const closeLabel = i18n._({ id: 'editor.sidebar.toolDock.close', message: 'Close panel' })
  return (
    <div
      className="relative flex h-full shrink-0 flex-col border-border/50 border-r bg-sidebar text-sidebar-foreground"
      data-surface="tool-panel-column"
      ref={toolRef}
      style={{
        width: Math.max(SIDEBAR_MIN_WIDTH, Math.min(width, TOOL_MAX_WIDTH)),
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
        className="absolute inset-y-0 -right-1.5 z-[100] w-3 cursor-col-resize"
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
  menuButton,
}: {
  /** Shown first in the view bar row (or over the stage without one): brings a hidden menu back. */
  menuButton?: ReactNode
  toolbarLeft?: ReactNode
  toolbarRight?: ReactNode
  viewBar: boolean
  children: ReactNode
  overlays?: ReactNode
  stageOverlay?: ReactNode
}) {
  return (
    <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* The view bar row sits above the stage, one bar per pane; the host's
          left toolbar rides after the first pane's views. */}
      {viewBar && <ViewBarRow leading={toolbarLeft} start={menuButton} />}
      <div
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
        style={{
          borderTopLeftRadius: 16,
          clipPath: 'inset(0 0 0 0 round 16px 0 0 0)',
          boxShadow: '-4px -2px 16px rgba(0, 0, 0, 0.08), -1px 0 4px rgba(0, 0, 0, 0.04)',
        }}
      >
        {((!viewBar && (toolbarLeft || menuButton)) || toolbarRight) && (
          <StageToolbar
            toolbarLeft={
              viewBar ? undefined : (
                <>
                  {menuButton}
                  {toolbarLeft}
                </>
              )
            }
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
      </div>
    </div>
  )
}

/** Brings a hidden side menu back, ahead of the view tabs. */
function ShowMenuButton() {
  const i18n = usePascalI18n()
  const setIsMenuHidden = useSidebarStore((s) => s.setIsMenuHidden)
  const label = i18n._({ id: 'editor.sidebar.sideMenu.show', message: 'Menu' })
  return (
    <button
      aria-label={i18n._({ id: 'editor.sidebar.sideMenu.showLabel', message: 'Show menu' })}
      className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border/60 px-3 font-medium text-muted-foreground text-sm transition-colors hover:bg-sidebar-accent hover:text-foreground"
      onClick={() => setIsMenuHidden(false)}
      type="button"
    >
      <PanelLeftOpen aria-hidden className="size-4" />
      {label}
    </button>
  )
}

// ── Main v2 layout ───────────────────────────────────────────────────────────

export interface EditorLayoutV2Props {
  navbarSlot?: ReactNode
  sidebarTabs?: SidebarTab[]
  /**
   * The tab shown in the column beside the side menu while no tool panel is open (desktop).
   * A tool panel takes its place; closing it, or picking this tab, brings it back.
   */
  columnTabId?: string
  /** Pinned at the bottom of the side menu (desktop). */
  sideMenuFooter?: ReactNode
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
  // The column's tab is listed in the menu too, so it is one click back from any tool.
  const toolTabs = columnTab ? sidebarTabs.filter((t) => t !== columnTab) : sidebarTabs
  const showSideColumns = !(isMobile || isCaptureMode) && toolTabs.length > 0
  const isMenuHidden = useSidebarStore((s) => s.isMenuHidden)
  // A project opens on the column's tab (the chat): tools are one click away in the menu.
  const columnTabIdOnOpen = useRef(showSideColumns ? columnTab?.id : undefined)
  useEffect(() => {
    if (columnTabIdOnOpen.current)
      useEditor.getState().setActiveSidebarPanel(columnTabIdOnOpen.current)
  }, [])
  // On a phone the column tab is one more sheet, so it stays a pickable tab.
  const isCollapsed = useSidebarStore((s) => s.isCollapsed)
  // The column tab picked before its column was there to take it (a host
  // asking for the chat as the page opens): the chat shows, no tool panel.
  const columnPicked = useEditor(
    (s) =>
      columnTab !== undefined &&
      (s.sidebarPanels[s.workspaceMode] ?? s.activeSidebarPanel) === columnTab.id,
  )
  const toolClosed = isCollapsed || (!isMobile && columnPicked)
  const openTool = useOpenTool(sidebarTabs, toolClosed, isMobile ? undefined : columnTab?.id)

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

  const tool = showSideColumns ? openTool : undefined
  const menuButton = showSideColumns && isMenuHidden ? <ShowMenuButton /> : null
  return (
    <div className="flex h-full w-full flex-col bg-sidebar text-foreground">
      {/* Top navbar */}
      {navbarSlot}

      {/* Main content: side menu, the chat or the open tool, work area */}
      <div className="flex min-h-0 flex-1">
        {showSideColumns && !isMenuHidden && (
          <MenuColumn
            columnTabId={columnTab?.id}
            toolClosed={toolClosed}
            footer={sideMenuFooter}
            tabs={sidebarTabs}
          />
        )}
        {showSideColumns && columnTab && (
          <ChatColumn hidden={tool !== undefined} overlay={sidebarOverlay} tabId={columnTab.id}>
            {renderTabContent(columnTab.id)}
          </ChatColumn>
        )}
        {tool && (
          <ToolColumn overlay={sidebarOverlay} renderTabContent={renderTabContent} tab={tool} />
        )}
        <RightColumn
          overlays={overlays}
          stageOverlay={stageOverlay}
          menuButton={isCaptureMode ? undefined : menuButton}
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
