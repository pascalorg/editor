import type { ContextualShortcutHint } from '../../../lib/contextual-help'
import { cn } from '../../../lib/utils'
import { ShortcutToken } from '../primitives/shortcut-token'

function ShortcutSequence({ keys }: { keys: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-0.5">
      {keys.map((key, index) => (
        <div className="flex items-center gap-0.5" key={`${key}-${index}`}>
          {index > 0 ? <span className="text-[9px] text-muted-foreground/70">+</span> : null}
          <ShortcutToken className="h-5 px-1.5 text-[10px]" value={key} />
        </div>
      ))}
    </div>
  )
}

export function ContextualHelperPanel({ hints }: { hints: ContextualShortcutHint[] }) {
  if (hints.length === 0) return null

  return (
    <div className="pointer-events-none fixed top-1/2 right-4 z-40 flex max-w-[260px] -translate-y-1/2 flex-col gap-1.5 rounded-lg border border-border bg-background/95 px-3 py-2.5 shadow-lg backdrop-blur-md">
      {hints.map((hint) => (
        <div
          className={cn(
            'grid min-w-0 grid-cols-1 gap-1 rounded-md text-sm',
            hint.active && '-mx-1 bg-primary/10 px-1.5 py-1 text-foreground',
          )}
          key={`${hint.keys.join('+')}:${hint.label}`}
        >
          <ShortcutSequence keys={hint.keys} />
          <span className="min-w-0 text-muted-foreground text-xs leading-snug">{hint.label}</span>
        </div>
      ))}
    </div>
  )
}
