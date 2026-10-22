'use client'

import { useEditor } from '@pascal-app/editor'
import { Eye, Pencil, Share2 } from 'lucide-react'
import Link from 'next/link'
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react'
import { PascalMark } from './app-shell'
import { SharePanel } from './share-panel'

interface EditorNavbarProps {
  sceneId: string
  name: string
  /** Persists a new project name; resolves once the server has answered. */
  onRename: (name: string) => Promise<void>
}

export function EditorNavbar({ sceneId, name, onRename }: EditorNavbarProps) {
  const [editing, setEditing] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const shareAnchorRef = useRef<HTMLDivElement>(null)
  const closeShare = useCallback(() => setShareOpen(false), [])
  const [draft, setDraft] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)
  // Escape cancels; the blur it causes must not save.
  const cancelledRef = useRef(false)

  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  const startEditing = () => {
    cancelledRef.current = false
    setDraft(name)
    setEditing(true)
  }

  const commit = () => {
    setEditing(false)
    if (cancelledRef.current) return
    const trimmed = draft.trim()
    if (trimmed && trimmed !== name) void onRename(trimmed)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Keep editor shortcuts (delete, undo, tool keys) out of the title field.
    event.stopPropagation()
    if (event.key === 'Enter') {
      event.preventDefault()
      inputRef.current?.blur()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cancelledRef.current = true
      inputRef.current?.blur()
    }
  }

  return (
    <nav className="flex h-12 shrink-0 items-center gap-2 border-border/30 border-b bg-sidebar px-2 lg:px-3">
      <div className="flex min-w-0 items-center gap-1.5 lg:gap-2">
        <Link
          aria-label="All projects"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-accent"
          href="/"
          title="All projects"
        >
          <PascalMark />
        </Link>

        <div className="h-5 w-px shrink-0 bg-border/50" />

        <div className="min-w-0 max-w-40 lg:max-w-72">
          {editing ? (
            <input
              aria-label="Project name"
              className="h-7 w-full rounded-md bg-accent/50 px-2 py-0 font-medium text-foreground text-sm outline-none ring-1 ring-primary/50 focus:ring-primary"
              maxLength={200}
              onBlur={commit}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              ref={inputRef}
              value={draft}
            />
          ) : (
            <button
              className="group/title flex h-7 max-w-full items-center gap-1.5 rounded-md px-2 text-left transition-colors hover:bg-accent/50"
              onClick={startEditing}
              title="Rename project"
              type="button"
            >
              <span className="truncate font-medium text-sm">{name}</span>
              <Pencil className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/title:opacity-100" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1" />

      <button
        className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 font-medium text-sm transition-colors hover:bg-accent"
        onClick={() => useEditor.getState().setPreviewMode(true)}
        type="button"
      >
        <Eye className="h-4 w-4 shrink-0" />
        <span className="hidden sm:inline">Preview</span>
      </button>

      <div className="relative" ref={shareAnchorRef}>
        <button
          aria-expanded={shareOpen}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 font-medium text-sm transition-colors hover:bg-accent"
          onClick={() => setShareOpen((open) => !open)}
          type="button"
        >
          <Share2 className="h-4 w-4 shrink-0" />
          <span className="hidden sm:inline">Share</span>
        </button>
        {shareOpen && (
          <SharePanel anchorRef={shareAnchorRef} onClose={closeShare} sceneId={sceneId} />
        )}
      </div>
    </nav>
  )
}
