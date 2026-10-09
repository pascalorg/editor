'use client'

import { ArrowLeftRight, Check, Columns2, MoreHorizontal, Pin, PinOff, Plus } from 'lucide-react'
import { useEffect } from 'react'
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

const BAR = cn(
  'pointer-events-auto inline-flex h-8 items-stretch overflow-hidden rounded-[10px]',
  'border border-border bg-background/90 shadow-elevation-4',
)
const SEGMENT =
  'flex items-center justify-center gap-1.5 px-2.5 font-medium text-xs transition-colors'
const ACTIVE = 'bg-white/10 text-foreground'
const IDLE = 'text-muted-foreground/70 hover:bg-white/8 hover:text-muted-foreground'

/**
 * The views of one pane: its pinned views, the one it shows, and a menu with
 * the rest. The last pane also carries the split toggle (and, split, the swap).
 */
export function ViewBar({ pane }: { pane: ViewPaneIndex }) {
  const layout = useActiveViewLayout()
  const views = useEditorViews()
  const pinnedViews = useEditor((s) => s.pinnedViews)
  const isMobile = useIsMobile()
  const current = layout.panes[pane]
  const isLastPane = !layout.split || pane === 1
  const tabs = views.filter((view) => view.id === current || isViewPinned(view, pinnedViews))

  return (
    <div className={BAR} data-view-bar={pane} role="tablist">
      {tabs.map((view) => (
        <button
          aria-selected={view.id === current}
          className={cn(SEGMENT, view.id === current ? ACTIVE : IDLE)}
          key={view.id}
          onClick={() => useEditor.getState().setPaneView(pane, view.id)}
          role="tab"
          type="button"
        >
          <IconRefGlyph icon={view.icon} size={14} />
          <span>{view.label}</span>
        </button>
      ))}
      <MoreViewsMenu current={current} pane={pane} views={views} />
      {isLastPane && !isMobile && (
        <>
          <div className="my-1.5 w-px bg-border/50" />
          {layout.split && (
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
            aria-pressed={layout.split}
            className={cn(SEGMENT, layout.split ? ACTIVE : IDLE)}
            onClick={() => useEditor.getState().toggleSplit()}
            title={layout.split ? 'Close split (\\)' : 'Split (\\)'}
            type="button"
          >
            <Columns2 className="h-3 w-3" />
            <span>Split</span>
          </button>
        </>
      )}
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
        <button aria-label="More views" className={cn(SEGMENT, IDLE, 'px-2')} type="button">
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
              {!isSceneView(view.id) && (
                <button
                  aria-label={pinned ? `Unpin ${view.label}` : `Pin ${view.label}`}
                  aria-pressed={pinned}
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-white/10',
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
              <Plus className="h-4 w-4 text-muted-foreground" />
              <span>Browse plugins</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
