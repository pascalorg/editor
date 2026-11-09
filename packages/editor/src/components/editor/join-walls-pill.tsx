'use client'

import { Link2 } from 'lucide-react'

/**
 * The "Join walls" action on an open wall end — shared by the floor plan and
 * the 3D view so both offer the same pill. A refusal ("A door or window is in
 * the way") sits in front of the button.
 */
export function JoinWallsPill({
  onHoverEnd,
  onHoverStart,
  onJoin,
  refusal,
}: {
  onHoverEnd: () => void
  onHoverStart: () => void
  onJoin: () => void
  refusal: string | null
}) {
  return (
    <div
      className="pointer-events-auto flex items-center gap-1 whitespace-nowrap rounded-full border border-border bg-background/95 p-1 text-xs shadow-xl backdrop-blur-md"
      data-open-wall-end=""
      onPointerDown={(event) => event.stopPropagation()}
      onPointerEnter={onHoverStart}
      onPointerLeave={onHoverEnd}
      onPointerUp={(event) => event.stopPropagation()}
    >
      {refusal ? <span className="px-2 text-muted-foreground">{refusal}</span> : null}
      <button
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium text-foreground transition-colors hover:bg-accent"
        onClick={(event) => {
          event.stopPropagation()
          onJoin()
        }}
        type="button"
      >
        <Link2 className="h-3.5 w-3.5" />
        Join walls
      </button>
    </div>
  )
}
