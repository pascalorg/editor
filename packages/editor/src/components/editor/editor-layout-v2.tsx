'use client'

import { type ReactNode, useCallback, useEffect, useRef } from 'react'
import { useIsMobile } from '../../hooks/use-mobile'
import useEditor from '../../store/use-editor'

import { useSidebarStore } from '../ui/primitives/sidebar'
import { IconRail, type SidebarTab } from '../ui/sidebar/tab-bar'
import { EditorLayoutMobile } from './editor-layout-mobile'

const SIDEBAR_MIN_WIDTH = 300
const SIDEBAR_MAX_WIDTH = 800
const SIDEBAR_COLLAPSE_THRESHOLD = 220
// Matches the `w-14` rail in <IconRail>; the resize math is relative to it.
const RAIL_WIDTH = 56

// ── Left column: resizable panel with tab bar ────────────────────────────────

function LeftColumn({
  tabs,
  renderTabContent,
  sidebarOverlay,
}: {
  tabs: SidebarTab[]
  renderTabContent: (tabId: string) => ReactNode
  sidebarOverlay?: ReactNode
}) {
  const width = useSidebarStore((s) => s.width)
  const isCollapsed = useSidebarStore((s) => s.isCollapsed)
  const setIsCollapsed = useSidebarStore((s) => s.setIsCollapsed)
  const setWidth = useSidebarStore((s) => s.setWidth)
  const isDragging = useSidebarStore((s) => s.isDragging)
  const setIsDragging = useSidebarStore((s) => s.setIsDragging)
  const activePanel = useEditor((s) => s.activeSidebarPanel)
  const setActivePanel = useEditor((s) => s.setActiveSidebarPanel)

  const isResizing = useRef(false)

  // Ensure active panel is a valid tab
  useEffect(() => {
    if (tabs.length > 0 && !tabs.some((t) => t.id === activePanel)) {
      setActivePanel(tabs[0]!.id)
    }
  }, [tabs, activePanel, setActivePanel])

  // Leaving the items tab while furnishing should drop back to select mode
  useEffect(() => {
    if (activePanel === 'items') return
    const { phase, mode, setMode } = useEditor.getState()
    if (phase === 'furnish' && mode === 'build') {
      setMode('select')
    }
  }, [activePanel])

  const handleResizerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      isResizing.current = true
      setIsDragging(true)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [setIsDragging],
  )

  // Rail click: reopen a collapsed panel, collapse when re-clicking the open
  // tab, otherwise switch tabs. Reopening clamps below-min persisted widths
  // up to the minimum so the panel always returns to a usable size.
  const handleRailClick = useCallback(
    (id: string) => {
      if (isCollapsed) {
        setIsCollapsed(false)
        if (width < SIDEBAR_MIN_WIDTH) setWidth(SIDEBAR_MIN_WIDTH)
        setActivePanel(id)
        return
      }
      if (id === activePanel) {
        setIsCollapsed(true)
        return
      }
      setActivePanel(id)
    },
    [isCollapsed, width, activePanel, setIsCollapsed, setWidth, setActivePanel],
  )

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (!isResizing.current) return
      // Rail occupies the leftmost 48px; the panel starts after it.
      const newWidth = e.clientX - RAIL_WIDTH
      if (newWidth < SIDEBAR_COLLAPSE_THRESHOLD) {
        setIsCollapsed(true)
      } else {
        setIsCollapsed(false)
        setWidth(Math.max(SIDEBAR_MIN_WIDTH, Math.min(newWidth, SIDEBAR_MAX_WIDTH)))
      }
    }
    const handlePointerUp = () => {
      isResizing.current = false
      setIsDragging(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [setWidth, setIsCollapsed, setIsDragging])

  return (
    <div className="relative z-10 flex h-full flex-shrink-0 bg-sidebar text-sidebar-foreground">
      <IconRail
        activeTab={activePanel}
        collapsed={isCollapsed}
        onIconClick={handleRailClick}
        tabs={tabs}
      />
      {!isCollapsed && (
        <div
          className="relative flex h-full flex-col"
          style={{
            width,
            transition: isDragging ? 'none' : 'width 150ms ease',
          }}
        >
          <div className="relative flex flex-1 flex-col overflow-hidden">
            {renderTabContent(activePanel)}
            {sidebarOverlay && <div className="absolute inset-0 z-50">{sidebarOverlay}</div>}
          </div>

          {/* Resize handle + hit area */}
          <div
            className="absolute inset-y-0 -right-3 z-[100] flex w-6 cursor-col-resize items-center justify-center"
            onPointerDown={handleResizerDown}
          >
            <div className="h-8 w-1 rounded-full bg-neutral-500" />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Right column: viewer area with toolbar ───────────────────────────────────

function RightColumn({
  toolbarLeft,
  toolbarRight,
  children,
  overlays,
  stageOverlay,
}: {
  toolbarLeft?: ReactNode
  toolbarRight?: ReactNode
  children: ReactNode
  overlays?: ReactNode
  stageOverlay?: ReactNode
}) {
  return (
    <div
      className="relative flex min-w-0 flex-1 flex-col overflow-hidden"
      style={{
        borderTopLeftRadius: 16,
        clipPath: 'inset(0 0 0 0 round 16px 0 0 0)',
        boxShadow: '-4px -2px 16px rgba(0, 0, 0, 0.08), -1px 0 4px rgba(0, 0, 0, 0.04)',
      }}
    >
      {/* Viewer toolbar */}
      {(toolbarLeft || toolbarRight) && (
        <div className="pointer-events-none absolute top-3 right-3 left-3 z-20 flex items-center justify-between gap-2">
          <div className="pointer-events-auto flex items-center gap-2">{toolbarLeft}</div>
          <div className="pointer-events-auto flex items-center gap-2">{toolbarRight}</div>
        </div>
      )}
      {/* Canvas area */}
      <div className="relative flex-1 overflow-hidden">{children}</div>
      {/* Stage overlay — replaces the canvas visually (e.g. studio gallery)
          while keeping it mounted. Sits below the viewer toolbar (z-20) so
          the stage switch stays reachable. */}
      {stageOverlay && <div className="absolute inset-0 z-10">{stageOverlay}</div>}
      {/* Overlays scoped to the viewer column. `data-viewer-bounds` marks the
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
  )
}

// ── Main v2 layout ───────────────────────────────────────────────────────────

export interface EditorLayoutV2Props {
  navbarSlot?: ReactNode
  sidebarTabs?: SidebarTab[]
  renderTabContent: (tabId: string) => ReactNode
  sidebarOverlay?: ReactNode
  viewerToolbarLeft?: ReactNode
  viewerToolbarRight?: ReactNode
  viewerContent: ReactNode
  overlays?: ReactNode
  stageOverlay?: ReactNode
}

export function EditorLayoutV2({
  navbarSlot,
  sidebarTabs = [],
  renderTabContent,
  sidebarOverlay,
  viewerToolbarLeft,
  viewerToolbarRight,
  viewerContent,
  overlays,
  stageOverlay,
}: EditorLayoutV2Props) {
  const isCaptureMode = useEditor((s) => s.isCaptureMode)
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <EditorLayoutMobile
        navbarSlot={navbarSlot}
        overlays={overlays}
        renderTabContent={renderTabContent}
        sidebarOverlay={sidebarOverlay}
        sidebarTabs={sidebarTabs}
        viewerContent={viewerContent}
        viewerToolbarLeft={viewerToolbarLeft}
        viewerToolbarRight={viewerToolbarRight}
      />
    )
  }

  return (
    <div className="dark flex h-full w-full flex-col bg-sidebar text-foreground">
      {/* Top navbar */}
      {navbarSlot}

      {/* Main content: left column + right column */}
      <div className="flex min-h-0 flex-1">
        {!isCaptureMode && sidebarTabs.length > 0 && (
          <LeftColumn
            renderTabContent={renderTabContent}
            sidebarOverlay={sidebarOverlay}
            tabs={sidebarTabs}
          />
        )}
        <RightColumn
          overlays={overlays}
          stageOverlay={stageOverlay}
          toolbarLeft={isCaptureMode ? undefined : viewerToolbarLeft}
          toolbarRight={isCaptureMode ? undefined : viewerToolbarRight}
        >
          {viewerContent}
        </RightColumn>
      </div>
    </div>
  )
}
