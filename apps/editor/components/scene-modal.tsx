'use client'

import { X } from 'lucide-react'
import { type ReactNode, useEffect } from 'react'
import { cn } from '@/lib/utils'

/**
 * A small self-contained modal used by the scene-card actions.
 *
 * The `@pascal-app/editor` dialog primitive isn't on the package barrel and
 * its `exports` map blocks deep paths, so the scenes rail carries its own:
 * a fixed overlay that closes on Escape and on a backdrop click. Focus
 * trapping is intentionally omitted — these are short, single-purpose dialogs.
 */
export function SceneModal({
  title,
  onClose,
  children,
  className,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  className?: string
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        aria-modal="true"
        className={cn(
          'flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl',
          className,
        )}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="flex items-center justify-between gap-2 border-border/60 border-b px-4 py-3">
          <h2 className="font-semibold text-sm">{title}</h2>
          <button
            aria-label="Kapat"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}
