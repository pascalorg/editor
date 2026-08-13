'use client'

import Image from 'next/image'
import type { ReactNode } from 'react'

/**
 * Shared class for a top-bar action cell. Exported so callers can style links
 * and buttons identically without re-deriving the rule/padding rhythm.
 */
export const TOP_BAR_ACTION =
  'flex h-full items-center gap-2 border-border border-l-2 px-3.5 font-semibold text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'

export interface EditorTopBarProps {
  /** Project or scene name. */
  title: string
  /** Short status line, set in monospace beside the title. */
  status?: string
  /** Action cells, each styled with `TOP_BAR_ACTION`. */
  actions?: ReactNode
}

export function EditorTopBar({ title, status, actions }: EditorTopBarProps) {
  return (
    <header className="flex h-12 flex-shrink-0 items-stretch border-border border-b-2 bg-background text-foreground">
      <div className="flex w-14 flex-shrink-0 items-center justify-center border-border border-r-2">
        {/* The editor shell is always dark, so the mark is inverted outright
            rather than through a theme-conditional filter. */}
        <Image
          alt="Menart"
          className="h-6 w-6 object-contain"
          height={24}
          src="/menartlogo.webp"
          style={{ filter: 'invert(1)' }}
          width={24}
        />
      </div>

      <div className="flex flex-shrink-0 items-center gap-2 border-border border-r-2 px-4">
        <span className="font-extrabold text-[15px] tracking-[-0.01em]">MENART</span>
        <span className="font-extrabold text-[15px] text-muted-foreground">3D</span>
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-3 px-4">
        <span className="truncate font-semibold text-[14px]">{title}</span>
        {status && (
          <span className="flex-shrink-0 font-mono text-[11px] text-muted-foreground uppercase tracking-[0.06em]">
            {status}
          </span>
        )}
      </div>

      {actions && <div className="flex flex-shrink-0 items-stretch">{actions}</div>}
    </header>
  )
}
