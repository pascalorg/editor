'use client'

import { type GroundMode, useViewer } from '@pascal-app/viewer'
import { ArrowLeftRight, Check, Columns2, MoreHorizontal, Pin, PinOff, X } from 'lucide-react'
import { type ReactNode, useEffect, useRef } from 'react'
import { useIsMobile } from '../../../hooks/use-mobile'
import { type EditorViewDescriptor, isSceneView, isViewPinned } from '../../../lib/editor-views'
import { cn } from '../../../lib/utils'
import useEditor from '../../../store/use-editor'
import type { ViewPaneIndex } from '../../../store/view-layout'
import { IconRefGlyph } from '../../ui/icon-ref'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/primitives/dropdown-menu'
import { PLUGINS_VIEW_ID, useActiveViewLayout, useEditorViews } from './use-editor-views'

const GROUP = cn(
  'pointer-events-auto inline-flex h-8 shrink-0 items-stretch overflow-hidden rounded-[10px]',
  'border border-border bg-background/90',
)
const SEGMENT =
  'flex items-center justify-center gap-1.5 px-2.5 font-medium text-xs transition-colors'
const ACTIVE = 'bg-black/6 dark:bg-white/10 text-foreground'
const IDLE =
  'text-muted-foreground/70 hover:bg-black/5 dark:hover:bg-white/8 hover:text-muted-foreground'

/** The views of one pane: its pinned views, the one it shows, and a menu with the rest. */
export function ViewTabs({ pane, className }: { pane: ViewPaneIndex; className?: string }) {
  const layout = useActiveViewLayout()
  const views = useEditorViews()
  const pinnedViews = useEditor((s) => s.pinnedViews)
  const current = layout.panes[pane]
  const tabs = views.filter((view) => view.id === current || isViewPinned(view, pinnedViews))
  const activeIndex = tabs.findIndex((view) => view.id === current)
  const tabList = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const list = tabList.current
    const tab = list?.children.item(activeIndex)
    if (!list || !(tab instanceof HTMLElement)) return
    const reveal = () => {
      const bounds = list.getBoundingClientRect()
      const target = tab.getBoundingClientRect()
      if (target.right > bounds.right) list.scrollLeft += target.right - bounds.right
      else if (target.left < bounds.left) list.scrollLeft -= bounds.left - target.left
    }
    reveal()
    const observer = new ResizeObserver(reveal)
    observer.observe(list)
    observer.observe(tab)
    return () => observer.disconnect()
  }, [activeIndex])

  return (
    <div className={cn(GROUP, 'min-w-0 shrink', className)}>
      <div
        aria-label={`Pane ${pane + 1} views`}
        className="flex min-w-0 overflow-x-auto [scrollbar-width:none]"
        role="tablist"
        ref={tabList}
      >
        {tabs.map((view) => (
          <div
            className={cn('group flex shrink-0 items-center', view.id === current ? ACTIVE : IDLE)}
            key={view.id}
          >
            <button
              aria-selected={view.id === current}
              className={cn(
                SEGMENT,
                'outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                view.onClose && 'pr-1',
              )}
              onClick={() => useEditor.getState().setPaneView(pane, view.id)}
              onKeyDown={(event) => {
                if (event.key === 'Delete' && view.onClose) {
                  event.preventDefault()
                  view.onClose()
                  return
                }
                const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
                if (!offset && event.key !== 'Home' && event.key !== 'End') return
                event.preventDefault()
                const index = tabs.indexOf(view)
                const target =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? tabs.length - 1
                      : (index + offset + tabs.length) % tabs.length
                const next = tabs[target]
                if (next) {
                  useEditor.getState().setPaneView(pane, next.id)
                  const buttons = event.currentTarget
                    .closest('[role="tablist"]')
                    ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                  buttons?.[target]?.focus()
                }
              }}
              tabIndex={view.id === current ? 0 : -1}
              title={view.label}
              role="tab"
              type="button"
            >
              <IconRefGlyph icon={view.icon} size={14} />
              <span className="max-w-36 truncate">{view.label}</span>
            </button>
            {view.onClose && (
              <button
                aria-label={`Close ${view.label}`}
                className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                onClick={view.onClose}
                type="button"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        ))}
      </div>
      <MoreViewsMenu current={current} pane={pane} views={views} />
    </div>
  )
}

const GROUND_MODES = [
  { mode: 'auto', label: 'Auto', title: 'Veil the ground over a level below grade' },
  { mode: 'solid', label: 'Solid', title: 'Keep the ground solid' },
] as const satisfies ReadonlyArray<{ mode: GroundMode; label: string; title: string }>

/**
 * Over a level below grade the ground is veiled so its rooms show, and the bar says so: the
 * person can keep the ground solid instead (Ground: Auto / Solid). The same word covers the
 * ground window — a hillside in the eye's way, veiled only where it hides the house — over
 * a level at grade or only partly below it.
 */
export function GroundModeToggle() {
  const belowGrade = useViewer((s) => s.belowGrade)
  const gradeStanding = useViewer((s) => s.gradeStanding)
  const groundWindowVeiled = useViewer((s) => s.groundWindowVeiled)
  const groundMode = useViewer((s) => s.groundMode)
  if (!(belowGrade || groundWindowVeiled)) return null
  const veiled =
    groundMode === 'auto' &&
    ((belowGrade && gradeStanding !== 'partly-below-grade') || groundWindowVeiled)
  const ground = veiled ? 'veiled' : 'solid'
  const label =
    gradeStanding === 'partly-below-grade'
      ? `Partly below grade · ground ${ground}`
      : gradeStanding === 'below-grade'
        ? `Below grade · ground ${ground}`
        : `Ground ${ground}`
  return (
    <div aria-label="Ground" className={GROUP} role="group">
      <span className="flex items-center px-2.5 text-muted-foreground text-xs">{label}</span>
      {GROUND_MODES.map(({ mode, label, title }) => (
        <button
          aria-pressed={groundMode === mode}
          className={cn(SEGMENT, groundMode === mode ? ACTIVE : IDLE)}
          key={mode}
          onClick={() => useViewer.getState().setGroundMode(mode)}
          title={title}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/** Split toggle and, split, the swap — at the right end of the last pane's bar. */
function SplitControls() {
  const split = useActiveViewLayout().split
  return (
    <div className={GROUP}>
      {split && (
        <button
          aria-label="Swap panes"
          className={cn(SEGMENT, IDLE, 'px-2')}
          onClick={() => useEditor.getState().swapPanes()}
          title="Swap panes"
          type="button"
        >
          <ArrowLeftRight className="h-3 w-3" />
        </button>
      )}
      <button
        aria-pressed={split}
        className={cn(SEGMENT, split ? ACTIVE : IDLE)}
        onClick={() => useEditor.getState().toggleSplit()}
        title={split ? 'Close split (\\)' : 'Split (\\)'}
        type="button"
      >
        <Columns2 className="h-3 w-3" />
        <span>Split</span>
      </button>
    </div>
  )
}

/**
 * The bar row above the stage: one bar per pane, aligned with it — the pane's
 * views on the left (the first pane followed by the host's `leading` content),
 * the split controls at the right end of the last pane.
 */
export function ViewBarRow({ leading }: { leading?: ReactNode }) {
  const layout = useActiveViewLayout()
  const isMobile = useIsMobile()
  useSplitShortcut(!isMobile)
  const panes = layout.split ? ([0, 1] as const) : ([0] as const)
  return (
    <div className="relative h-12 shrink-0">
      {panes.map((pane) => {
        const left = pane === 0 ? 0 : layout.ratio
        const right = pane === 0 && layout.split ? layout.ratio : 1
        const isLast = pane === panes.length - 1
        return (
          <div
            className="absolute inset-y-0 flex min-w-0 items-center gap-2 px-3"
            data-view-bar={pane}
            key={pane}
            style={{ left: `${left * 100}%`, width: `${(right - left) * 100}%` }}
          >
            <ViewTabs pane={pane} />
            {isSceneView(layout.panes[pane]) && <GroundModeToggle />}
            {pane === 0 && leading}
            <span className="flex-1" />
            {isLast && !isMobile && <SplitControls />}
          </div>
        )
      })}
    </div>
  )
}

/**
 * `\` opens or closes the split. Bound here rather than in `useKeyboard`, which
 * stands down outside the edit workspace: the split works in every workspace.
 */
export function useSplitShortcut(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '\\' || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }
      event.preventDefault()
      useEditor.getState().toggleSplit()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}

function MoreViewsMenu({
  pane,
  current,
  views,
}: {
  pane: ViewPaneIndex
  current: string
  views: EditorViewDescriptor[]
}) {
  const pinnedViews = useEditor((s) => s.pinnedViews)
  const setPaneView = useEditor((s) => s.setPaneView)
  const setViewPinned = useEditor((s) => s.setViewPinned)
  const listed = views.filter((view) => view.id !== PLUGINS_VIEW_ID)
  const canBrowse = views.some((view) => view.id === PLUGINS_VIEW_ID)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="More views"
          className={cn(SEGMENT, IDLE, 'shrink-0 px-2')}
          type="button"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-muted-foreground text-xs">Views</DropdownMenuLabel>
        {listed.map((view) => {
          const pinned = isViewPinned(view, pinnedViews)
          return (
            <DropdownMenuItem
              className="gap-2.5"
              key={view.id}
              onSelect={() => setPaneView(pane, view.id)}
            >
              <IconRefGlyph icon={view.icon} size={16} />
              <span className="min-w-0 flex-1 truncate">{view.label}</span>
              {view.id === current && <Check className="h-3.5 w-3.5 text-muted-foreground" />}
              {!isSceneView(view.id) && !view.onClose && !view.alwaysPinned && (
                <button
                  aria-label={pinned ? `Unpin ${view.label}` : `Pin ${view.label}`}
                  aria-pressed={pinned}
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-black/6 dark:hover:bg-white/10',
                    pinned ? 'text-foreground' : 'text-muted-foreground/60',
                  )}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setViewPinned(view.id, !pinned)
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  title={pinned ? 'Unpin from the view bar' : 'Pin to the view bar'}
                  type="button"
                >
                  {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                </button>
              )}
            </DropdownMenuItem>
          )
        })}
        {canBrowse && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2.5"
              onSelect={() => setPaneView(pane, PLUGINS_VIEW_ID)}
            >
              <img alt="" className="h-4 w-4 object-contain" src="/icons/plugins.webp" />
              <span>Browse plugins</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
