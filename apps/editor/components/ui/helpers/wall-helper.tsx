export function WallHelper() {
  return (
    <div className="pointer-events-none fixed right-4 top-1/2 -translate-y-1/2 z-40 flex items-center gap-2 rounded-lg border border-border bg-background/95 px-4 py-2 shadow-lg backdrop-blur-md">
      <div className="flex items-center gap-2 text-sm">
        <kbd className="rounded bg-muted px-2 py-1 text-xs font-medium">Shift</kbd>
        <span className="text-muted-foreground">Allow non-45° angles</span>
      </div>
    </div>
  )
}
