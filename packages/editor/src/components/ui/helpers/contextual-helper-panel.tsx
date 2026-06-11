import type { ContextualShortcutHint } from '../../../lib/contextual-help'
import { cn } from '../../../lib/utils'
import { ShortcutToken } from '../primitives/shortcut-token'

function ShortcutSequence({ keys }: { keys: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {keys.map((key, index) => (
        <div className="flex items-center gap-1" key={`${key}-${index}`}>
          {index > 0 ? <span className="text-[10px] text-muted-foreground/70">+</span> : null}
          <ShortcutToken value={key} />
        </div>
      ))}
    </div>
  )
}

export function ContextualHelperPanel({ hints }: { hints: ContextualShortcutHint[] }) {
  if (hints.length === 0) return null

  return (
    <div className="pointer-events-none fixed top-1/2 right-4 z-40 flex max-w-[280px] -translate-y-1/2 flex-col gap-2 rounded-lg border border-border bg-background/95 px-4 py-3 shadow-lg backdrop-blur-md">
      {hints.map((hint) => (
        <div
          className={cn(
            'flex min-w-0 items-center gap-2 rounded-md text-sm',
            hint.active && '-mx-1 bg-primary/10 px-1 py-0.5 text-foreground',
          )}
          key={`${hint.keys.join('+')}:${hint.label}`}
        >
          <ShortcutSequence keys={hint.keys} />
          <span className="min-w-0 text-muted-foreground">{hint.label}</span>
        </div>
      ))}
    </div>
  )
}
