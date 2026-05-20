import type { ToolHint } from '@pascal-app/core'
import { ShortcutToken } from '../primitives/shortcut-token'

/**
 * Generic helper panel rendered from `def.toolHints` data. Matches the
 * visual styling of the hand-written `<WallHelper>` / `<ItemHelper>` /
 * etc. so registry-driven kinds get a consistent look without each kind
 * writing its own component.
 *
 * Drops the need for per-kind helper files entirely — kinds declare
 * their hints as static data in their `NodeDefinition`.
 */
export function RegisteredToolHelper({ hints }: { hints: ToolHint[] }) {
  if (hints.length === 0) return null
  return (
    <div className="pointer-events-none fixed top-1/2 right-4 z-40 flex -translate-y-1/2 flex-col gap-2 rounded-lg border border-border bg-background/95 px-4 py-3 shadow-lg backdrop-blur-md">
      {hints.map((hint) => (
        <div className="flex items-center gap-2 text-sm" key={`${hint.key}:${hint.label}`}>
          <ShortcutToken value={hint.key} />
          <span className="text-muted-foreground">{hint.label}</span>
        </div>
      ))}
    </div>
  )
}
