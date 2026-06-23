import { Icon } from '@iconify/react'
import type { ContextualShortcutHint } from '../../../lib/contextual-help'
import { resolveSnapFlags } from '../../../lib/snapping-mode'
import { cn } from '../../../lib/utils'
import useEditor, { type GridSnapStep } from '../../../store/use-editor'
import { ShortcutToken } from '../primitives/shortcut-token'
import { Tooltip, TooltipContent, TooltipTrigger } from '../primitives/tooltip'

const PILL_CLASS =
  'flex items-center gap-3 rounded-full border border-border bg-popover/90 py-1.5 pr-1.5 pl-3.5 text-foreground text-[11px] shadow-md shadow-black/10 backdrop-blur-md'

function ShortcutSequence({ keys }: { keys: string[] }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {keys.map((key, index) => (
        <div className="flex items-center gap-1" key={`${key}-${index}`}>
          {index > 0 ? <span className="text-[9px] text-muted-foreground/70">+</span> : null}
          <ShortcutToken className="h-6 px-1.5 text-[10px]" value={key} />
        </div>
      ))}
    </div>
  )
}

const SNAPPING_MODE_ICONS = {
  grid: 'lucide:grid-2x2',
  lines: 'lucide:magnet',
  angles: 'lucide:triangle',
  off: 'lucide:ban',
} as const

const SNAPPING_MODE_LABELS = {
  grid: 'Grid',
  lines: 'Lines',
  angles: 'Angles',
  off: 'Off',
} as const

const GRID_SNAP_STEPS: GridSnapStep[] = [0.5, 0.25, 0.1, 0.05]

function nextGridSnapStep(step: GridSnapStep): GridSnapStep {
  const index = GRID_SNAP_STEPS.indexOf(step)
  return GRID_SNAP_STEPS[(index + 1) % GRID_SNAP_STEPS.length] ?? GRID_SNAP_STEPS[0]!
}

// Interactive chip rows: the active interaction's own snapping controls. The
// surrounding stack is `pointer-events-none` (passive key hints), so these
// pills carve out `pointer-events-auto` to stay clickable.
function SnappingChips() {
  const snappingMode = useEditor((s) => s.snappingMode)
  const cycleSnappingMode = useEditor((s) => s.cycleSnappingMode)
  const gridSnapStep = useEditor((s) => s.gridSnapStep)
  const setGridSnapStep = useEditor((s) => s.setGridSnapStep)

  const gridActive = resolveSnapFlags(snappingMode).grid

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            aria-label={`Snapping: ${SNAPPING_MODE_LABELS[snappingMode]}`}
            className={`${PILL_CLASS} pointer-events-auto cursor-pointer transition-colors hover:bg-accent`}
            onClick={() => cycleSnappingMode()}
            type="button"
          >
            <span className="flex min-w-0 flex-1 items-center gap-1.5 font-medium">
              <Icon
                className="shrink-0"
                height={13}
                icon={SNAPPING_MODE_ICONS[snappingMode]}
                width={13}
              />
              <span className="truncate">Snapping: {SNAPPING_MODE_LABELS[snappingMode]}</span>
            </span>
            <ShortcutToken className="h-6 px-1.5 text-[10px]" value="Shift" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">Snapping mode — click or press Shift to cycle</TooltipContent>
      </Tooltip>

      {gridActive ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label={`Grid step: ${gridSnapStep.toFixed(2)} m`}
              className={`${PILL_CLASS} pointer-events-auto cursor-pointer transition-colors hover:bg-accent`}
              onClick={() => setGridSnapStep(nextGridSnapStep(gridSnapStep))}
              type="button"
            >
              <span className="min-w-0 flex-1 truncate font-medium">
                Grid: <span className="tabular-nums">{gridSnapStep.toFixed(2)}</span> m
              </span>
              <ShortcutToken className="h-6 px-1.5 text-[10px]" value="Ctrl" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Grid step — click or tap Ctrl to cycle</TooltipContent>
        </Tooltip>
      ) : null}
    </>
  )
}

export function ContextualHelperPanel({
  hints,
  showSnapping = false,
}: {
  hints: ContextualShortcutHint[]
  showSnapping?: boolean
}) {
  if (hints.length === 0 && !showSnapping) return null

  return (
    <div className="pointer-events-none fixed top-1/2 right-4 z-40 flex max-w-[260px] -translate-y-1/2 flex-col items-end gap-2">
      {showSnapping ? <SnappingChips /> : null}
      {hints.map((hint) => (
        <div
          className={cn(
            PILL_CLASS,
            'w-full justify-between',
            hint.active && 'border-primary/40 bg-primary/10 text-foreground',
          )}
          key={`${hint.keys.join('+')}:${hint.label}`}
        >
          <span className="min-w-0 flex-1 truncate font-medium leading-snug">{hint.label}</span>
          <ShortcutSequence keys={hint.keys} />
        </div>
      ))}
    </div>
  )
}
