import { Icon } from '@iconify/react'
import { Fragment } from 'react'
import {
  CONTINUATION_PROFILES,
  type ContinuationContext,
} from '../../../lib/continuation'
import type { ContextualShortcutHint } from '../../../lib/contextual-help'
import { hasActivePaintMaterial } from '../../../lib/material-paint'
import { paintScopeLabel, type PaintScope } from '../../../lib/paint-scope'
import { sfxEmitter } from '../../../lib/sfx-bus'
import {
  cycleSnappingModeIn,
  resolveSnapFlags,
  type SnapContext,
} from '../../../lib/snapping-mode'
import { cn } from '../../../lib/utils'
import useEditor, { type GridSnapStep } from '../../../store/use-editor'
import useFenceCurveDraft from '../../../store/use-fence-curve-draft'
import { ShortcutToken } from '../primitives/shortcut-token'
import { Tooltip, TooltipContent, TooltipTrigger } from '../primitives/tooltip'

// One muted container holds every row — passive key hints and interactive chips
// alike — so the HUD reads as a single panel, not a stack of floating pills. The
// background is near-opaque (`bg-background/95`) with a single backdrop blur so
// active rows stay readable over the 3D scene even while a modifier is held.
// A 2-track grid: column 1 sizes to `max-content` (the widest key across ALL
// rows), column 2 (`1fr`) is the label. Every row is a subgrid sharing those
// tracks, so labels align even when keys differ in width (⌘ vs Shift) or wrap to
// two lines. Near-opaque bg + single backdrop blur keeps active rows readable.
const CONTAINER_CLASS =
  'pointer-events-none fixed top-1/2 right-4 z-40 grid max-w-[260px] -translate-y-1/2 grid-cols-[max-content_1fr] gap-x-2.5 gap-y-1.5 rounded-lg border border-border bg-background/95 px-3 py-2.5 shadow-lg backdrop-blur-md'

const TOKEN_CLASS = 'h-5 px-1.5 text-[10px]'

// Each row spans both columns as its own subgrid, inheriting the container's
// tracks so its key/label cells land on the shared column lines.
const ROW_CLASS = 'col-span-2 grid grid-cols-subgrid'

// The key cell (column 1). `items-center` centres the token; the row's
// `items-start` keeps it on the label's first line when the label wraps.
const KEY_CELL_CLASS = 'flex items-center gap-1'

// Keys pressed together join with "+"; an entry that is itself an array is a
// group of alternatives and joins with "/" — so [['Cmd/Ctrl', 'Shift'],
// 'Left click'] reads "⌘ / ⇧ + click".
function ShortcutSequence({ keys }: { keys: Array<string | string[]> }) {
  return (
    <div className={KEY_CELL_CLASS}>
      {keys.map((entry, index) => (
        <Fragment key={`${String(entry)}-${index}`}>
          {index > 0 ? (
            <span className="font-medium text-[12px] text-muted-foreground/80 leading-none">
              +
            </span>
          ) : null}
          {Array.isArray(entry) ? (
            entry.map((alternative, altIndex) => (
              <Fragment key={`${alternative}-${altIndex}`}>
                {altIndex > 0 ? (
                  <span className="text-[9px] text-muted-foreground/70">/</span>
                ) : null}
                <ShortcutToken className={TOKEN_CLASS} value={alternative} />
              </Fragment>
            ))
          ) : (
            <ShortcutToken className={TOKEN_CLASS} value={entry} />
          )}
        </Fragment>
      ))}
    </div>
  )
}

// Shared single-line chip row (key cell + icon/label cell). Rendered either as a
// passive row (no `onClick`) or a clickable button. The outer container is
// `pointer-events-none`, so clickable chips opt back in.
function ChipRow({
  ariaLabel,
  disabled = false,
  icon,
  label,
  onClick,
  shortcut,
  tooltip,
}: {
  ariaLabel?: string
  disabled?: boolean
  icon?: string
  label: string
  onClick?: () => void
  shortcut?: string
  tooltip?: string
}) {
  const body = (
    <>
      <span className={KEY_CELL_CLASS}>
        {shortcut ? <ShortcutToken className={TOKEN_CLASS} value={shortcut} /> : null}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
        {icon ? <Icon className="shrink-0" height={13} icon={icon} width={13} /> : null}
        <span className="truncate">{label}</span>
      </span>
    </>
  )

  if (!onClick) {
    return (
      <div className={cn(ROW_CLASS, 'items-center', disabled && 'opacity-45 saturate-0')}>{body}</div>
    )
  }

  const button = (
    <button
      aria-label={ariaLabel ?? label}
      className={cn(
        ROW_CLASS,
        'pointer-events-auto cursor-pointer items-center rounded-md text-left transition-colors hover:bg-muted/60',
        disabled && 'opacity-45 saturate-0',
      )}
      onClick={onClick}
      type="button"
    >
      {body}
    </button>
  )

  if (!tooltip) return button
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="left">{tooltip}</TooltipContent>
    </Tooltip>
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

// The active interaction's snapping controls, scoped to its context (wall / item
// / polygon) so each action shows only the modes that make sense for it.
function SnappingChips({ context }: { context: SnapContext }) {
  const snappingMode = useEditor((s) => s.snappingModeByContext[context])
  const setSnappingMode = useEditor((s) => s.setSnappingMode)
  const gridSnapStep = useEditor((s) => s.gridSnapStep)
  const setGridSnapStep = useEditor((s) => s.setGridSnapStep)

  const gridActive = resolveSnapFlags(snappingMode).grid

  return (
    <>
      <ChipRow
        ariaLabel={`Snapping: ${SNAPPING_MODE_LABELS[snappingMode]}`}
        icon={SNAPPING_MODE_ICONS[snappingMode]}
        label={`Snapping: ${SNAPPING_MODE_LABELS[snappingMode]}`}
        onClick={() => {
          setSnappingMode(context, cycleSnappingModeIn(context, snappingMode))
          sfxEmitter.emit('sfx:grid-snap')
        }}
        shortcut="Shift"
        tooltip="Snapping mode — click or press Shift to cycle"
      />
      {gridActive ? (
        <ChipRow
          ariaLabel={`Grid step: ${gridSnapStep.toFixed(2)} m`}
          label={`Grid: ${gridSnapStep.toFixed(2)} m`}
          onClick={() => {
            setGridSnapStep(nextGridSnapStep(gridSnapStep))
            sfxEmitter.emit('sfx:grid-snap')
          }}
          shortcut="Ctrl"
          tooltip="Grid step — click or tap Ctrl to cycle"
        />
      ) : null}
    </>
  )
}

function ContinuationChip({ context }: { context: ContinuationContext }) {
  const mode = useEditor((s) => s.getContinuation(context))
  const cycleContinuation = useEditor((s) => s.cycleContinuation)
  const profile = CONTINUATION_PROFILES[context]
  const label = profile.labels[mode] ?? mode
  const icon = profile.icons[mode] ?? 'lucide:repeat'

  return (
    <ChipRow
      ariaLabel={`Continuation: ${label}`}
      icon={icon}
      label={label}
      onClick={() => cycleContinuation(context)}
      shortcut="C"
      tooltip="Continuation — click or press C to cycle"
    />
  )
}

function FenceContinuationChips() {
  const mode = useEditor((s) => s.getContinuation('fence'))
  const setContinuation = useEditor((s) => s.setContinuation)
  const curveStarted = useFenceCurveDraft((s) => s.pointCount > 0)

  const isCurved = mode === 'curved'
  const straightMode = isCurved ? 'continuous' : mode
  const straightLabel = straightMode === 'single' ? 'Straight: Single' : 'Straight: Continuous'
  const straightIcon = straightMode === 'single' ? 'lucide:minus' : 'lucide:waypoints'
  const typeLabel = isCurved ? 'Type: Curved' : 'Type: Straight'
  const typeIcon = isCurved ? 'lucide:spline' : 'lucide:minus'

  return (
    <>
      <ChipRow
        ariaLabel={`Fence type: ${isCurved ? 'Curved' : 'Straight'}`}
        icon={typeIcon}
        label={typeLabel}
        onClick={() => setContinuation('fence', isCurved ? 'continuous' : 'curved')}
        shortcut="T"
        tooltip="Fence type — click or press T to switch between straight and curved"
      />
      <ChipRow
        ariaLabel={`Fence continuation: ${straightLabel}`}
        disabled={isCurved}
        icon={straightIcon}
        label={straightLabel}
        onClick={
          isCurved
            ? undefined
            : () => setContinuation('fence', straightMode === 'single' ? 'continuous' : 'single')
        }
        shortcut="C"
        tooltip={
          isCurved
            ? 'Straight continuation is unavailable while curved fence type is active'
            : 'Straight fence continuation — click or press C to toggle'
        }
      />
      {/* Curved fences are committed by a closing gesture rather than per-click,
          so the finish keys aren't discoverable on their own — surface them, but
          only once the user has placed a point and a curve is actually in flight. */}
      {isCurved && curveStarted ? (
        <ChipRow
          icon="lucide:circle-check"
          label="Finish curve (or double-click)"
          shortcut="Enter"
        />
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
// per-target table.
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
    return <ChipRow icon="lucide:palette" label="Select a material to paint" />
  }

  // Not over anything paintable → guide the user to hover, still teaching Shift.
  if (!paintHover) {
    return (
      <ChipRow icon="lucide:mouse-pointer-click" label="Hover a surface to paint" shortcut="Shift" />
    )
  }

  const { scopes } = paintHover
  // A scope carried over from another node (the mode is global) falls back to
  // the narrowest for both display and — via the apply-time resolver — behaviour.
  const effective: PaintScope = scopes.includes(paintScope) ? paintScope : 'single'

  // Paintable but with no scope choice (roof, a one-slot node, …) → a passive
  // row that still names the surface, so the user always sees what they'll paint.
  if (scopes.length <= 1) {
    return (
      <ChipRow
        icon={PAINT_SCOPE_ICONS[effective]}
        label={`Paint: ${paintScopeLabel(effective, paintHover)}`}
      />
    )
  }

  return (
    <ChipRow
      ariaLabel={`Paint scope: ${paintScopeLabel(effective, paintHover)}`}
      icon={PAINT_SCOPE_ICONS[effective]}
      label={`Paint: ${paintScopeLabel(effective, paintHover)}`}
      onClick={() => cyclePaintScope()}
      shortcut="Shift"
      tooltip="Paint scope — click or press Shift to cycle"
    />
  )
}

export function ContextualHelperPanel({
  hints,
  snapContext = null,
  showPaintScope = false,
  continuationContext = null,
}: {
  hints: ContextualShortcutHint[]
  // The active snapping context drives the snapping chips (which mode set). Null
  // → no snapping chips for this interaction.
  snapContext?: SnapContext | null
  showPaintScope?: boolean
  continuationContext?: ContinuationContext | null
}) {
  if (hints.length === 0 && !snapContext && !showPaintScope && !continuationContext)
    return null

  return (
    <div className={CONTAINER_CLASS}>
      {snapContext ? <SnappingChips context={snapContext} /> : null}
      {continuationContext === 'fence' ? <FenceContinuationChips /> : null}
      {continuationContext && continuationContext !== 'fence' ? (
        <ContinuationChip context={continuationContext} />
      ) : null}
      {showPaintScope ? <PaintScopeChip /> : null}
      {hints.map((hint) => (
        <div
          className={cn(ROW_CLASS, 'items-start', hint.active && 'rounded-md bg-primary/10')}
          key={`${hint.keys.join('+')}:${hint.label}`}
        >
          <ShortcutSequence keys={hint.keys} />
          <div className="min-w-0">
            <div
              className={cn(
                'text-xs leading-5',
                hint.active ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {hint.label}
            </div>
            {hint.subtitle ? (
              <div className="text-[10px] text-muted-foreground/70 leading-snug">
                {hint.subtitle}
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}
