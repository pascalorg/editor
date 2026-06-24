import { Icon } from '@iconify/react'
import type { ContextualShortcutHint } from '../../../lib/contextual-help'
import { hasActivePaintMaterial } from '../../../lib/material-paint'
import { paintScopeLabel, type PaintScope } from '../../../lib/paint-scope'
import {
  cycleSnappingModeIn,
  resolveSnapFlags,
  type SnapContext,
} from '../../../lib/snapping-mode'
import { cn } from '../../../lib/utils'
import useEditor, { type GridSnapStep } from '../../../store/use-editor'
import { ShortcutToken } from '../primitives/shortcut-token'
import { Tooltip, TooltipContent, TooltipTrigger } from '../primitives/tooltip'

const PILL_CLASS =
  'flex items-center gap-3 rounded-full border border-border bg-popover/90 py-1.5 pr-1.5 pl-3.5 text-foreground text-[11px] shadow-md shadow-black/10 backdrop-blur-md'

// Multiple keys in a contextual hint are alternatives (e.g. Rotate R / T), not a
// chord — the HUD never shows key chords — so they read on one line split by "/".
function ShortcutSequence({ keys }: { keys: string[] }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {keys.map((key, index) => (
        <div className="flex items-center gap-1" key={`${key}-${index}`}>
          {index > 0 ? <span className="text-[9px] text-muted-foreground/70">/</span> : null}
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

// Interactive chip rows: the active interaction's own snapping controls, scoped
// to its context (wall / item / polygon) so each action shows only the modes
// that make sense for it. The surrounding stack is `pointer-events-none` (passive
// key hints), so these pills carve out `pointer-events-auto` to stay clickable.
function SnappingChips({ context }: { context: SnapContext }) {
  const snappingMode = useEditor((s) => s.snappingModeByContext[context])
  const setSnappingMode = useEditor((s) => s.setSnappingMode)
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
            onClick={() => setSnappingMode(context, cycleSnappingModeIn(context, snappingMode))}
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

const PAINT_SCOPE_ICONS: Record<PaintScope, string> = {
  single: 'lucide:square',
  object: 'lucide:box',
  matching: 'lucide:copy',
  room: 'lucide:scan',
}

// The painter's application-scope chip. Driven entirely by the hovered node's
// derived `paintHover` (scopes + labels), so it works for any kind without a
// per-target table. Carves out `pointer-events-auto` like the snapping chips.
function PaintScopeChip() {
  // What the cursor is over (that's what the next click paints). `null` when not
  // over a paintable surface — including an item with no slots.
  const paintHover = useEditor((s) => s.paintHover)
  const paintScope = useEditor((s) => s.paintScope)
  const cyclePaintScope = useEditor((s) => s.cyclePaintScope)
  const activePaintMaterial = useEditor((s) => s.activePaintMaterial)
  const paintEraser = useEditor((s) => s.paintEraser)

  // Nothing to paint with yet (no material picked, not erasing) → the first step
  // is choosing a material, so say that before anything about scope or hovering.
  if (!(paintEraser || hasActivePaintMaterial(activePaintMaterial))) {
    return (
      <div className={PILL_CLASS}>
        <span className="flex min-w-0 flex-1 items-center gap-1.5 font-medium text-muted-foreground">
          <Icon className="shrink-0" height={13} icon="lucide:palette" width={13} />
          <span className="truncate">Select a material to paint</span>
        </span>
      </div>
    )
  }

  // Not over anything paintable → guide the user to hover, still teaching Shift.
  if (!paintHover) {
    return (
      <div className={PILL_CLASS}>
        <span className="flex min-w-0 flex-1 items-center gap-1.5 font-medium text-muted-foreground">
          <Icon className="shrink-0" height={13} icon="lucide:mouse-pointer-click" width={13} />
          <span className="truncate">Hover a surface to paint</span>
        </span>
        <ShortcutToken className="h-6 px-1.5 text-[10px]" value="Shift" />
      </div>
    )
  }

  const { scopes } = paintHover
  // A scope carried over from another node (the mode is global) falls back to
  // the narrowest for both display and — via the apply-time resolver — behaviour.
  const effective: PaintScope = scopes.includes(paintScope) ? paintScope : 'single'

  // Paintable but with no scope choice (roof, a one-slot node, …) → a passive
  // pill that still names the surface, so the user always sees what they'll paint.
  if (scopes.length <= 1) {
    return (
      <div className={PILL_CLASS}>
        <span className="flex min-w-0 flex-1 items-center gap-1.5 font-medium">
          <Icon className="shrink-0" height={13} icon={PAINT_SCOPE_ICONS[effective]} width={13} />
          <span className="truncate">Paint: {paintScopeLabel(effective, paintHover)}</span>
        </span>
      </div>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={`Paint scope: ${paintScopeLabel(effective, paintHover)}`}
          className={`${PILL_CLASS} pointer-events-auto cursor-pointer transition-colors hover:bg-accent`}
          onClick={() => cyclePaintScope()}
          type="button"
        >
          <span className="flex min-w-0 flex-1 items-center gap-1.5 font-medium">
            <Icon className="shrink-0" height={13} icon={PAINT_SCOPE_ICONS[effective]} width={13} />
            <span className="truncate">Paint: {paintScopeLabel(effective, paintHover)}</span>
          </span>
          <ShortcutToken className="h-6 px-1.5 text-[10px]" value="Shift" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">Paint scope — click or press Shift to cycle</TooltipContent>
    </Tooltip>
  )
}

export function ContextualHelperPanel({
  hints,
  snapContext = null,
  showPaintScope = false,
}: {
  hints: ContextualShortcutHint[]
  // The active snapping context drives the snapping chips (which mode set). Null
  // → no snapping chips for this interaction.
  snapContext?: SnapContext | null
  showPaintScope?: boolean
}) {
  if (hints.length === 0 && !snapContext && !showPaintScope) return null

  return (
    <div className="pointer-events-none fixed top-1/2 right-4 z-40 flex max-w-[260px] -translate-y-1/2 flex-col items-end gap-2">
      {snapContext ? <SnappingChips context={snapContext} /> : null}
      {showPaintScope ? <PaintScopeChip /> : null}
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
