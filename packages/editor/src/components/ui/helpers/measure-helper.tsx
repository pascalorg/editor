export function MeasureHelper() {
  return (
    <div className="pointer-events-none fixed top-1/2 right-4 z-40 flex -translate-y-1/2 flex-col gap-2 rounded-lg border border-border bg-background/95 px-4 py-3 shadow-lg backdrop-blur-md">
      <div className="flex items-center gap-2 text-sm">
        <kbd className="rounded bg-muted px-2 py-1 font-medium text-xs">Shift</kbd>
        <span className="text-muted-foreground">Allow non-45° angles</span>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <kbd className="rounded bg-muted px-2 py-1 font-medium text-xs">Tab</kbd>
        <span className="text-muted-foreground">Type a measurement distance</span>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <kbd className="rounded bg-muted px-2 py-1 font-medium text-xs">Esc</kbd>
        <span className="text-muted-foreground">Clear the measurement</span>
      </div>
    </div>
  )
}
