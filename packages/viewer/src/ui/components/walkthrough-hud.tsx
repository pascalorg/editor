'use client'

import { usePascalI18n } from '@pascal-app/core'
import { type ReactNode, useMemo } from 'react'
import { cn } from '../lib/cn'
import { displayRoomName } from '../lib/room-name-messages'
import type { WalkthroughInteract } from '../store/use-first-person-hud'

/** A control shown in the HUD's key strip: its keys (as printed on the keycaps) and what they do. */
export type WalkthroughHint = { keys: readonly string[]; action: string }

export type WalkthroughHudProps = {
  floorLabel?: string | null
  zoneLabel?: string | null
  interact?: WalkthroughInteract
  /** Movement controls listed before the cursor and exit pills. */
  hints?: readonly WalkthroughHint[]
  /** Pointer lock temporarily released (OS screenshot) — the pill flips to
   *  "Click to resume" and lets clicks fall through to the canvas. */
  suspended?: boolean
  onExit?: () => void
  children?: ReactNode
}

/** The centered walkthrough pointer: a dot that grows into a green ring over
 *  an interactable (door / window / elevator). Also mounted by the snapshot
 *  capture overlay so walk / drone framing keeps the same E-to-open pointer. */
export function WalkthroughCrosshair({ interact }: { interact: WalkthroughInteract }) {
  return (
    <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
      <div
        className={cn(
          'rounded-full transition-all duration-150',
          interact
            ? 'h-4 w-4 border-2 border-emerald-400 bg-emerald-400/10'
            : 'h-1.5 w-1.5 bg-white/80 shadow-[0_0_2px_rgba(0,0,0,0.6)]',
        )}
      />
    </div>
  )
}

export function WalkthroughHud({
  floorLabel,
  zoneLabel,
  interact = null,
  hints,
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
            <WalkthroughZoneName name={zoneLabel} />
          </div>
        )}
        {children}
      </div>

      <WalkthroughCrosshair interact={interact} />

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
            {hints && hints.length > 0 ? (
              <div className={pillClass}>
                {hints.map(({ keys, action }, index) => (
                  <span className="flex items-center gap-1.5" key={action}>
                    {index > 0 && <span className="text-muted-foreground/60">·</span>}
                    {keys.map((key, keyIndex) => (
                      <span className="flex items-center gap-1" key={key}>
                        {keyIndex > 0 && <span className="text-muted-foreground/60">/</span>}
                        <kbd className={kbdClass}>{key}</kbd>
                      </span>
                    ))}
                    {action}
                  </span>
                ))}
              </div>
            ) : null}
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

/** The drone's key strip: the movement controls of the viewer's `DroneController`. */
function useDroneHints(): readonly WalkthroughHint[] {
  const i18n = usePascalI18n()
  return useMemo(
    () => [
      {
        keys: ['WASD'],
        action: i18n._({ id: 'editor.walkthroughHud.drone.move', message: 'move' }),
      },
      {
        keys: ['Space', 'E'],
        action: i18n._({ id: 'editor.walkthroughHud.drone.up', message: 'up' }),
      },
      {
        keys: ['Q'],
        action: i18n._({ id: 'editor.walkthroughHud.drone.down', message: 'down' }),
      },
      {
        keys: ['Shift'],
        action: i18n._({ id: 'editor.walkthroughHud.drone.boost', message: 'boost' }),
      },
      {
        keys: ['Alt'],
        action: i18n._({ id: 'editor.walkthroughHud.drone.slow', message: 'slow' }),
      },
    ],
    [i18n],
  )
}

/** The walkthrough HUD for the drone: the plain pointer dot and the flight keys, no room or door prompts. */
export function DroneHud({
  suspended,
  onExit,
  children,
}: Pick<WalkthroughHudProps, 'suspended' | 'onExit' | 'children'>) {
  return (
    <WalkthroughHud hints={useDroneHints()} onExit={onExit} suspended={suspended}>
      {children}
    </WalkthroughHud>
  )
}

/** The room the walker is in, in the UI language (the scene keeps its stored name). */
function WalkthroughZoneName({ name }: { name: string }) {
  const i18n = usePascalI18n()
  return displayRoomName(name, i18n)
}
