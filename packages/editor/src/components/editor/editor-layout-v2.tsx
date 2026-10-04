'use client'

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { useIsMobile } from '../../hooks/use-mobile'
import { SIDEBAR_MIN_WIDTH, setSidebarTabIds } from '../../lib/sidebar-panel'
import useEditor from '../../store/use-editor'

import { useSidebarStore } from '../ui/primitives/sidebar'
import { IconRail, type SidebarTab } from '../ui/sidebar/tab-bar'
import { EditorLayoutMobile } from './editor-layout-mobile'

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

  // Publish the rail's tabs so keyboard shortcuts (B, P) can open a panel.
  useEffect(() => {
    setSidebarTabIds(tabs.map((tab) => tab.id))
    return () => setSidebarTabIds([])
  }, [tabs])

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

  // Closing (collapsing) the sidebar disarms any build tool back to select
  useEffect(() => {
    if (!isCollapsed) return
    const { mode, setMode } = useEditor.getState()
    if (mode === 'build') {
      setMode('select')
    }
  }, [isCollapsed])

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
      // noPanel tabs drive the stage, not the panel — leave collapse state alone.
      if (tabs.find((t) => t.id === id)?.noPanel) {
        setActivePanel(id)
        return
      }
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
    [tabs, isCollapsed, width, activePanel, setIsCollapsed, setWidth, setActivePanel],
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
      {!isCollapsed && !tabs.find((t) => t.id === activePanel)?.noPanel && (
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
  toolbarCenter,
  toolbarRight,
  children,
  overlays,
  stageOverlay,
}: {
  toolbarLeft?: ReactNode
  toolbarCenter?: ReactNode
  toolbarRight?: ReactNode
  children: ReactNode
  overlays?: ReactNode
  stageOverlay?: ReactNode
}) {
  const columnRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const leftRef = useRef<HTMLDivElement>(null)
  const centerRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  // `inline`: between the side groups. `left`: under the left group, beside a
  // taller right group. `full`: its own row across the whole toolbar.
  const [centerPlacement, setCenterPlacement] = useState<'inline' | 'left' | 'full'>('inline')
  const centerOnOwnRow = centerPlacement !== 'inline'
  const hasToolbar = Boolean(toolbarLeft || toolbarCenter || toolbarRight)

  // When the three groups don't fit in one row, the center group moves under
  // the left group if the right group is tall enough to leave that space and
  // the left column is wide enough, else to its own full-width row. Also publish
  // where each side of the toolbar ends, so viewer overlays sit below their
  // side however tall it gets.
  // biome-ignore lint/correctness/useExhaustiveDependencies: both are re-run triggers; the observed nodes mount and unmount with them.
  useEffect(() => {
    const column = columnRef.current
    const toolbar = toolbarRef.current
    if (!(column && toolbar)) return
    const update = () => {
      const center = centerRef.current?.firstElementChild as HTMLElement | null | undefined
      const left = leftRef.current
      const right = rightRef.current
      if (center) {
        const gap = Number.parseFloat(getComputedStyle(toolbar).columnGap) || 0
        const leftWidth = left?.scrollWidth ?? 0
        const rightWidth = right?.scrollWidth ?? 0
        const fitsInline =
          leftWidth + center.offsetWidth + rightWidth + gap * 2 <= toolbar.clientWidth
        const rightIsTall = (right?.offsetHeight ?? 0) > (left?.offsetHeight ?? 0) + gap
        const fitsUnderLeft = center.offsetWidth <= toolbar.clientWidth - rightWidth - gap
        setCenterPlacement(fitsInline ? 'inline' : rightIsTall && fitsUnderLeft ? 'left' : 'full')
      }
      const bottomOf = (el: HTMLElement | null | undefined) =>
        el ? toolbar.offsetTop + el.offsetTop + el.offsetHeight : toolbar.offsetTop
      const centerBox = centerRef.current
      column.style.setProperty(
        '--viewer-toolbar-bottom',
        `${Math.max(bottomOf(leftRef.current), bottomOf(centerBox))}px`,
      )
      // The right side also ends below the center group when that group reaches under it.
      const centerUnderRight =
        centerBox && right && centerBox.offsetLeft + centerBox.offsetWidth > right.offsetLeft
      column.style.setProperty(
        '--viewer-toolbar-right-bottom',
        `${Math.max(bottomOf(right), centerUnderRight ? bottomOf(centerBox) : 0)}px`,
      )
    }
    update()
    const observer = new ResizeObserver(update)
    for (const el of [
      toolbar,
      leftRef.current,
      rightRef.current,
      centerRef.current?.firstElementChild,
    ]) {
      if (el) observer.observe(el)
    }
    return () => {
      observer.disconnect()
      column.style.removeProperty('--viewer-toolbar-bottom')
      column.style.removeProperty('--viewer-toolbar-right-bottom')
    }
  }, [hasToolbar, toolbarCenter])

  return (
    <div
      className="relative flex min-w-0 flex-1 flex-col overflow-hidden"
      ref={columnRef}
      style={{
        borderTopLeftRadius: 16,
        clipPath: 'inset(0 0 0 0 round 16px 0 0 0)',
        boxShadow: '-4px -2px 16px rgba(0, 0, 0, 0.08), -1px 0 4px rgba(0, 0, 0, 0.04)',
      }}
    >
      {/* Viewer toolbar */}
      {hasToolbar && (
        <div
          className={
            centerOnOwnRow
              ? 'pointer-events-none absolute top-3 right-3 left-3 z-20 grid grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_1fr] items-start gap-2'
              : 'pointer-events-none absolute top-3 right-3 left-3 z-20 flex flex-wrap items-start justify-between gap-2'
          }
          ref={toolbarRef}
        >
          <div
            className={`pointer-events-auto flex items-center gap-2 ${centerOnOwnRow ? 'col-start-1 row-start-1 justify-self-start' : ''}`}
            ref={leftRef}
          >
            {toolbarLeft}
          </div>
          {/* Centered in the gap between the side groups, or under the left group when it doesn't fit. */}
          {toolbarCenter && (
            <div
              className={
                centerPlacement === 'left'
                  ? 'col-start-1 row-start-2 justify-self-center'
                  : centerPlacement === 'full'
                    ? 'col-span-2 col-start-1 row-start-2 justify-self-center'
                    : undefined
              }
              ref={centerRef}
            >
              {/* Only the group takes clicks; the rest of its row stays on the canvas. */}
              <div className="pointer-events-auto">{toolbarCenter}</div>
            </div>
          )}
          {/* `ml-auto` keeps it right-aligned if it wraps; skipped while the center group
              shares the row, so the free space stays split around it. */}
          <div
            className={`pointer-events-auto flex items-center gap-2 ${
              centerPlacement === 'left'
                ? 'col-start-2 row-span-2 row-start-1'
                : centerPlacement === 'full'
                  ? 'col-start-2 row-start-1'
                  : toolbarCenter
                    ? ''
                    : 'ml-auto'
            }`}
            ref={rightRef}
          >
            {toolbarRight}
          </div>
        </div>
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
  viewerToolbarCenter?: ReactNode
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
  viewerToolbarCenter,
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
        sidebarTabs={sidebarTabs.filter((t) => !t.noPanel)}
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
          toolbarCenter={isCaptureMode ? undefined : viewerToolbarCenter}
          toolbarLeft={isCaptureMode ? undefined : viewerToolbarLeft}
          toolbarRight={isCaptureMode ? undefined : viewerToolbarRight}
        >
          {viewerContent}
        </RightColumn>
      </div>
    </div>
  )
}
