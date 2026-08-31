'use client'

import { Icon } from '@iconify/react'
import {
  type AnyNode,
  type AnyNodeId,
  getInspectorExtensions,
  type IconRef,
  type InspectorExtension,
  useRegistryVersion,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { ChevronDown, ChevronLeft, GripHorizontal, RotateCcw, X } from 'lucide-react'
import Image from 'next/image'
import {
  type ComponentType,
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useIsMobile } from '../../../hooks/use-mobile'
import {
  resolveActiveExtension,
  toggleCard,
  toggleExtension,
} from '../../../lib/inspector-card-mode'
import { cn } from '../../../lib/utils'
import { PanelSection } from '../controls/panel-section'
import { ErrorBoundary } from '../primitives/error-boundary'

const DRAG_MARGIN = 8
// Pointer travel (px) below which a header press is treated as a click
// (toggles collapse) rather than a drag.
const CLICK_SLOP = 4
let desktopInspectorCollapsed = true

/** Forget the shared expanded state. Called when the last selection clears so
 * a fresh selection opens the inspector collapsed — the sharing is only meant
 * to survive swaps between panels (roof ↔ segment), not a close/reopen. */
export function resetDesktopInspectorCollapsed() {
  desktopInspectorCollapsed = true
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/**
 * Bounds the panel is allowed to occupy — the viewer column (tagged with
 * `data-viewer-bounds`) so it can't slide under the sidebar or top bar.
 * Falls back to the viewport when the marker isn't found.
 */
function getDragBounds(el: HTMLElement | null): {
  left: number
  top: number
  right: number
  bottom: number
} {
  const region = el?.closest('[data-viewer-bounds]')
  const rect = region?.getBoundingClientRect()
  if (!rect) {
    return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
  }
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
}

/**
 * Host-supplied inspector footer (e.g. community's "Save as preset"). The
 * `PanelManager` provides it so every panel — including kind-owned
 * `customPanel`s that render their own `<PanelWrapper>` without threading a
 * `footer` prop — picks it up without per-kind wiring. An explicit `footer`
 * prop still wins over the context.
 */
export const InspectorFooterContext = createContext<React.ReactNode>(null)

interface PanelWrapperProps {
  title: string
  /** Either a URL path (legacy panels pass `/icons/floor.webp` etc.,
   *  rendered via next/image) OR a React node (registry-driven
   *  inspector renders `<Icon icon="lucide:fence" />` from
   *  `def.presentation.icon`). */
  icon?: string | React.ReactNode
  onClose?: () => void
  onReset?: () => void
  onBack?: () => void
  children: React.ReactNode
  /** Pinned below the scrollable body, inside the panel card. */
  footer?: React.ReactNode
  className?: string
  width?: number | string
}

export function PanelWrapper({
  title,
  icon,
  onClose,
  onReset,
  onBack,
  children,
  footer,
  className,
  width = 320, // default width
}: PanelWrapperProps) {
  const isMobile = useIsMobile()
  const contextFooter = useContext(InspectorFooterContext)
  const resolvedFooter = footer ?? contextFooter

  const panelRef = useRef<HTMLDivElement>(null)

  // ── Plugin inspector extensions ────────────────────────────────────
  // The wrapper self-resolves the selected node instead of taking a prop:
  // kind-owned `customPanel`s (wall, slab, …) render their own
  // <PanelWrapper>, so this is the one spot every inspector card flows
  // through. Extensions only apply to a single-node selection.
  const registryVersion = useRegistryVersion()
  const selectedId = useViewer((s) =>
    s.selection.selectedIds.length === 1 ? s.selection.selectedIds[0] : undefined,
  ) as AnyNodeId | undefined
  // Subscribe to the selected node's *type* only — a string primitive that
  // doesn't change as fields are edited (same trick as ParametricInspector).
  const selectedType = useScene((s) => (selectedId ? (s.nodes[selectedId]?.type ?? null) : null))
  const installedPlugins = useScene((s) => s.installedPlugins)
  const extensions = useMemo(() => {
    // re-derive when plugin extensions register after mount (async plugin load)
    void registryVersion
    if (!selectedType) return []
    return getInspectorExtensions(selectedType).filter(
      (extension) => !extension.pluginId || installedPlugins.includes(extension.pluginId),
    )
  }, [selectedType, installedPlugins, registryVersion])

  // Which extension's content fills the card body (extension mode). The two
  // expanded modes are EITHER/OR: extension mode replaces the regular
  // controls; null shows the regular controls with no extension sections.
  // See `lib/inspector-card-mode.ts` for the transition table.
  const [activeExtensionId, setActiveExtensionId] = useState<string | null>(null)
  // Stale ids (kind changed, plugin gated off) fall back to regular mode.
  const activeExtension = resolveActiveExtension(activeExtensionId, extensions)

  // The whole panel is collapsed to just its header by default; the chevron
  // expands it to reveal the inspector body. Keep the desktop value shared
  // across inspector swaps (roof ↔ segment, etc.) so navigating between
  // related panels preserves whether the user left the inspector open.
  const [collapsed, setCollapsedState] = useState(desktopInspectorCollapsed)

  const setCollapsed = useCallback(
    (next: boolean | ((previous: boolean) => boolean)) => {
      setCollapsedState((previous) => {
        const resolved = typeof next === 'function' ? next(previous) : next
        desktopInspectorCollapsed = resolved
        return resolved
      })
    },
    [],
  )

  const applyMode = useCallback(
    (next: { collapsed: boolean; activeExtensionId: string | null }) => {
      setCollapsed(next.collapsed)
      setActiveExtensionId(next.activeExtensionId)
    },
    [setCollapsed],
  )

  // Chevron / header press — collapsed → regular, regular → collapsed,
  // extension mode → regular (exit the extension first, stay expanded).
  const handleCardToggle = useCallback(() => {
    applyMode(toggleCard({ collapsed, activeExtensionId }))
  }, [applyMode, collapsed, activeExtensionId])

  // Folding the card forgets the active extension — extension mode is a
  // one-shot affordance of the header icon, not sticky panel state.
  useEffect(() => {
    if (collapsed) setActiveExtensionId(null)
  }, [collapsed])

  // Drag-to-reposition from the header. `offset` is a translation applied on
  // top of the default `top-20 right-4` anchor; null until first dragged.
  // Dragging is clamped so no edge of the panel leaves the viewport.
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef<{
    startX: number
    startY: number
    baseX: number
    baseY: number
    rectLeft: number
    rectTop: number
    width: number
    height: number
    minLeft: number
    maxLeft: number
    minTop: number
    maxTop: number
    moved: boolean
  } | null>(null)

  const handleHeaderPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Buttons (close / reset / collapse) handle their own clicks.
      if ((e.target as HTMLElement).closest('button')) return
      const rect = panelRef.current?.getBoundingClientRect()
      if (!rect) return
      const bounds = getDragBounds(panelRef.current)
      const base = offset ?? { x: 0, y: 0 }
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        baseX: base.x,
        baseY: base.y,
        rectLeft: rect.left,
        rectTop: rect.top,
        width: rect.width,
        height: rect.height,
        minLeft: bounds.left + DRAG_MARGIN,
        maxLeft: bounds.right - rect.width - DRAG_MARGIN,
        minTop: bounds.top + DRAG_MARGIN,
        maxTop: bounds.bottom - rect.height - DRAG_MARGIN,
        moved: false,
      }
      setIsDragging(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [offset],
  )

  const handleHeaderPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    // Hold position until the press clearly becomes a drag, so a click can
    // still toggle collapse.
    if (!drag.moved && Math.hypot(dx, dy) <= CLICK_SLOP) return
    drag.moved = true
    const left = clamp(drag.rectLeft + dx, drag.minLeft, drag.maxLeft)
    const top = clamp(drag.rectTop + dy, drag.minTop, drag.maxTop)
    setOffset({ x: drag.baseX + (left - drag.rectLeft), y: drag.baseY + (top - drag.rectTop) })
  }, [])

  const handleHeaderPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      setIsDragging(false)
      e.currentTarget.releasePointerCapture(e.pointerId)
      // A press that never turned into a drag is a click → same mode toggle
      // as the chevron.
      if (!drag.moved) handleCardToggle()
    },
    [handleCardToggle],
  )

  // Expanding can grow the panel past an edge if it was dragged there while
  // collapsed — nudge it back inside the viewer bounds.
  useLayoutEffect(() => {
    if (isMobile || collapsed) return
    const el = panelRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const bounds = getDragBounds(el)
    const left = clamp(rect.left, bounds.left + DRAG_MARGIN, bounds.right - rect.width - DRAG_MARGIN)
    const top = clamp(rect.top, bounds.top + DRAG_MARGIN, bounds.bottom - rect.height - DRAG_MARGIN)
    const dx = left - rect.left
    const dy = top - rect.top
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      setOffset((prev) => ({ x: (prev?.x ?? 0) + dx, y: (prev?.y ?? 0) + dy }))
    }
  }, [collapsed, isMobile])

  return (
    <div
      className={cn(
        isMobile
          ? 'flex h-full w-full flex-col overflow-hidden bg-transparent dark:text-foreground'
          // Cap height at `100dvh - 154px` so a tall panel's bottom edge
          // aligns flush with the top of the floating bottom action bar.
          // Combined with `top-20` (80px), the panel's bottom sits at
          // `100dvh - 74px` — just clearing the bar without leaving a
          // visible gap. The inner `flex-1 overflow-y-auto` content area
          // (below) handles vertical scrolling when content exceeds the
          // cap.
          : 'pointer-events-auto fixed top-20 right-4 z-50 flex max-h-[calc(100dvh-154px)] flex-col overflow-hidden rounded-xl border border-border/50 bg-sidebar/95 shadow-2xl backdrop-blur-xl dark:text-foreground',
        className,
      )}
      ref={panelRef}
      style={
        isMobile
          ? undefined
          : {
              width,
              transform: offset ? `translate(${offset.x}px, ${offset.y}px)` : undefined,
            }
      }
    >
      {/* Header — desktop only; mobile sheet provides its own header. Doubles
          as the drag handle (grip in the middle) for repositioning the panel. */}
      {!isMobile && (
        <div
          className={cn(
            'relative flex select-none items-center justify-between px-3 py-3',
            !collapsed && 'border-border/50 border-b',
            isDragging ? 'cursor-grabbing' : 'cursor-grab',
          )}
          onPointerDown={handleHeaderPointerDown}
          onPointerMove={handleHeaderPointerMove}
          onPointerUp={handleHeaderPointerUp}
        >
          <div className="flex min-w-0 items-center gap-2">
            {onBack && (
              <button
                className="mr-1 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[#3e3e3e] hover:text-foreground"
                onClick={onBack}
                type="button"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            {icon &&
              (typeof icon === 'string' ? (
                <Image
                  alt=""
                  className="shrink-0 object-contain"
                  height={16}
                  src={icon}
                  width={16}
                />
              ) : (
                <span className="flex shrink-0 items-center justify-center">{icon}</span>
              ))}
            <h2 className="truncate font-semibold text-foreground text-sm tracking-tight">
              {title}
            </h2>
          </div>

          {/* Centered grip — purely a visual drag affordance. */}
          <GripHorizontal className="-translate-x-1/2 pointer-events-none absolute left-1/2 h-4 w-4 text-muted-foreground/40" />

          <div className="flex items-center gap-1">
            {onReset && (
              <button
                className="flex h-7 w-7 items-center justify-center rounded-md bg-[#2C2C2E] text-muted-foreground transition-colors hover:bg-[#3e3e3e] hover:text-foreground"
                onClick={onReset}
                type="button"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            )}
            {/* Extension mode buttons — one icon per registered inspector
                extension, left of the chevron. Click swaps the card body to
                ONLY that extension's content (either/or with the regular
                controls); the active icon (highlighted) or the chevron
                returns to the regular controls. */}
            {extensions.map((extension) => {
              const isActive = !collapsed && activeExtensionId === extension.id
              return (
                <button
                  aria-label={isActive ? `Close ${extension.title}` : `Open ${extension.title}`}
                  aria-pressed={isActive}
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-md transition-colors',
                    isActive
                      ? 'bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30'
                      : 'bg-[#2C2C2E] text-muted-foreground hover:bg-[#3e3e3e] hover:text-foreground',
                  )}
                  key={extension.id}
                  onClick={() =>
                    applyMode(toggleExtension({ collapsed, activeExtensionId }, extension.id))
                  }
                  title={extension.title}
                  type="button"
                >
                  {renderExtensionIcon(extension.icon)}
                </button>
              )
            })}
            <button
              aria-expanded={!collapsed}
              aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
              className="flex h-7 w-7 items-center justify-center rounded-md bg-[#2C2C2E] text-muted-foreground transition-colors hover:bg-[#3e3e3e] hover:text-foreground"
              onClick={handleCardToggle}
              type="button"
            >
              <ChevronDown
                className={cn('h-4 w-4 transition-transform', collapsed ? '' : 'rotate-180')}
              />
            </button>
            {onClose && (
              <button
                className="flex h-7 w-7 items-center justify-center rounded-md bg-[#2C2C2E] text-muted-foreground transition-colors hover:bg-[#3e3e3e] hover:text-foreground"
                onClick={onClose}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Content — hidden while the panel is collapsed (desktop). The two
          expanded modes are EITHER/OR: extension mode renders ONLY that
          extension's content; regular mode renders ONLY the kind's own
          controls (`children`). A stale extension id falls back to regular
          via `resolveActiveExtension`. */}
      {!(collapsed && !isMobile) && (
        <div className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto">
          {!isMobile && selectedId && activeExtension ? (
            <InspectorExtensionSection
              extension={activeExtension}
              key={activeExtension.id}
              nodeId={selectedId}
            />
          ) : (
            <>
              {children}
              {/* Mobile sheet has no header icons to swap modes — keep the
                  plugin sections appended after the kind's controls there. */}
              {isMobile &&
                selectedId &&
                extensions.map((extension) => (
                  <InspectorExtensionSection
                    defaultExpanded={false}
                    extension={extension}
                    key={extension.id}
                    nodeId={selectedId}
                  />
                ))}
            </>
          )}
        </div>
      )}

      {resolvedFooter && !(collapsed && !isMobile) && (
        <div className="shrink-0 border-border/50 border-t p-3">{resolvedFooter}</div>
      )}
    </div>
  )
}

// ─── Plugin inspector extensions ──────────────────────────────────────

/** 16px icon for an extension's header button — mirrors the parametric
 *  inspector's `renderIcon` (plain <img> so no next/image server deps). */
function renderExtensionIcon(ref: IconRef): React.ReactNode {
  if (ref.kind === 'url') {
    return <img alt="" className="h-4 w-4 shrink-0 object-contain" src={ref.src} />
  }
  if (ref.kind === 'iconify') {
    return <Icon height={16} icon={ref.name} width={16} />
  }
  if (ref.kind === 'svg') {
    return (
      <svg height={16} viewBox={ref.viewBox} width={16}>
        <path d={ref.path} fill="currentColor" />
      </svg>
    )
  }
  const LazyIcon = lazy(ref.module)
  return (
    <Suspense fallback={null}>
      <LazyIcon />
    </Suspense>
  )
}

// `React.lazy` once per loader so the resolved component keeps a stable
// identity across renders — same WeakMap pattern as `resolveCustomPanel`
// in parametric-inspector.tsx.
const extensionComponentCache = new WeakMap<
  InspectorExtension['component'],
  ComponentType<{ node: AnyNode }>
>()

function resolveExtensionComponent(
  extension: InspectorExtension,
): ComponentType<{ node: AnyNode }> {
  const cached = extensionComponentCache.get(extension.component)
  if (cached) return cached
  // `LazyComponent` is prop-agnostic; the inspector-extension contract is
  // that the default export accepts `{ node }` (see the type's docs).
  const Comp = lazy(extension.component) as unknown as ComponentType<{ node: AnyNode }>
  extensionComponentCache.set(extension.component, Comp)
  return Comp
}

/**
 * One plugin-contributed inspector section. Subscribes to the full node —
 * the section body reflects any edit — and hands it to the extension's
 * lazy component inside its own error boundary so a crashing plugin
 * section can't take down the inspector card. On desktop this is the
 * card's SOLE body while its extension is active (either/or with the
 * regular controls); the mobile sheet appends it after them instead.
 */
function InspectorExtensionSection({
  defaultExpanded = true,
  extension,
  nodeId,
}: {
  defaultExpanded?: boolean
  extension: InspectorExtension
  nodeId: AnyNodeId
}) {
  const node = useScene((s) => s.nodes[nodeId])
  if (!node) return null
  const Extension = resolveExtensionComponent(extension)
  return (
    <PanelSection defaultExpanded={defaultExpanded} title={extension.title}>
      <ErrorBoundary
        fallback={
          <p className="p-1 text-muted-foreground text-xs">
            “{extension.title}” hit an error and was unloaded for this session.
          </p>
        }
      >
        <Suspense fallback={null}>
          <Extension node={node} />
        </Suspense>
      </ErrorBoundary>
    </PanelSection>
  )
}
