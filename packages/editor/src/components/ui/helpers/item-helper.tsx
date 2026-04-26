import { ShortcutToken } from '../primitives/shortcut-token'

interface ItemHelperProps {
  dock?: 'default' | 'left-of-navigation'
  showEsc?: boolean
}

export function ItemHelper({ dock = 'default', showEsc }: ItemHelperProps) {
  const positionClass = dock === 'left-of-navigation' ? 'right-[5.5rem]' : 'right-4'

  return (
    <div
      className={`pointer-events-none fixed top-1/2 ${positionClass} z-40 flex -translate-y-1/2 flex-col gap-2 rounded-lg border border-border bg-background/95 px-4 py-3 shadow-lg backdrop-blur-md`}
    >
      <div className="flex items-center gap-2 text-sm">
        <ShortcutToken value="Left click" />
        <span className="text-muted-foreground">Place item</span>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <ShortcutToken value="R" />
        <span className="text-muted-foreground">Rotate counterclockwise</span>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <ShortcutToken value="T" />
        <span className="text-muted-foreground">Rotate clockwise</span>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <ShortcutToken value="Shift" />
        <span className="text-muted-foreground">Free place</span>
      </div>
      {showEsc && (
        <div className="flex items-center gap-2 text-sm">
          <ShortcutToken value="Esc" />
          <span className="text-muted-foreground">Cancel</span>
        </div>
      )}
      {!showEsc && (
        <div className="flex items-center gap-2 text-sm">
          <ShortcutToken value="Right click" />
          <span className="text-muted-foreground">Cancel</span>
        </div>
      )}
    </div>
  )
}
