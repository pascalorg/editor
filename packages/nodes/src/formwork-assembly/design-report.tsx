'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import {
  type ClampRow,
  type ColumnClampType,
  type FormworkSettings,
  formworkSettingsFor,
  type MemberDesign,
  type PourUnit,
  PRESSURE_STANDARD_LABELS,
  type PressureEnvelope,
  pourLimitsFromSettings,
  pourUnitsInScene,
  type SpanGoverning,
  type TieRow,
  toCastableElement,
  type Verification,
  weakestVerification,
} from '@pascal-app/core/formwork'
import { cn, formatLinearMeasurement } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useMemo } from 'react'
import type { CastableHostNode } from './attach'
import { columnPourDesign, slabPourDesign, wallPourDesign } from './design'
import {
  mm,
  Note,
  Readout,
  Section,
  type UnitSystem,
  utilisationClass,
  WarningLine,
} from './report-ui'

/**
 * The design report: what the shutter was sized against, what each member came out
 * at, and where the numbers stop being trustworthy.
 *
 * It exists because the chain is otherwise invisible. `wallDesign`,
 * `falseworkDesign` and `clampSchedule` each resolve a spacing from the pressure,
 * round it onto a setting-out module, and record what governed and how hard the
 * member works — and none of it reached a screen, so a tie at 600 centres looked
 * the same whether it was solved with 40 % in hand or stated by the job at twice
 * its capacity. An unread warning is not a warning.
 *
 * Two figures per member, always. `calculatedM` is the engineering and `adoptedM`
 * is the drawing, and they differ on nearly every member — the module rounds down,
 * a practical ceiling caps, or the job has stated a spacing outright. Printing one
 * of them is how a report comes to look like it agrees with a hand check it does
 * not.
 *
 * The design is not solved here. `design.ts` solves it and the 3D builders place
 * that same result, so the panel and the shutter on screen cannot disagree. What
 * this reads from the scene is only the pour unit, because the pour's height is
 * what the pressure is a function of.
 */

const GOVERNING_LABELS: Record<SpanGoverning, string> = {
  bending: 'bending',
  shear: 'shear',
  deflection: 'deflection',
}

const CASTABLE_TYPES = ['wall', 'column', 'slab'] as const

/**
 * The host, how it is split, and the pour the project designs to. The scope is
 * applied outside the memo, the way `useHostCoverage` does it: the assembly
 * inspector builds a fresh scope object on every render, so memoising on it would
 * recompute the split anyway while looking as though it did not.
 *
 * The settings come from the same scene read rather than from a second hook,
 * because the report must be sized on the pour the 3D shutter was built to — a
 * report resolving them separately could lag a settings edit by a render and
 * print a spacing the model does not have.
 */
function useHostPours(hostId: AnyNodeId | undefined): {
  host: CastableHostNode | undefined
  units: PourUnit[]
  settings: FormworkSettings
} {
  const nodes = useScene((s) => s.nodes)

  return useMemo(() => {
    const settings = formworkSettingsFor(Object.values(nodes))
    const candidate = hostId ? nodes[hostId] : undefined
    if (!candidate || !(CASTABLE_TYPES as readonly string[]).includes(candidate.type)) {
      return { host: undefined, units: [], settings }
    }
    const host = candidate as CastableHostNode
    const element = toCastableElement(host as AnyNode)
    if (!element) return { host, units: [], settings }
    return {
      host,
      settings,
      units: pourUnitsInScene(element, Object.values(nodes), pourLimitsFromSettings(settings)),
    }
  }, [nodes, hostId])
}

export function FormworkDesignReport({
  hostId,
  scope,
  systemId,
}: {
  hostId: AnyNodeId | undefined
  /** Restricts the report to one assembly's own pour unit. */
  scope?: { segmentIndex: number; liftIndex: number }
  /** The catalog system the assembly builds from, where it names one. */
  systemId?: string
}) {
  const unitSystem = useViewer((s) => s.unit)
  const { host, units, settings } = useHostPours(hostId)

  if (!host) {
    return (
      <div className="px-1 text-[11px] text-muted-foreground">
        Host wall, column or slab not found.
      </div>
    )
  }

  if (host.formworkType === undefined || host.formworkType === 'none') {
    return (
      <div className="px-1 text-[11px] text-muted-foreground">
        Not formed — nothing to design. Choose a shuttering system above.
      </div>
    )
  }

  // One unit is the whole element, which is the design the builders solve when the
  // scene has no split — so there is nothing to pick out.
  const split = units.length > 1
  const scoped =
    !split || !scope
      ? units[0]
      : units.find((u) => u.segmentIndex === scope.segmentIndex && u.liftIndex === scope.liftIndex)

  // A scope naming a unit the split no longer produces — the cap was relaxed after
  // the assembly was created. Designing the whole element instead would report a
  // pressure off a lift height this shutter was never built to.
  if (split && scope && !scoped) {
    return (
      <div className="px-1 text-[11px] text-amber-500">
        This assembly's pour unit no longer exists — the host's pour limits changed. Regenerate the
        formwork.
      </div>
    )
  }

  const unit = split ? scoped : undefined

  return (
    <>
      {/* The host panel has no pour to name, so an unscoped report on a split
          element covers the base lift — the one with the kicker under it and, where
          the lifts differ in height, not necessarily the hardest worked. Say which,
          rather than let a figure from one lift read as the wall's. */}
      {split && !scope && (
        <div className="px-1 pb-1 text-[10px] text-muted-foreground leading-snug">
          Cast in {units.length} pours. This is pour {(unit?.segmentIndex ?? 0) + 1}, lift{' '}
          {(unit?.liftIndex ?? 0) + 1} — select a shutter in the tree for the others.
        </div>
      )}
      {host.type === 'wall' ? (
        <WallReport
          settings={settings}
          systemId={systemId}
          unit={unit}
          unitSystem={unitSystem}
          wall={host}
        />
      ) : host.type === 'column' ? (
        <ColumnReport column={host} settings={settings} unit={unit} unitSystem={unitSystem} />
      ) : (
        <SlabReport settings={settings} slab={host} unitSystem={unitSystem} />
      )}
    </>
  )
}

function WallReport({
  settings,
  systemId,
  unit,
  unitSystem,
  wall,
}: {
  settings: FormworkSettings
  systemId: string | undefined
  unit: PourUnit | undefined
  unitSystem: UnitSystem
  wall: Extract<CastableHostNode, { type: 'wall' }>
}) {
  const { design, liftHeightM } = useMemo(
    () => wallPourDesign(settings, wall, unit, systemId),
    [settings, wall, unit, systemId],
  )

  return (
    <div className="space-y-2 px-1 pb-1">
      <EnvelopeSection
        designPressureKnM2={design.designPressureKnM2}
        envelope={design.envelope}
        liftHeightM={liftHeightM}
        settings={settings}
        unitSystem={unitSystem}
      />

      <Section title="Members">
        <MemberRow
          design={design.stud}
          label="Studs"
          note={
            design.sheathing
              ? `Spanning ${design.sheathing.label}.`
              : 'No sheathing named — the span above has no sheet capacity behind it.'
          }
          unitSystem={unitSystem}
        />
        <MemberRow
          design={design.waler}
          label="Walers"
          note={beamNote(design.beam)}
          unitSystem={unitSystem}
        />
        {/* The tie is the one member with no span of its own — it is hardware
            carrying a force — so its `governedBy` is the waler's check and the
            number that matters is the force in the rows below. */}
        <MemberRow
          design={design.tieSpacing}
          label="Ties"
          note={
            design.tie
              ? `${design.tie.label} at ${capacityLabel(design.tieCapacityKn)}, governed at the ${design.tieCapacityComponent}. The spacing is the waler's own check; the force is per row below.`
              : 'No tie named — the spacing is a waler span check with no hardware behind it.'
          }
          unitSystem={unitSystem}
        />
        <Readout
          label="Studs between ties"
          value={String(design.studsBetweenTies)}
          warn={design.studsBetweenTies < 3}
        />
        <Readout label="Tie density" value={`${design.tiesPerM2.toFixed(2)} /m²`} />
      </Section>

      <Section title={`Tie rows — ${design.rows.length} up the lift`}>
        {/* Graded rather than uniform, which is the thing a single spacing cannot
            show: the base row carries the full head and the rows above open out as
            it falls off. */}
        {design.rows.map((row) => (
          <TieRowLine
            capacityKn={design.tieCapacityKn}
            key={row.elevationMm}
            row={row}
            unitSystem={unitSystem}
          />
        ))}
      </Section>

      <Section title="Bracing">
        <Readout
          label="Line load"
          value={`${design.bracing.lineLoadKnM.toFixed(2)} kN/m`}
          value2={design.bracing.governedBy.replaceAll('-', ' ')}
        />
        <Readout label="Raker force" value={`${design.bracing.rakerForceKn.toFixed(1)} kN`} />
        {/* The reaction rather than the applied load is what the anchor sees, and
            the lever is the step most often left out — which is why the anchor is
            the part that fails. */}
        <Readout
          label="Anchor uplift"
          value={`${design.bracing.anchorUpliftKn.toFixed(1)} kN`}
          value2={`at ${formatLinearMeasurement(design.bracing.connectionHeightM, unitSystem)} up`}
        />
        <Note>
          {design.bracing.rakerAngleDeg}° rakers at{' '}
          {formatLinearMeasurement(design.bracing.rakerSpacingM, unitSystem)} centres
          {design.bracing.bothSidesRequired
            ? ', both faces — a guy takes tension only and needs a partner opposite.'
            : '.'}
        </Note>
      </Section>

      <Warnings warnings={design.warnings} />
      <VerificationNote
        entries={[
          { label: design.sheathing?.label ?? '', verification: design.sheathing?.verification },
          { label: design.beam?.label ?? '', verification: design.beam?.verification },
          { label: design.tie?.label ?? '', verification: design.tie?.verification },
        ]}
      />
    </div>
  )
}

function ColumnReport({
  column,
  settings,
  unit,
  unitSystem,
}: {
  column: Extract<CastableHostNode, { type: 'column' }>
  settings: FormworkSettings
  unit: PourUnit | undefined
  unitSystem: UnitSystem
}) {
  const { designPressureKnM2, envelope, facets, form, liftHeightM, schedule, sideM } = useMemo(
    () => columnPourDesign(settings, column, unit),
    [settings, column, unit],
  )

  return (
    <div className="space-y-2 px-1 pb-1">
      <EnvelopeSection
        designPressureKnM2={designPressureKnM2}
        envelope={envelope}
        liftHeightM={liftHeightM}
        settings={settings}
        unitSystem={unitSystem}
      />

      <Section title="Form">
        <Readout
          label="Section"
          value={
            facets === undefined
              ? `${Math.round(column.width * 1000)} × ${Math.round(column.depth * 1000)} mm`
              : `⌀ ${Math.round(column.radius * 2000)} mm`
          }
        />
        {/* The form is *set* to a size rather than cut to the concrete, so the two
            differ and the box laps the difference at its corners. */}
        <Readout
          label="Form set to"
          value={
            schedule.formSizeMm === undefined
              ? facets === undefined
                ? 'bespoke box'
                : `${facets}-sided wrap`
              : `${schedule.formSizeMm} mm`
          }
        />
        <Note>
          {form
            ? `${form.label}, closed in sets of four.`
            : facets === undefined
              ? 'No catalog form reaches this section, so the schedule is pressure and practical limits alone.'
              : 'Banded in hoop tension rather than closed by a clamp set.'}
        </Note>
      </Section>

      <Section title={`Clamp rows — ${schedule.rows.length} rows, ${schedule.clampCount} clamps`}>
        {/* Not evenly spaced: a column is short and filled fast, so the diagram is
            triangular over its whole height and the spacing a clamp takes goes as
            1/h — tight at the base, opening out going up. */}
        {schedule.rows.map((row) => (
          <ClampRowLine
            capacityKn={schedule.clamp?.capacityKn}
            key={row.elevationMm}
            row={row}
            unitSystem={unitSystem}
          />
        ))}
        <Readout label="Sets of four" value={String(schedule.setCount)} />
        <Note>{clampNote(schedule.clamp, sideM, unitSystem)}</Note>
      </Section>

      <Warnings warnings={schedule.warnings} />
      <VerificationNote
        entries={[
          { label: schedule.clamp?.label ?? '', verification: schedule.clamp?.verification },
          { label: form?.label ?? '', verification: form?.verification },
        ]}
      />
    </div>
  )
}

function clampNote(
  clamp: ColumnClampType | undefined,
  sideM: number,
  unitSystem: UnitSystem,
): string {
  if (!clamp) return 'No clamp data — the rows above are geometry rather than design.'
  // Both of the clamp's own limits, because which one bites is not predictable: the
  // corner tension goes as `p·s·b` and the arm's bending as `p·s·b²/8`, so past a
  // few hundred millimetres of section the arm arrives first.
  return `${clamp.label} — ${clamp.capacityKn.toFixed(0)} kN at the corner and ${clamp.bendingMomentKnM.toFixed(1)} kNm in the arm, spanning ${formatLinearMeasurement(sideM, unitSystem)}.`
}

function SlabReport({
  settings,
  slab,
  unitSystem,
}: {
  settings: FormworkSettings
  slab: Extract<CastableHostNode, { type: 'slab' }>
  unitSystem: UnitSystem
}) {
  const { design, soffitHeightM } = useMemo(() => slabPourDesign(settings, slab), [settings, slab])
  const propOver =
    design.propCapacityKn !== undefined && design.propLoadKn > design.propCapacityKn + 1e-6

  return (
    <div className="space-y-2 px-1 pb-1">
      <Section title="Load">
        {/* Two figures because ACI's floor routinely governs a thin slab: a 150 mm
            deck calculates under 4.8 kPa and is designed to it anyway. */}
        <Readout
          label="Design load"
          value={`${design.load.totalKpa.toFixed(2)} kPa`}
          value2={design.load.governedBy === 'code-minimum' ? 'code minimum' : 'calculated'}
        />
        <Readout
          label="Dead + live"
          value={`${design.load.deadKpa.toFixed(2)} + ${design.load.liveKpa.toFixed(2)} kPa`}
          value2={design.load.liveGovernedBy === 'code-minimum' ? 'live at minimum' : undefined}
        />
        {design.load.governedBy === 'code-minimum' && (
          <Note>
            The arithmetic gives {design.load.calculatedKpa.toFixed(2)} kPa; the floor of{' '}
            {design.load.minimumKpa.toFixed(2)} kPa governs.
          </Note>
        )}
      </Section>

      <Section title="Members">
        <MemberRow
          design={design.joist}
          label="Joists"
          note={
            design.sheathing
              ? `Spanning ${design.sheathing.label}.`
              : 'No sheathing named — the span above has no sheet capacity behind it.'
          }
          unitSystem={unitSystem}
        />
        <MemberRow
          design={design.bearer}
          label="Bearers"
          note={beamNote(design.beam)}
          unitSystem={unitSystem}
        />
        <MemberRow design={design.propSpacing} label="Prop pitch" unitSystem={unitSystem} />
      </Section>

      <Section title="Props">
        {/* The prop's tributary cell is bearer spacing one way and prop pitch the
            other, which is the grid it was checked against. */}
        <Readout
          label="Load per prop"
          value={`${design.propLoadKn.toFixed(1)} kN`}
          value2={
            design.propCapacityKn === undefined
              ? 'no rated capacity'
              : `of ${design.propCapacityKn.toFixed(1)} kN`
          }
          warn={propOver}
        />
        <Readout label="Prop density" value={`${design.propsPerM2.toFixed(2)} /m²`} />
        <Note>
          {design.props
            ? `${design.props.label}, extended to ${formatLinearMeasurement(soffitHeightM, unitSystem)}, on a ${mm(design.bearer.adoptedM, unitSystem)} × ${mm(design.propSpacing.adoptedM, unitSystem)} grid.`
            : 'No prop named — the grid above is a beam span check with no prop behind it.'}
        </Note>
      </Section>

      <Warnings warnings={design.warnings} />
      <VerificationNote
        entries={[
          { label: design.sheathing?.label ?? '', verification: design.sheathing?.verification },
          { label: design.beam?.label ?? '', verification: design.beam?.verification },
          { label: design.props?.label ?? '', verification: design.props?.verification },
        ]}
      />
    </div>
  )
}

/** The pressure the whole chain hangs off, and which equation produced it. */
function EnvelopeSection({
  designPressureKnM2,
  envelope,
  liftHeightM,
  settings,
  unitSystem,
}: {
  designPressureKnM2: number
  envelope: PressureEnvelope
  liftHeightM: number
  settings: FormworkSettings
  unitSystem: UnitSystem
}) {
  const placement = settings.stated?.placement
  const assumedRate = placement?.riseRateMH === undefined
  const assumedTemperature = placement?.concreteTemperatureC === undefined
  // Where the ramp reaches `maxKnM2` is most of the difference between the codes,
  // and it is worth hundreds of millimetres of tie spacing — so it is shown rather
  // than folded into the one scalar the members were sized on. A break at or below
  // the base means the pour never reaches the plateau and the diagram is triangular
  // over its whole height.
  const triangular = envelope.hydrostaticHeightM >= liftHeightM - 1e-6
  return (
    <Section title="Pressure">
      <Readout
        label="At the base"
        value={`${designPressureKnM2.toFixed(1)} kN/m²`}
        value2={`peak ${envelope.maxKnM2.toFixed(1)}`}
      />
      <Readout
        label="Shape"
        value={
          triangular
            ? 'triangular throughout'
            : `constant below ${formatLinearMeasurement(envelope.hydrostaticHeightM, unitSystem)}`
        }
        value2={`${envelope.gradientKnM3.toFixed(1)} kN/m³`}
      />
      <Note>
        {PRESSURE_STANDARD_LABELS[envelope.standard]} over{' '}
        {formatLinearMeasurement(liftHeightM, unitSystem)} of pour.
      </Note>
      <Note>{envelope.governingEquation}</Note>
      {/* The rate and the temperature are most of the answer, and until a project
          states them the figure above is derived from a default — so it says which
          of the two it is. A number the reader cannot trace back to a decision
          invites trust it has not earned. */}
      <Readout
        label="Rate of rise"
        value={`${settings.riseRateMH} m/h`}
        value2={assumedRate ? 'assumed' : 'project'}
      />
      <Readout
        label="Concrete at"
        value={`${settings.concreteTemperatureC} °C`}
        value2={assumedTemperature ? 'assumed' : 'project'}
      />
      {(assumedRate || assumedTemperature) && (
        <Note>
          {assumedRate && assumedTemperature
            ? 'Both are the conservative default rather than this project’s pour.'
            : assumedRate
              ? 'The rate is the conservative default — the fastest the code covers.'
              : 'The temperature is DIN’s reference, so no correction was applied.'}{' '}
          Set the pour in the formwork settings to design to it.
        </Note>
      )}
      {envelope.warnings.map((warning) => (
        <WarningLine key={warning.kind + warning.message} message={warning.message} />
      ))}
    </Section>
  )
}

/**
 * One member's two figures and how hard it works.
 *
 * Both are printed because their difference is the information: the module rounded
 * down, a practical ceiling capped, or the job stated a spacing and the check is
 * only reporting against it. A single figure hides which of the three happened.
 */
function MemberRow({
  design,
  label,
  note,
  unitSystem,
}: {
  design: MemberDesign
  label: string
  note?: string
  unitSystem: UnitSystem
}) {
  const over = design.utilisation > 1 + 1e-6
  return (
    <div className="space-y-0.5 border-border/30 border-t pt-1 first:border-t-0 first:pt-0">
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-foreground/90">{label}</span>
        <span className="font-mono text-foreground">{mm(design.adoptedM, unitSystem)}</span>
      </div>
      <div className="flex items-baseline justify-between gap-2 text-[10px] text-muted-foreground">
        <span>
          {design.stated ? 'stated' : `calculated ${mm(design.calculatedM, unitSystem)}`} ·{' '}
          {GOVERNING_LABELS[design.governedBy]} over {design.spans}{' '}
          {design.spans === 1 ? 'span' : 'spans'}
        </span>
        <span className={cn('font-mono', utilisationClass(design.utilisation))}>
          {Math.round(design.utilisation * 100)} %
        </span>
      </div>
      {design.cappedBy === 'practical-maximum' && (
        <Note>
          Held at the practical maximum — the check allowed {mm(design.calculatedM, unitSystem)}.
        </Note>
      )}
      {design.stated && (
        <div
          className={cn(
            'text-[10px] leading-snug',
            over ? 'text-red-400' : 'text-muted-foreground',
          )}
        >
          Stated by the job; the check allows {mm(design.calculatedM, unitSystem)} under{' '}
          {design.loadKnM.toFixed(1)} kN/m{over ? ' — over capacity.' : '.'}
        </div>
      )}
      {note && <Note>{note}</Note>}
    </div>
  )
}

function TieRowLine({
  capacityKn,
  row,
  unitSystem,
}: {
  capacityKn: number
  row: TieRow
  unitSystem: UnitSystem
}) {
  const over = Number.isFinite(capacityKn) && row.forceKn > capacityKn + 1e-6
  return (
    <div className="flex items-baseline justify-between gap-2 text-[10px]">
      <span className="w-14 shrink-0 font-mono text-muted-foreground">
        {mm(row.elevationMm / 1000, unitSystem)}
      </span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {mm(row.horizontalSpacingMm / 1000, unitSystem)} centres · {row.pressureKnM2.toFixed(1)}{' '}
        kN/m²
        {row.monotonicallyWidened ? ' · widened to match below' : ''}
      </span>
      <span className={cn('shrink-0 font-mono', over ? 'text-red-400' : 'text-foreground/80')}>
        {row.forceKn.toFixed(1)} kN
      </span>
    </div>
  )
}

function ClampRowLine({
  capacityKn,
  row,
  unitSystem,
}: {
  capacityKn: number | undefined
  row: ClampRow
  unitSystem: UnitSystem
}) {
  const over = capacityKn !== undefined && row.forceKn > capacityKn + 1e-6
  return (
    <div className="flex items-baseline justify-between gap-2 text-[10px]">
      <span className="w-14 shrink-0 font-mono text-muted-foreground">
        {mm(row.elevationMm / 1000, unitSystem)}
      </span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {mm(row.spacingBelowMm / 1000, unitSystem)} below · {row.governedBy.replaceAll('-', ' ')}
      </span>
      <span className={cn('shrink-0 font-mono', over ? 'text-red-400' : 'text-foreground/80')}>
        {row.forceKn.toFixed(1)} kN
      </span>
    </div>
  )
}

function capacityLabel(capacityKn: number): string {
  return Number.isFinite(capacityKn) ? `${capacityKn.toFixed(0)} kN` : 'no rated capacity'
}

/**
 * The beam's label, and the second published capacity where two sources disagree
 * (4.7).
 *
 * The conflict is reported wherever the beam governs, not only in the catalog: a
 * spacing solved on the permissible pair is the safe answer, and the reader has to
 * see that another source publishes a larger number on a different basis or the
 * disagreement reads as an unexplained conservatism.
 */
function beamNote(
  beam:
    | {
        label: string
        conflict?: { label: string; momentKnM: number; shearKn: number; capacityBasis: string }
      }
    | undefined,
): string | undefined {
  if (!beam) return undefined
  const base = `${beam.label}.`
  if (!beam.conflict) return base
  return `${base} ${beam.conflict.label} publishes ${beam.conflict.momentKnM.toFixed(0)} kNm / ${beam.conflict.shearKn.toFixed(0)} kN on a ${beam.conflict.capacityBasis} basis — the ${base.replace('.', '')} figures above are the permissible pair, which is the conservative answer where the two disagree.`
}

/**
 * The weakest verification across the catalog entries this design was solved from,
 * as one note (8.5).
 *
 * The design report's own fold, at the element scope the report is read at: every
 * member figure here was solved from the named entries, so the report carries their
 * weakest level on its face the way the takeoff and the drawings do. Absent where
 * every named entry is certified, or where none carries a level.
 */
function VerificationNote({
  entries,
}: {
  entries: ReadonlyArray<{ label: string; verification?: string }>
}) {
  const levels = entries
    .map((entry) => entry.verification)
    .filter((level) => level !== undefined) as Verification[]
  const weakest = weakestVerification(levels)
  if (weakest === undefined || weakest === 'certified') return null
  const atLevel = entries.filter((entry) => entry.verification === weakest)
  const names = atLevel.map((entry) => entry.label).slice(0, 5)
  const label: Record<Exclude<Verification, 'certified'>, string> = {
    derived: 'derived by a stated method from cited values',
    secondary: "read off a dealer or secondary listing rather than the manufacturer's own table",
    unverified:
      'unverified — arrived at by stated reasoning with nothing published to check it against',
  }
  return (
    <Note>
      These figures are designed from {names.join(', ')} — {label[weakest]}. The design as a whole
      is {weakest}, so its figures carry that level until the cited document is transcribed.
    </Note>
  )
}

/**
 * Everything the chain could not resolve cleanly, in the design's own words.
 *
 * These carry the point of the report. A stated spacing over capacity, a tie the
 * walers had to close for, coefficients reverse-engineered rather than transcribed
 * — each is a number that looks finished and is not.
 */
function Warnings({ warnings }: { warnings: ReadonlyArray<{ kind: string; message: string }> }) {
  if (warnings.length === 0) {
    return (
      <div className="border-border/40 border-t pt-1.5 text-[10px] text-muted-foreground">
        No warnings — every member is inside capacity at the adopted spacings.
      </div>
    )
  }
  return (
    <div className="space-y-1 border-border/40 border-t pt-1.5">
      {warnings.map((warning) => (
        <WarningLine key={warning.kind + warning.message} message={warning.message} />
      ))}
    </div>
  )
}
