interface ItemHelperProps {
  showEsc?: boolean
}

export function ItemHelper({ showEsc }: ItemHelperProps) {
  return (
    <div className="pointer-events-none fixed right-4 top-1/2 -translate-y-1/2 z-40 flex flex-col gap-2 rounded-lg border border-border bg-background/95 px-4 py-3 shadow-lg backdrop-blur-md">
      <div className="flex items-center gap-2 text-sm">
        <kbd className="rounded bg-muted px-2 py-1 text-xs font-medium">R</kbd>
        <span className="text-muted-foreground">Rotate counterclockwise</span>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <kbd className="rounded bg-muted px-2 py-1 text-xs font-medium">T</kbd>
        <span className="text-muted-foreground">Rotate clockwise</span>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <kbd className="rounded bg-muted px-2 py-1 text-xs font-medium">Shift</kbd>
        <span className="text-muted-foreground">Free place</span>
      </div>
      {showEsc && (
        <div className="flex items-center gap-2 text-sm">
          <kbd className="rounded bg-muted px-2 py-1 text-xs font-medium">Esc</kbd>
          <span className="text-muted-foreground">Cancel</span>
        </div>
      )}
    </div>
  )
}
