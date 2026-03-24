import { ShortcutToken } from '../primitives/shortcut-token'

export function CeilingHelper() {
  return (
    <div className="pointer-events-none fixed top-1/2 right-4 z-40 flex -translate-y-1/2 flex-col gap-2 rounded-lg border border-border bg-background/95 px-4 py-3 shadow-lg backdrop-blur-md">
      <div className="flex items-center gap-2 text-sm">
        <ShortcutToken value="Left click" />
        <span className="text-muted-foreground">Add point</span>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <ShortcutToken value="Shift" />
        <span className="text-muted-foreground">Allow non-45° angles</span>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <ShortcutToken value="Esc" />
        <span className="text-muted-foreground">Cancel</span>
      </div>
    </div>
  )
}
