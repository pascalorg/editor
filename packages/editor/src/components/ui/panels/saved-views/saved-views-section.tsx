'use client'

import { type SavedViewId, sortSavedViews, useScene } from '@pascal-app/core'
import { Camera, ChevronDown, ChevronUp, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { LocalizedContent } from '../../../../lib/i18n'
import { cn } from '../../../../lib/utils'
import {
  applySavedView,
  captureSavedView,
  updateSavedViewFromCurrentState,
} from '../../../../lib/saved-views'

/**
 * Named camera + visibility + cut bookmarks. SketchUp calls these "Scenes";
 * that word is the scene graph here, so they are saved views.
 *
 * Unlike `CollectionsSection` this renders even when empty — the whole point is
 * the button that creates the first one.
 */
export function SavedViewsSection() {
  const savedViews = useScene((s) => s.savedViews)
  const deleteSavedView = useScene((s) => s.deleteSavedView)
  const updateSavedView = useScene((s) => s.updateSavedView)
  const moveSavedView = useScene((s) => s.moveSavedView)
  const [activeId, setActiveId] = useState<SavedViewId | null>(null)
  const [editingId, setEditingId] = useState<SavedViewId | null>(null)

  const list = sortSavedViews(savedViews)

  const handleCapture = () => {
    const id = captureSavedView(`View ${list.length + 1}`)
    if (id) setActiveId(id)
  }

  return (
    <LocalizedContent>
      <div className="flex flex-col border-border/40 border-b">
      <div className="flex items-center gap-1.5 px-3 pt-3 pb-1.5">
        <Camera className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-semibold text-muted-foreground text-xs tracking-tight">
          Saved views
        </span>
        <button
          aria-label="Save current view"
          className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground"
          onClick={handleCapture}
          title="Save current view"
          type="button"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {list.length === 0 ? (
        <p className="px-3 pb-2.5 text-[11px] text-muted-foreground/60">
          Save the camera, visibility and active section as a view you can return to.
        </p>
      ) : (
        <ul className="flex flex-col pb-2">
          {list.map((view, index) => (
            <li
              className={cn(
                'group flex items-center gap-1.5 px-3 py-1 transition-colors hover:bg-foreground/5',
                activeId === view.id && 'bg-foreground/5',
              )}
              key={view.id}
            >
              {editingId === view.id ? (
                <input
                  autoFocus
                  className="min-w-0 flex-1 rounded bg-foreground/10 px-1 py-0.5 text-foreground text-xs outline-none"
                  defaultValue={view.name}
                  onBlur={(event) => {
                    const name = event.target.value.trim()
                    if (name && name !== view.name) updateSavedView(view.id, { name })
                    setEditingId(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                    if (event.key === 'Escape') setEditingId(null)
                    // The editor's global shortcuts listen on window; without
                    // this every keystroke here would also drive a tool.
                    event.stopPropagation()
                  }}
                />
              ) : (
                <button
                  className="min-w-0 flex-1 truncate text-left text-foreground text-xs"
                  onClick={() => {
                    if (applySavedView(view.id)) setActiveId(view.id)
                  }}
                  onDoubleClick={() => setEditingId(view.id)}
                  title={view.name}
                  type="button"
                >
                  {view.name}
                </button>
              )}

              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <button
                  aria-label="Move view up"
                  className="rounded p-0.5 text-muted-foreground/50 transition-colors hover:bg-foreground/10 hover:text-foreground disabled:opacity-25"
                  disabled={index === 0}
                  onClick={() => moveSavedView(index, index - 1)}
                  title="Move up"
                  type="button"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  aria-label="Move view down"
                  className="rounded p-0.5 text-muted-foreground/50 transition-colors hover:bg-foreground/10 hover:text-foreground disabled:opacity-25"
                  disabled={index === list.length - 1}
                  onClick={() => moveSavedView(index, index + 1)}
                  title="Move down"
                  type="button"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                <button
                  aria-label="Update view from current state"
                  className="rounded p-0.5 text-muted-foreground/50 transition-colors hover:bg-foreground/10 hover:text-foreground"
                  onClick={() => updateSavedViewFromCurrentState(view.id)}
                  title="Update from current view"
                  type="button"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
                <button
                  aria-label="Delete view"
                  className="rounded p-0.5 text-muted-foreground/50 transition-colors hover:bg-foreground/10 hover:text-destructive"
                  onClick={() => {
                    deleteSavedView(view.id)
                    if (activeId === view.id) setActiveId(null)
                  }}
                  title="Delete view"
                  type="button"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      </div>
    </LocalizedContent>
  )
}
