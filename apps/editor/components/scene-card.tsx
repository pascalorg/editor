'use client'

import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { PascalMark, PRIMARY_PILL, SECONDARY_PILL } from './app-shell'

export interface SceneCardData {
  id: string
  name: string
  version: number
  nodeCount: number
  thumbnailUrl: string | null
  updatedAt: string
  updatedLabel: string
}

type Dialog = 'rename' | 'delete' | null

export function SceneCard({ scene }: { scene: SceneCardData }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [thumbnailFailed, setThumbnailFailed] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const openDialog = (next: Dialog) => {
    setMenuOpen(false)
    setDialog(next)
  }

  return (
    <li className="group relative">
      <Link
        className="block rounded-xl border border-border/50 bg-background p-2 transition-colors hover:border-border hover:bg-accent"
        href={`/project/${scene.id}`}
      >
        <div className="flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-accent">
          {scene.thumbnailUrl && !thumbnailFailed ? (
            <img
              alt=""
              className="h-full w-full object-cover"
              onError={() => setThumbnailFailed(true)}
              // A load that failed before hydration never reaches `onError`.
              ref={(img) => {
                if (img?.complete && img.naturalWidth === 0) setThumbnailFailed(true)
              }}
              src={scene.thumbnailUrl}
            />
          ) : (
            <PascalMark className="h-8 w-8 opacity-15" />
          )}
        </div>
        <div className="px-1.5 pt-2.5 pb-1">
          <h2 className="truncate pr-8 font-medium text-sm">{scene.name}</h2>
          <p className="mt-0.5 text-muted-foreground text-xs">
            {scene.nodeCount} {scene.nodeCount === 1 ? 'node' : 'nodes'} · Updated{' '}
            <time dateTime={scene.updatedAt}>{scene.updatedLabel}</time>
          </p>
        </div>
      </Link>

      <div className="absolute right-3 bottom-3" ref={menuRef}>
        <button
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label={`Actions for ${scene.name}`}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground',
            menuOpen && 'bg-background text-foreground',
          )}
          onClick={() => setMenuOpen((open) => !open)}
          type="button"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
        {menuOpen && (
          <div
            className="absolute right-0 bottom-9 z-10 min-w-36 rounded-xl border border-border bg-popover p-1 text-sm shadow-2xl"
            role="menu"
          >
            <button
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-accent"
              onClick={() => openDialog('rename')}
              role="menuitem"
              type="button"
            >
              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
              Rename
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-destructive hover:bg-destructive/10"
              onClick={() => openDialog('delete')}
              role="menuitem"
              type="button"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </div>
        )}
      </div>

      {dialog === 'rename' && <RenameDialog onClose={() => setDialog(null)} scene={scene} />}
      {dialog === 'delete' && <DeleteDialog onClose={() => setDialog(null)} scene={scene} />}
    </li>
  )
}

const CONFLICT_MESSAGE = 'This project changed since the page loaded. Reload and try again.'

/** Opens a native modal dialog on mount; Escape, backdrop and Cancel all end in `onClose`. */
function useModal(onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const handleClose = () => onCloseRef.current()
    dialog.addEventListener('close', handleClose)
    if (!dialog.open) dialog.showModal()
    return () => dialog.removeEventListener('close', handleClose)
  }, [])
  return ref
}

function ModalFrame({
  children,
  dialogRef,
  title,
}: {
  children: React.ReactNode
  dialogRef: React.RefObject<HTMLDialogElement | null>
  title: string
}) {
  return (
    <dialog
      className="m-auto w-full max-w-sm rounded-2xl border border-border bg-background p-5 text-foreground shadow-2xl backdrop:bg-black/60"
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close()
      }}
      ref={dialogRef}
    >
      <h2 className="font-semibold text-base">{title}</h2>
      {children}
    </dialog>
  )
}

function RenameDialog({ scene, onClose }: { scene: SceneCardData; onClose: () => void }) {
  const router = useRouter()
  const dialogRef = useModal(onClose)
  const [name, setName] = useState(scene.name)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || trimmed === scene.name) {
      dialogRef.current?.close()
      return
    }
    setPending(true)
    setError(null)
    try {
      const response = await fetch(`/api/scenes/${scene.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'If-Match': `"${scene.version}"` },
        body: JSON.stringify({ name: trimmed }),
      })
      if (response.status === 409) {
        setError(CONFLICT_MESSAGE)
        return
      }
      if (!response.ok) {
        setError(`Rename failed (${response.status})`)
        return
      }
      dialogRef.current?.close()
      router.refresh()
    } catch {
      setError('Could not reach the editor.')
    } finally {
      setPending(false)
    }
  }

  return (
    <ModalFrame dialogRef={dialogRef} title="Rename project">
      <form className="mt-4 flex flex-col gap-3" onSubmit={handleSubmit}>
        <input
          aria-label="Project name"
          // biome-ignore lint/a11y/noAutofocus: the dialog exists to edit this field
          autoFocus
          className="rounded-lg border border-input bg-accent px-3 py-2 text-sm outline-none focus:border-ring"
          maxLength={200}
          onChange={(event) => setName(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          required
          value={name}
        />
        {error && <p className="text-destructive text-xs">{error}</p>}
        <div className="mt-1 flex justify-end gap-2">
          <button
            className={SECONDARY_PILL}
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            Cancel
          </button>
          <button className={PRIMARY_PILL} disabled={pending || !name.trim()} type="submit">
            {pending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </ModalFrame>
  )
}

function DeleteDialog({ scene, onClose }: { scene: SceneCardData; onClose: () => void }) {
  const router = useRouter()
  const dialogRef = useModal(onClose)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleDelete() {
    setPending(true)
    setError(null)
    try {
      const response = await fetch(`/api/scenes/${scene.id}`, {
        method: 'DELETE',
        headers: { 'If-Match': `"${scene.version}"` },
      })
      if (response.status === 409) {
        setError(CONFLICT_MESSAGE)
        return
      }
      if (!response.ok && response.status !== 404) {
        setError(`Delete failed (${response.status})`)
        return
      }
      dialogRef.current?.close()
      router.refresh()
    } catch {
      setError('Could not reach the editor.')
    } finally {
      setPending(false)
    }
  }

  return (
    <ModalFrame dialogRef={dialogRef} title="Delete project?">
      <p className="mt-2 text-muted-foreground text-sm">
        “{scene.name}” will be removed from this editor, along with everything in it.
      </p>
      {error && <p className="mt-3 text-destructive text-xs">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button className={SECONDARY_PILL} onClick={() => dialogRef.current?.close()} type="button">
          Cancel
        </button>
        <button
          className="inline-flex items-center justify-center rounded-lg bg-destructive px-4 py-1.5 font-medium text-sm text-white transition-colors hover:bg-destructive/90 disabled:opacity-50"
          disabled={pending}
          onClick={handleDelete}
          type="button"
        >
          {pending ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </ModalFrame>
  )
}
