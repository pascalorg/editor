import { Icon } from '@iconify/react'
import type { ToolHint } from '@pascal-app/core'
import { Fragment, useEffect, useSyncExternalStore } from 'react'
import {
  CONTINUATION_PROFILES,
  type ContinuationContext,
} from '../../../lib/continuation'
import type { ContextualShortcutHint } from '../../../lib/contextual-help'
import type { HudTitle } from '../../../lib/hud-title'
import { hasActivePaintMaterial } from '../../../lib/material-paint'
import { usePaintRegionMode } from '../../../lib/paint-region-mode'
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
import { IconRefGlyph } from '../icon-ref'
import { ShortcutToken } from '../primitives/shortcut-token'
import { Tooltip, TooltipContent, TooltipTrigger } from '../primitives/tooltip'
import { useInRightStack } from '../right-stack'

// One muted container holds every row — passive key hints and interactive chips
// alike — so the HUD reads as a single panel, not a stack of floating pills. It
// opens with the tool in hand (icon, name, arming key), then the gesture rows,
// then — past a hairline — the mode chips (snapping, continuation, …) and Esc.
// A 2-track grid: column 1 sizes to `max-content` (the widest key across ALL
// rows), column 2 (`1fr`) is the label. Every row is a subgrid sharing those
// tracks, so labels align even when keys differ in width (⌘ vs Shift) or wrap to
// two lines. Near-opaque bg + single backdrop blur keeps active rows readable.
const CARD_CLASS =
  'pointer-events-none grid w-[252px] grid-cols-[max-content_1fr] gap-x-2.5 gap-y-1.5 rounded-xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur-md'
// On its own (no shared right column) it floats centred on the right edge.
const FLOATING_CLASS = 'fixed top-1/2 right-4 z-40 -translate-y-1/2'

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
function ShortcutSequence({
  active = false,
  keys,
}: {
  active?: boolean
  keys: Array<string | string[]>
}) {
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
                <ShortcutToken
                  className={cn(TOKEN_CLASS, active && 'border-white bg-white text-black shadow-sm')}
                  value={alternative}
                />
              </Fragment>
            ))
          ) : (
            <ShortcutToken
              className={cn(TOKEN_CLASS, active && 'border-white bg-white text-black shadow-sm')}
              value={entry}
            />
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
  guideTarget,
  icon,
  label,
  onClick,
  shortcut,
  tooltip,
}: {
  ariaLabel?: string
  disabled?: boolean
  /**
   * A static hook for a host app's first-run tour to point at, written to
   * `data-guide-target`. Nothing here reads it.
   */
  guideTarget?: string
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
      data-guide-target={guideTarget}
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
        guideTarget="snap-mode"
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
          guideTarget="snap-grid-step"
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

// A kind-owned live mode chip declared on a `ToolHint` (`hint.chip`) — the
// registry counterpart of the snapping / continuation chips above: shows the
// current value's label, and clicking the row (or the hint's key, handled by
// the tool itself) cycles it.
function ToolHintChipRow({ hint }: { hint: ToolHint & { chip: NonNullable<ToolHint['chip']> } }) {
  const { chip } = hint
  const value = useSyncExternalStore(chip.subscribe, chip.value, chip.value)
  const label = chip.labels[value] ?? hint.label
  return (
    <ChipRow
      ariaLabel={label}
      icon={chip.icons?.[value]}
      label={label}
      onClick={chip.cycle}
      shortcut={hint.key}
      tooltip={chip.tooltip}
    />
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
  const isFreehand = mode === 'freehand'
  const straightMode = isCurved ? 'continuous' : mode
  const typeLabel = isFreehand ? 'Type: Freehand' : isCurved ? 'Type: Curved' : 'Type: Straight'
  const typeIcon = isFreehand ? 'lucide:scribble' : isCurved ? 'lucide:spline' : 'lucide:minus'
  const nextType =
    mode === 'continuous' || mode === 'single'
      ? 'curved'
      : mode === 'curved'
        ? 'freehand'
        : 'continuous'

  return (
    <>
      <ChipRow
        ariaLabel={`Fence type: ${typeLabel.replace('Type: ', '')}`}
        icon={typeIcon}
        label={typeLabel}
        onClick={() => setContinuation('fence', nextType)}
        shortcut="T"
        tooltip="Fence type — click or press T to switch between straight, curved and freehand"
      />
      <ChipRow
        ariaLabel={`Fence continuation: ${straightMode === 'single' ? 'Single' : 'Continuous'}`}
        disabled={isCurved || isFreehand}
        icon={straightMode === 'single' ? 'lucide:minus' : 'lucide:waypoints'}
        label={straightMode === 'single' ? 'Straight: Single' : 'Straight: Continuous'}
        onClick={
          isCurved || isFreehand
            ? undefined
            : () => setContinuation('fence', straightMode === 'single' ? 'continuous' : 'single')
        }
        shortcut="C"
        tooltip={
          isCurved || isFreehand
            ? 'Straight continuation is unavailable for curved or freehand fences'
            : 'Straight fence continuation — click or press C to toggle'
        }
      />
      {/* Curved fences are committed by a closing gesture rather than per-click,
          so the finish keys aren't discoverable on their own — surface them, but
          only once the user has placed a point and a curve is actually in flight. */}
      {(isCurved || isFreehand) && curveStarted ? (
        <ChipRow
          icon="lucide:circle-check"
          label={isFreehand ? 'Drag to draw fence' : 'Finish curve (or double-click)'}
          shortcut={isFreehand ? 'Release' : 'Enter'}
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

// Why the last paint click did nothing (a surface that has no finish of its
// own to paint), in the same "!" row the region gestures use for a refusal.
function PaintNotice() {
  const notice = usePaintRegionMode((s) => s.notice)
  // Leaving the painter forgets it.
  useEffect(() => () => usePaintRegionMode.getState().setNotice(null), [])
  return notice ? <HintRow hint={{ keys: ['!'], label: notice, active: true }} /> : null
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
  const paintMode = usePaintRegionMode((s) => s.mode)
  const paintEraser = paintMode === 'erase'
  const picking = paintMode === 'pick'
  const verb = picking ? 'Pick' : paintEraser ? 'Erase' : 'Paint'

  // Nothing to paint with yet (no material picked, not erasing) → the first step
  // is choosing a material, so say that before anything about scope or hovering.
  if (!(paintEraser || picking || hasActivePaintMaterial(activePaintMaterial))) {
    return <ChipRow icon="lucide:palette" label="Select a material to paint" />
  }

  // Not over anything paintable → guide the user to hover, still teaching Shift.
  if (!paintHover) {
    return (
      <ChipRow
        icon="lucide:mouse-pointer-click"
        label={
          picking
            ? 'Hover a surface to pick its material'
            : paintEraser
              ? 'Hover a painted surface to erase'
              : 'Hover a surface to paint'
        }
        shortcut={picking ? undefined : 'Shift'}
      />
    )
  }

  const { scopes } = paintHover
  // A scope carried over from another node (the mode is global) falls back to
  // the narrowest for both display and — via the apply-time resolver — behaviour.
  const effective: PaintScope = scopes.includes(paintScope) ? paintScope : 'single'

  // Paintable but with no scope choice (roof, a one-slot node, …) → a passive
  // row that still names the surface, so the user always sees what they'll paint.
  if (scopes.length <= 1 || picking) {
    return (
      <ChipRow
        icon={picking ? 'lucide:pipette' : PAINT_SCOPE_ICONS[effective]}
        label={`${verb}: ${paintScopeLabel(picking ? 'single' : effective, paintHover)}`}
      />
    )
  }

  return (
    <ChipRow
      ariaLabel={`${verb} scope: ${paintScopeLabel(effective, paintHover)}`}
      icon={PAINT_SCOPE_ICONS[effective]}
      label={`${verb}: ${paintScopeLabel(effective, paintHover)}`}
      onClick={() => cyclePaintScope()}
      shortcut="Shift"
      tooltip={`${verb} scope — click or press Shift to cycle`}
    />
  )
}

// The tool in hand: its icon, name and arming key, over a hairline.
function HudHeader({ title }: { title: HudTitle }) {
  return (
    <div
      className="col-span-2 mb-0.5 flex items-center gap-2.5 border-border border-b pb-2.5"
      data-hud-title={title.label}
    >
      {title.icon ? (
        <span className="flex size-7 shrink-0 items-center justify-center">
          <IconRefGlyph icon={title.icon} size={26} />
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate font-medium text-[13px] text-foreground leading-tight">
        {title.label}
      </span>
      {title.shortcut ? <ShortcutToken className={TOKEN_CLASS} value={title.shortcut} /> : null}
    </div>
  )
}

const isEscHint = (hint: ContextualShortcutHint) =>
  hint.keys.length === 1 && hint.keys[0] === 'Esc'

function HintRow({ hint }: { hint: ContextualShortcutHint }) {
  return (
    <div className={cn(ROW_CLASS, 'items-start')}>
      <ShortcutSequence active={hint.active} keys={hint.keys} />
      <div className="min-w-0">
        <div
          className={cn(
            'text-xs leading-5',
            hint.active ? 'font-medium text-white' : 'text-muted-foreground',
          )}
        >
          {hint.label}
        </div>
        {hint.subtitle ? (
          <div className="text-[10px] text-muted-foreground/70 leading-snug">{hint.subtitle}</div>
        ) : null}
      </div>
    </div>
  )
}

const hintKey = (hint: ContextualShortcutHint) => `${hint.keys.join('+')}:${hint.label}`

export function ContextualHelperPanel({
  hints,
  chipHints = [],
  snapContext = null,
  showPaintScope = false,
  continuationContext = null,
  title = null,
}: {
  hints: ContextualShortcutHint[]
  // Kind-owned live mode chips (`ToolHint.chip`), rendered alongside the
  // snapping / continuation chips.
  chipHints?: ToolHint[]
  // The active snapping context drives the snapping chips (which mode set). Null
  // → no snapping chips for this interaction.
  snapContext?: SnapContext | null
  showPaintScope?: boolean
  continuationContext?: ContinuationContext | null
  // The tool or gesture in hand, shown as the panel's header.
  title?: HudTitle | null
}) {
  const inStack = useInRightStack()
  const modeChips = chipHints.filter((hint) => hint.chip)
  const hasChips = !!snapContext || !!continuationContext || modeChips.length > 0 || showPaintScope
  if (hints.length === 0 && !hasChips) return null

  const actionHints = hints.filter((hint) => !isEscHint(hint))
  const escHints = hints.filter(isEscHint)

  return (
    <div
      className={cn(CARD_CLASS, !inStack && FLOATING_CLASS)}
      data-hud-card
    >
      {title ? <HudHeader title={title} /> : null}
      {actionHints.map((hint) => (
        <HintRow hint={hint} key={hintKey(hint)} />
      ))}
      {actionHints.length > 0 && (hasChips || escHints.length > 0) ? (
        <div className="col-span-2 my-0.5 h-px bg-border" />
      ) : null}
      {snapContext ? <SnappingChips context={snapContext} /> : null}
      {continuationContext === 'fence' ? <FenceContinuationChips /> : null}
      {continuationContext && continuationContext !== 'fence' ? (
        <ContinuationChip context={continuationContext} />
      ) : null}
      {modeChips.map((hint) => (
        <ToolHintChipRow
          hint={hint as ToolHint & { chip: NonNullable<ToolHint['chip']> }}
          key={`${hint.key}:${hint.label}`}
        />
      ))}
      {showPaintScope ? <PaintNotice /> : null}
      {showPaintScope ? <PaintScopeChip /> : null}
      {escHints.map((hint) => (
        <HintRow hint={hint} key={hintKey(hint)} />
      ))}
    </div>
  )
}
