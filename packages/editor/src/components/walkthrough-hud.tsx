'use client'

import type { ReactNode } from 'react'
import { cn } from '../lib/utils'
import type { WalkthroughInteract } from '../store/use-first-person-hud'

export type { WalkthroughInteract } from '../store/use-first-person-hud'

export type WalkthroughHudProps = {
  floorLabel?: string | null
  zoneLabel?: string | null
  interact?: WalkthroughInteract
  /** Pointer lock temporarily released (OS screenshot) — the pill flips to
   *  "Click to resume" and lets clicks fall through to the canvas. */
  suspended?: boolean
  onExit?: () => void
  children?: ReactNode
}

export function WalkthroughHud({
  floorLabel,
  zoneLabel,
  interact = null,
  suspended = false,
  onExit,
  children,
}: WalkthroughHudProps) {
  const kbdClass = 'rounded border border-border/60 bg-white/10 px-1.5 py-0.5 font-mono text-[10px]'
  const pillClass =
    'flex items-center gap-1.5 rounded-full border border-border/40 bg-background/70 px-3 py-1 text-muted-foreground text-xs backdrop-blur-xl'
  const exitContent = (
    <>
      <kbd className={kbdClass}>Esc</kbd>
      to exit
    </>
  )

  return (
    <div className="dark pointer-events-none absolute inset-0 z-30 text-foreground">
      <div className="absolute top-6 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1.5">
        {floorLabel && (
          <div className="font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
            {floorLabel}
          </div>
        )}
        {zoneLabel && (
          <div className="corner-smooth rounded-full border border-border/40 bg-background/80 px-3 py-1 font-medium text-sm shadow-elevation-3 backdrop-blur-xl">
            {zoneLabel}
          </div>
        )}
        {children}
      </div>

      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        <div
          className={cn(
            'rounded-full transition-all duration-150',
            interact
              ? 'h-4 w-4 border-2 border-emerald-400 bg-emerald-400/10'
              : 'h-1.5 w-1.5 bg-white/80 shadow-[0_0_2px_rgba(0,0,0,0.6)]',
          )}
        />
      </div>

      <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2">
        {suspended ? (
          <div className={pillClass}>
            <span className="font-medium text-foreground">Click</span>
            <span>or</span>
            <kbd className={kbdClass}>P</kbd>
            <span>to resume</span>
            <span className="text-muted-foreground/60">·</span>
            {exitContent}
          </div>
        ) : (
          <>
            <div className={pillClass}>
              <kbd className={kbdClass}>P</kbd>
              free cursor
            </div>
            {onExit ? (
              <button
                className={cn(pillClass, 'pointer-events-auto')}
                onClick={onExit}
                type="button"
              >
                {exitContent}
              </button>
            ) : (
              <div className={pillClass}>{exitContent}</div>
            )}
          </>
        )}
      </div>

      {interact && (
        <div className="absolute top-1/2 left-1/2 mt-7 -translate-x-1/2 whitespace-nowrap">
          <div className="corner-smooth flex items-center gap-1.5 rounded-full border border-border/40 bg-background/80 px-3 py-1 text-xs shadow-elevation-3 backdrop-blur-xl">
            <kbd className="rounded border border-border/60 bg-white/10 px-1.5 py-0.5 font-mono text-[10px]">
              E
            </kbd>
            <span className="text-muted-foreground">or click to</span>
            <span className="font-medium">
              {interact.verb} {interact.label}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
