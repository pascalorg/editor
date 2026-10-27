import { formatLength, type MessageDescriptor, usePascalI18n } from '@pascal-app/core'
import { Icon } from '@iconify/react'
import type { ToolHint } from '@pascal-app/core'
import { Fragment, useEffect, useId, useState, useSyncExternalStore } from 'react'
import {
  CONTINUATION_PROFILES,
  type ContinuationContext,
} from '../../../lib/continuation'
import type { ContextualShortcutHint } from '../../../lib/contextual-help'
import { hintText, nodeLabel, toolHintChipLabel, toolHintLabel } from '../../../i18n/node-messages'
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
                  className={cn(TOKEN_CLASS, active &&
                      'border-foreground bg-foreground text-background shadow-sm dark:border-white dark:bg-white dark:text-black')}
                  value={alternative}
                />
              </Fragment>
            ))
          ) : (
            <ShortcutToken
              className={cn(TOKEN_CLASS, active &&
                      'border-foreground bg-foreground text-background shadow-sm dark:border-white dark:bg-white dark:text-black')}
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
  grid: /* i18n */ { id: 'editor.helpers.contextualHelperPanel.snappingGrid', message: 'Snapping: Grid' },
  lines: /* i18n */ { id: 'editor.helpers.contextualHelperPanel.snappingLines', message: 'Snapping: Lines' },
  angles: /* i18n */ { id: 'editor.helpers.contextualHelperPanel.snappingAngles', message: 'Snapping: Angles' },
  off: /* i18n */ { id: 'editor.helpers.contextualHelperPanel.snappingOff', message: 'Snapping: Off' },
} as const

const GRID_SNAP_STEPS: GridSnapStep[] = [0.5, 0.25, 0.1, 0.05]

function nextGridSnapStep(step: GridSnapStep): GridSnapStep {
  const index = GRID_SNAP_STEPS.indexOf(step)
  return GRID_SNAP_STEPS[(index + 1) % GRID_SNAP_STEPS.length] ?? GRID_SNAP_STEPS[0]!
}

// The active interaction's snapping controls, scoped to its context (wall / item
// / polygon) so each action shows only the modes that make sense for it.
function SnappingChips({ context }: { context: SnapContext }) {
  const i18n = usePascalI18n()
  const snappingMode = useEditor((s) => s.snappingModeByContext[context])
  const setSnappingMode = useEditor((s) => s.setSnappingMode)
  const gridSnapStep = useEditor((s) => s.gridSnapStep)
  const setGridSnapStep = useEditor((s) => s.setGridSnapStep)

  const gridActive = resolveSnapFlags(snappingMode).grid

  return (
    <>
      <ChipRow
        ariaLabel={i18n._(SNAPPING_MODE_LABELS[snappingMode])}
        guideTarget="snap-mode"
        icon={SNAPPING_MODE_ICONS[snappingMode]}
        label={i18n._(SNAPPING_MODE_LABELS[snappingMode])}
        onClick={() => {
          setSnappingMode(context, cycleSnappingModeIn(context, snappingMode))
          sfxEmitter.emit('sfx:grid-snap')
        }}
        shortcut="Shift"
        tooltip={i18n._({ id: 'editor.helpers.contextualHelperPanel.snappingModeClickOrPressShift', message: 'Snapping mode — click or press Shift to cycle' })}
      />
      {gridActive ? (
        <ChipRow
          ariaLabel={i18n._({
            id: 'editor.helpers.contextualHelperPanel.gridStepLength',
            message: 'Grid step: {length}',
            values: { length: formatLength(gridSnapStep, 'm', { locale: i18n.getLocale(), min: 2, max: 2 }) },
          })}
          guideTarget="snap-grid-step"
          label={i18n._({
            id: 'editor.helpers.contextualHelperPanel.gridLength',
            message: 'Grid: {length}',
            values: { length: formatLength(gridSnapStep, 'm', { locale: i18n.getLocale(), min: 2, max: 2 }) },
          })}
          onClick={() => {
            setGridSnapStep(nextGridSnapStep(gridSnapStep))
            sfxEmitter.emit('sfx:grid-snap')
          }}
          shortcut="Ctrl"
          tooltip={i18n._({ id: 'editor.helpers.contextualHelperPanel.gridStepClickOrTapCtrl', message: 'Grid step — click or tap Ctrl to cycle' })}
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
  const i18n = usePascalI18n()
  const value = useSyncExternalStore(chip.subscribe, chip.value, chip.value)
  const english = chip.labels[value]
  const label = english
    ? toolHintChipLabel(value, english, i18n)
    : toolHintLabel(hint.label, i18n)
  return (
    <ChipRow
      ariaLabel={label}
      icon={chip.icons?.[value]}
      label={label}
      onClick={chip.cycle}
      shortcut={hint.key}
      tooltip={chip.tooltip ? toolHintLabel(chip.tooltip, i18n) : undefined}
    />
  )
}

function ContinuationChip({ context }: { context: ContinuationContext }) {
  const i18n = usePascalI18n()
  const mode = useEditor((s) => s.getContinuation(context))
  const cycleContinuation = useEditor((s) => s.cycleContinuation)
  const profile = CONTINUATION_PROFILES[context]
  const descriptor = profile.labels[mode]
  const label = descriptor ? i18n._(descriptor) : mode
  const icon = profile.icons[mode] ?? 'lucide:repeat'

  return (
    <ChipRow
      ariaLabel={i18n._({
        id: 'editor.helpers.contextualHelperPanel.continuationLabel',
        message: 'Continuation: {label}',
        values: { label },
      })}
      icon={icon}
      label={label}
      onClick={() => cycleContinuation(context)}
      shortcut="C"
      tooltip={i18n._({ id: 'editor.helpers.contextualHelperPanel.continuationClickOrPressCTo', message: 'Continuation — click or press C to cycle' })}
    />
  )
}

function FenceContinuationChips() {
  const i18n = usePascalI18n()
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
        tooltip={i18n._({ id: 'editor.helpers.contextualHelperPanel.fenceTypeClickOrPressT', message: 'Fence type — click or press T to switch between straight, curved and freehand' })}
      />
      <ChipRow
        ariaLabel={`Fence continuation: ${straightMode === 'single' ? 'Single' : 'Continuous'}`}
        disabled={isCurved || isFreehand}
        icon={straightMode === 'single' ? 'lucide:minus' : 'lucide:waypoints'}
        label={straightMode === 'single' ? i18n._({ id: 'editor.helpers.contextualHelperPanel.straightSingle', message: 'Straight: Single' }) : i18n._({ id: 'editor.helpers.contextualHelperPanel.straightContinuous', message: 'Straight: Continuous' })}
        onClick={
          isCurved || isFreehand
            ? undefined
            : () => setContinuation('fence', straightMode === 'single' ? 'continuous' : 'single')
        }
        shortcut="C"
        tooltip={
          isCurved || isFreehand
            ? i18n._({ id: 'editor.helpers.contextualHelperPanel.straightContinuationIsUnavailableForCurved', message: 'Straight continuation is unavailable for curved or freehand fences' })
            : i18n._({ id: 'editor.helpers.contextualHelperPanel.straightFenceContinuationClickOrPress', message: 'Straight fence continuation — click or press C to toggle' })
        }
      />
      {/* Curved fences are committed by a closing gesture rather than per-click,
          so the finish keys aren't discoverable on their own — surface them, but
          only once the user has placed a point and a curve is actually in flight. */}
      {(isCurved || isFreehand) && curveStarted ? (
        <ChipRow
          icon="lucide:circle-check"
          label={isFreehand ? i18n._({ id: 'editor.helpers.contextualHelperPanel.dragToDrawFence', message: 'Drag to draw fence' }) : i18n._({ id: 'editor.helpers.contextualHelperPanel.finishCurveOrDoubleClick', message: 'Finish curve (or double-click)' })}
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
  const i18n = usePascalI18n()
  // What the cursor is over (that's what the next click paints). `null` when not
  // over a paintable surface — including an item with no slots.
  const paintHover = useEditor((s) => s.paintHover)
  const paintScope = useEditor((s) => s.paintScope)
  const cyclePaintScope = useEditor((s) => s.cyclePaintScope)
  const activePaintMaterial = useEditor((s) => s.activePaintMaterial)
  const paintMode = usePaintRegionMode((s) => s.mode)
  const paintEraser = paintMode === 'erase'
  const picking = paintMode === 'pick'
  const verb = picking ? 'pick' : paintEraser ? 'erase' : 'paint'
  const scopeText = (scope: PaintScope) =>
    ({
      pick: i18n._({
        id: 'editor.helpers.contextualHelperPanel.pickScope',
        message: 'Pick: {scope}',
        values: { scope: paintScopeLabel(scope, paintHover!) },
      }),
      erase: i18n._({
        id: 'editor.helpers.contextualHelperPanel.eraseScope',
        message: 'Erase: {scope}',
        values: { scope: paintScopeLabel(scope, paintHover!) },
      }),
      paint: i18n._({
        id: 'editor.helpers.contextualHelperPanel.paintScope',
        message: 'Paint: {scope}',
        values: { scope: paintScopeLabel(scope, paintHover!) },
      }),
    })[verb]

  // Nothing to paint with yet (no material picked, not erasing) → the first step
  // is choosing a material, so say that before anything about scope or hovering.
  if (!(paintEraser || picking || hasActivePaintMaterial(activePaintMaterial))) {
    return <ChipRow icon="lucide:palette" label={i18n._({ id: 'editor.helpers.contextualHelperPanel.selectAMaterialToPaint', message: 'Select a material to paint' })} />
  }

  // Not over anything paintable → guide the user to hover, still teaching Shift.
  if (!paintHover) {
    return (
      <ChipRow
        icon="lucide:mouse-pointer-click"
        label={
          picking
            ? i18n._({ id: 'editor.helpers.contextualHelperPanel.hoverASurfaceToPickIts', message: 'Hover a surface to pick its material' })
            : paintEraser
              ? i18n._({ id: 'editor.helpers.contextualHelperPanel.hoverAPaintedSurfaceToErase', message: 'Hover a painted surface to erase' })
              : i18n._({ id: 'editor.helpers.contextualHelperPanel.hoverASurfaceToPaint', message: 'Hover a surface to paint' })
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
        label={scopeText(picking ? 'single' : effective)}
      />
    )
  }

  return (
    <ChipRow
      ariaLabel={
        paintEraser
          ? i18n._({ id: 'editor.helpers.contextualHelperPanel.eraseScopeLabel', message: 'Erase scope: {scope}', values: { scope: paintScopeLabel(effective, paintHover) } })
          : i18n._({ id: 'editor.helpers.contextualHelperPanel.paintScopeLabel', message: 'Paint scope: {scope}', values: { scope: paintScopeLabel(effective, paintHover) } })
      }
      icon={PAINT_SCOPE_ICONS[effective]}
      label={scopeText(effective)}
      onClick={() => cyclePaintScope()}
      shortcut="Shift"
      tooltip={
        paintEraser
          ? i18n._({ id: 'editor.helpers.contextualHelperPanel.eraseScopeClickOrPressShift', message: 'Erase scope — click or press Shift to cycle' })
          : i18n._({ id: 'editor.helpers.contextualHelperPanel.paintScopeClickOrPressShift', message: 'Paint scope — click or press Shift to cycle' })
      }
    />
  )
}

// The tool in hand: its icon, name and arming key, over a hairline.
function HudHeader({ title }: { title: HudTitle }) {
  const i18n = usePascalI18n()
  const kind = title.kind
    ? nodeLabel(title.kind.kind, title.kind.english, i18n).toLocaleLowerCase(i18n.getLocale())
    : undefined
  const descriptor: MessageDescriptor = { ...title.label, values: { ...title.label.values, kind } }
  const label = i18n._(descriptor)
  return (
    <div
      className="col-span-2 mb-0.5 flex items-center gap-2.5 border-border border-b pb-2.5"
      data-hud-title={label}
    >
      {title.icon ? (
        <span className="flex size-7 shrink-0 items-center justify-center">
          <IconRefGlyph icon={title.icon} size={26} />
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate font-medium text-[13px] text-foreground leading-tight">
        {label}
      </span>
      {title.shortcut ? <ShortcutToken className={TOKEN_CLASS} value={title.shortcut} /> : null}
    </div>
  )
}

const isEscHint = (hint: ContextualShortcutHint) =>
  hint.keys.length === 1 && hint.keys[0] === 'Esc'

// A "!" row says why something won't happen here (a wall end a window can't wrap), not a key to
// press, so it is never folded under More shortcuts.
const isNoteHint = (hint: ContextualShortcutHint) => hint.keys.length === 1 && hint.keys[0] === '!'

function HintRow({ hint }: { hint: ContextualShortcutHint }) {
  const i18n = usePascalI18n()
  return (
    <div className={cn(ROW_CLASS, 'items-start')}>
      <ShortcutSequence active={hint.active} keys={hint.keys} />
      <div className="min-w-0">
        <div
          className={cn(
            'text-xs leading-5',
            hint.active ? 'font-medium text-foreground dark:text-white' : 'text-muted-foreground',
          )}
        >
          {hintText(hint.label, i18n)}
        </div>
        {hint.subtitle ? (
          <div className="text-[10px] text-muted-foreground/70 leading-snug">
            {hintText(hint.subtitle, i18n)}
          </div>
        ) : null}
      </div>
    </div>
  )
}

const hintKey = (hint: ContextualShortcutHint) =>
  `${hint.keys.join('+')}:${typeof hint.label === 'string' ? hint.label : hint.label.id}`

export function ContextualHelperPanel({
  hints,
  chipHints = [],
  snapContext = null,
  showPaintScope = false,
  continuationContext = null,
  title = null,
  notice = null,
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
  // A warning about what is in hand (a floor item in a door's way), in the "!" row.
  notice?: string | null
}) {
  const i18n = usePascalI18n()
  const inStack = useInRightStack()
  const [showAllHints, setShowAllHints] = useState(false)
  const hintsId = useId()
  const modeChips = chipHints.filter((hint) => hint.chip)
  const hasChips = !!snapContext || !!continuationContext || modeChips.length > 0 || showPaintScope
  const fenceFeature = useEditor((state) =>
    state.mode === 'build' && state.tool === 'fence' ? state.toolDefaults.fence?.featurePlacement : null,
  )
  if (fenceFeature === 'gate' || fenceFeature === 'opening') return (
    <div className={cn(CARD_CLASS, !inStack && FLOATING_CLASS)} data-hud-card>
      {title ? <HudHeader title={title} /> : null}
      <ChipRow shortcut="Left click" label={fenceFeature === 'gate' ? i18n._({ id: 'editor.helpers.contextualHelperPanel.placeGateOnAFence', message: 'Place gate on a fence' }) : i18n._({ id: 'editor.helpers.contextualHelperPanel.placePassageOnAFence', message: 'Place passage on a fence' })} />
      <ChipRow shortcut="Esc" label={i18n._({ id: 'editor.helpers.contextualHelperPanel.cancelPlacement', message: 'Cancel placement' })} />
    </div>
  )
  if (hints.length === 0 && !hasChips && !notice) return null

  const actionHints = hints.filter((hint) => !isEscHint(hint))
  const escHints = hints.filter(isEscHint)
  const collapsedHints = actionHints.filter(
    (hint, index) => index === 0 || hint.active || isNoteHint(hint),
  )
  const visibleHints = showAllHints ? actionHints : collapsedHints

  return (
    <div
      className={cn(CARD_CLASS, !inStack && FLOATING_CLASS)}
      data-hud-card
    >
      {title ? <HudHeader title={title} /> : null}
      <div id={hintsId} className="col-span-2 grid grid-cols-subgrid gap-y-1.5">
        {visibleHints.map((hint) => (
          <HintRow hint={hint} key={hintKey(hint)} />
        ))}
      </div>
      {collapsedHints.length < actionHints.length ? (
        <button
          aria-controls={hintsId}
          aria-expanded={showAllHints}
          className="pointer-events-auto col-span-2 min-h-7 rounded-md px-1 text-left text-[11px] text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          onClick={() => setShowAllHints((value) => !value)}
          type="button"
        >
          {showAllHints ? i18n._({ id: 'editor.helpers.contextualHelperPanel.fewerShortcuts', message: 'Fewer shortcuts' }) : i18n._({ id: 'editor.helpers.contextualHelperPanel.moreShortcuts', message: 'More shortcuts' })}
        </button>
      ) : null}
      {notice ? <HintRow hint={{ keys: ['!'], label: notice, active: true }} /> : null}
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
