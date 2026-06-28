import type { ToolHint } from '@pascal-app/core'
import useEditor from '../../../store/use-editor'
import { cn } from '../../../lib/utils'
import { RegisteredToolHelper } from './registered-tool-helper'

/**
 * Fence tool helper. Renders two independent pieces:
 *  - the standard tool-hint panel (top-right), unchanged from every other kind;
 *  - a Straight / Curved mode pill floating just above the bottom-center
 *    controls bar. Straight = the classic two-click segment chain; Curved =
 *    drop control points and commit one smooth spline fence (`fenceDrawMode`
 *    on the editor store, read by `fence/tool.tsx`).
 *
 * The two are positioned separately (not nested) so they never overlap.
 */
export function FenceHelper({
  hints,
  shiftPressed = false,
}: {
  hints: ToolHint[]
  shiftPressed?: boolean
}) {
  const drawMode = useEditor((s) => s.fenceDrawMode)
  const setDrawMode = useEditor((s) => s.setFenceDrawMode)

  return (
    <>
      <RegisteredToolHelper hints={hints} shiftPressed={shiftPressed} />

      {/* Mode pill — sits above the bottom-center controls bar (which is
          `bottom-6` and `h-14`), centered on the same axis. */}
      <div className="dark pointer-events-none fixed bottom-24 left-1/2 z-30 -translate-x-1/2 text-foreground">
        <div className="pointer-events-auto flex gap-1 rounded-full border border-border/40 bg-background/95 p-1 shadow-lg backdrop-blur-xl">
          {(['straight', 'spline'] as const).map((mode) => (
            <button
              className={cn(
                'rounded-full px-3.5 py-1.5 font-medium text-xs transition-colors',
                drawMode === mode
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-white/5 hover:text-foreground',
              )}
              key={mode}
              onClick={() => setDrawMode(mode)}
              type="button"
            >
              {mode === 'straight' ? 'Straight' : 'Curved'}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
