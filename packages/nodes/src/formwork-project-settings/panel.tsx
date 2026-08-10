'use client'

import {
  ACI_HALVED_FLOOR_DAYS,
  ACI_SLUMP_LIMIT_MM,
  ACI_VIBRATION_DEPTH_LIMIT_M,
  BS_TEMPERATURE_CAP_C,
  type ConsistencyClass,
  DEFAULT_CONCRETE_TEMPERATURE_C,
  DEFAULT_DENSITY_KG_M3,
  DEFAULT_FALSEWORK_BEAM_ID,
  DEFAULT_FORMWORK_SELF_WEIGHT_KPA,
  DEFAULT_FORMWORK_SYSTEM_ID,
  DEFAULT_MEASUREMENT_STANDARD_ID,
  DEFAULT_PRESSURE_STANDARD_ID,
  DEFAULT_PROP_ID,
  DEFAULT_REBAR_KN_M3,
  DEFAULT_SHEATHING_ID,
  DEFAULT_UNIT_WEIGHT_KN_M3,
  DIN_DEFAULT_REFERENCE_TEMPERATURE_C,
  DIN_MAX_RISE_RATE_MH,
  DIN_REFERENCE_SETTING_H,
  FALSEWORK_BEAMS,
  FORMWORK_SYSTEMS,
  MEASUREMENT_STANDARDS,
  type MeasurementStandardId,
  MIN_LIVE_LOAD_CARTS_KPA,
  MIN_LIVE_LOAD_KPA,
  MIN_QUALIFYING_TEMPERATURE_C,
  MIN_WIND_PRESSURE_KPA,
  PRESSURE_STANDARD_IDS,
  PRESSURE_STANDARD_LABELS,
  PROP_TYPES,
  type PressureStandardId,
  SHEATHING_TYPES,
  STOCKABLE_CATALOG_PARTS,
} from '@pascal-app/core/formwork'
import { ActionButton, PanelSection } from '@pascal-app/editor'
import { RotateCcw } from 'lucide-react'
import {
  GroupNote,
  OptionalNumberField,
  OptionalSelectField,
  OptionalToggleField,
  RateTableField,
  StockRackField,
} from './settings-fields'
import { useFormworkSettingsNode, useFormworkSettingsWriter } from './use-formwork-settings'

/**
 * The pour, as the project decides it.
 *
 * This panel exists because the design report prints numbers the user could not
 * govern. `95.6 kN/m²` with its governing equation beside it is a traceable figure
 * and still an unanswerable one while the rate of rise and the temperature behind
 * it are constants nobody can see — a visible number the reader cannot change
 * invites trust it has not earned.
 *
 * It is a host panel rather than an inspector because the settings node is not
 * selectable: one per scene, no geometry, nothing to click in the viewport. The
 * grouping follows the schema, and each group states which part of the design it
 * moves — the concrete and the placement set the lateral pressure, the curing sets
 * how long the set is held, the soffit loads set the deck, the bracing sets the
 * rakers, and the parts decide what every spacing is a spacing *of*.
 *
 * Every field can be left alone, and that is the design rather than a convenience.
 * The shipped defaults are the conservative reading — DIN's fastest covered rise
 * rate at its own reference temperature — so an untouched project is designed to
 * something defensible, and stating a field is how a job claims the saving its
 * actual pour earns. See `use-formwork-settings.ts` for why a default is never
 * written into an untouched field.
 */

const CONSISTENCY_OPTIONS: Array<{ label: string; value: ConsistencyClass }> = [
  { label: 'F1 — stiff', value: 'F1' },
  { label: 'F2 — plastic', value: 'F2' },
  { label: 'F3 — soft', value: 'F3' },
  { label: 'F4 — very soft', value: 'F4' },
  { label: 'F5 — flowable', value: 'F5' },
  { label: 'F6 — very flowable', value: 'F6' },
  { label: 'SCC — self-compacting', value: 'SCC' },
]

const VIBRATION_OPTIONS: Array<{ label: string; value: 'internal' | 'external' | 'none' }> = [
  { label: 'Internal poker', value: 'internal' },
  { label: 'External, form-mounted', value: 'external' },
  { label: 'None', value: 'none' },
]

const PRESSURE_OPTIONS = PRESSURE_STANDARD_IDS.map((id) => ({
  label: PRESSURE_STANDARD_LABELS[id],
  value: id as PressureStandardId,
}))

const MEASUREMENT_OPTIONS = Object.values(MEASUREMENT_STANDARDS).map((standard) => ({
  label: standard.label,
  value: standard.id as MeasurementStandardId,
}))

const SYSTEM_OPTIONS = Object.values(FORMWORK_SYSTEMS).map((system) => ({
  label: system.label,
  value: system.id,
}))

const SHEATHING_OPTIONS = SHEATHING_TYPES.map((sheathing) => ({
  label: sheathing.label,
  value: sheathing.id,
}))

const BEAM_OPTIONS = FALSEWORK_BEAMS.map((beam) => ({ label: beam.label, value: beam.id }))
const PROP_OPTIONS = PROP_TYPES.map((prop) => ({ label: prop.label, value: prop.id }))

/** A catalog entry's own label, for naming a default rather than printing its id. */
function labelFor(options: ReadonlyArray<{ label: string; value: string }>, id: string): string {
  return options.find((option) => option.value === id)?.label ?? id
}

export function FormworkSettingsPanel() {
  const node = useFormworkSettingsNode()
  const {
    setField,
    setGroupField,
    setCementField,
    setOwnedStock,
    clearOwnedStock,
    setRate,
    setRateTerms,
    clearRates,
    clearAll,
  } = useFormworkSettingsWriter()
  const concrete = node?.concrete ?? {}
  const placement = node?.placement ?? {}
  const curing = node?.curing ?? {}
  const loads = node?.falseworkLoads ?? {}
  const bracing = node?.bracing ?? {}
  const parts = node?.parts ?? {}
  const schedule = node?.schedule ?? {}
  const stated = node !== undefined

  return (
    <div className="subtle-scrollbar flex h-full flex-col overflow-y-auto">
      <div className="px-3 py-3 text-muted-foreground text-xs leading-snug">
        The pour every shutter in this project is designed against. Anything left assumed uses the
        conservative shipped figure, so stating a field is how the job claims the saving its actual
        pour earns.
      </div>

      <PanelSection title="Standards">
        <OptionalSelectField
          assumedLabel={PRESSURE_STANDARD_LABELS[DEFAULT_PRESSURE_STANDARD_ID]}
          hint="Follows the contract and the engineer of record. A panel rated against DIN is not checked by an ACI pressure, which is why the catalog's ratings and this choice have to agree."
          label="Pressure code"
          onChange={(value) => setField('pressureStandard', value)}
          options={PRESSURE_OPTIONS}
          value={node?.pressureStandard}
        />
        <OptionalSelectField
          assumedLabel={MEASUREMENT_STANDARDS[DEFAULT_MEASUREMENT_STANDARD_ID].label}
          hint="The contract's quantity rules — what the client actually pays for, and which openings are deducted."
          label="Measurement"
          onChange={(value) => setField('measurementStandard', value)}
          options={MEASUREMENT_OPTIONS}
          value={node?.measurementStandard}
        />
      </PanelSection>

      <PanelSection title="Placement">
        <GroupNote>
          Most of the lateral pressure is here. The rate is the pump rate divided by the plan area,
          not the truck's; the temperature is the concrete's at placing, not the air's.
        </GroupNote>
        <OptionalNumberField
          assumed={String(DIN_MAX_RISE_RATE_MH)}
          hint={`The fastest rate DIN covers is assumed, which is close to the full fluid head on an ordinary lift. A real pour is usually slower, and saying so is what reduces the design pressure.`}
          label="Rate of rise"
          max={50}
          min={0.1}
          onChange={(value) => setGroupField('placement', { riseRateMH: value })}
          step={0.1}
          unit="m/h"
          value={placement.riseRateMH}
        />
        <OptionalNumberField
          assumed={String(DEFAULT_CONCRETE_TEMPERATURE_C)}
          hint="Colder concrete sets later and pushes harder. DIN's reference is assumed, so no temperature correction is applied until this is stated."
          label="Concrete at"
          max={50}
          min={-10}
          onChange={(value) => setGroupField('placement', { concreteTemperatureC: value })}
          step={1}
          unit="°C"
          value={placement.concreteTemperatureC}
        />
        <OptionalSelectField
          assumedLabel="internal poker"
          hint="External vibration voids ACI's special cases and falls outside DIN's model — either way the pressure jumps to the fluid head."
          label="Compaction"
          onChange={(value) => setGroupField('placement', { vibration: value })}
          options={VIBRATION_OPTIONS}
          value={placement.vibration}
        />
        <OptionalNumberField
          hint={`Past ${ACI_VIBRATION_DEPTH_LIMIT_M} m the poker reaches below the hydrostatic zone and re-liquefies concrete that had begun to stiffen — ACI's special cases are void and the reported pressure is an underestimate.`}
          label="Poker depth"
          max={10}
          min={0.1}
          onChange={(value) => setGroupField('placement', { vibratorImmersionDepthM: value })}
          step={0.1}
          unit="m"
          value={placement.vibratorImmersionDepthM}
        />
        <OptionalToggleField
          assumed="no"
          hint="Pumping in at the base is the full fluid head plus at least 25 % surge, roughly double a top-placed pour."
          label="Pumped from base"
          onChange={(value) => setGroupField('placement', { pumpedFromBase: value })}
          value={placement.pumpedFromBase}
        />
      </PanelSection>

      <PanelSection defaultExpanded={false} title="Curing">
        <GroupNote>
          What happens after the pour, which sets how long the formwork stays on rather than how
          strong it has to be. The temperature here is a different question from the one above and
          runs the opposite way: a colder mix pushes <em>harder</em>, a colder cure holds{' '}
          <em>longer</em>.
        </GroupNote>
        <OptionalNumberField
          assumed={String(BS_TEMPERATURE_CAP_C)}
          hint={`The concrete's surface while it cures — not the placing temperature above. Warmer than ${BS_TEMPERATURE_CAP_C} °C buys nothing, because BS 8110 caps the benefit there, and below ${MIN_QUALIFYING_TEMPERATURE_C} °C every period has to be lengthened.`}
          label="Cures at"
          max={60}
          min={-20}
          onChange={(value) => setGroupField('curing', { surfaceTemperatureC: value })}
          step={1}
          unit="°C"
          value={curing.surfaceTemperatureC}
        />
        <OptionalToggleField
          assumed="no"
          hint="Both codes permit a shorter period and neither says how much shorter, so this shortens nothing here — it reports that the reduction is available for the engineer to approve."
          label="High early strength"
          onChange={(value) => setGroupField('curing', { highEarlyStrength: value })}
          value={curing.highEarlyStrength}
        />
        <OptionalToggleField
          assumed="no"
          hint={`A drophead or early-strip system, where the soffit form comes away and leaves its props standing. ACI 347's footnote ‡ halves the form's period, floored at ${ACI_HALVED_FLOOR_DAYS} days — the clause the whole drophead market exists on.`}
          label="Form leaves props"
          onChange={(value) => setGroupField('curing', { shoresRemain: value })}
          value={curing.shoresRemain}
        />
      </PanelSection>

      <PanelSection defaultExpanded={false} title="Concrete">
        <GroupNote>
          The mix as the codes measure it. Density and unit weight are asked separately on purpose:
          ACI brackets normal-weight concrete at 2240–2400 kg/m³ while DIN validates its
          coefficients at 25 kN/m³, and converting one into the other moves a design out of the band
          its own table came from.
        </GroupNote>
        <OptionalSelectField
          assumedLabel="F3 — soft"
          hint="DIN's class sets both the constant and the slope on the rate. Choose SCC here rather than as a separate switch — it is one fact, and two controls for it would disagree."
          label="Consistency"
          onChange={(value) => {
            // `consistencyClassOf` returns SCC whenever `selfCompacting` is set, so
            // the two are one control. Picking SCC sets the flag the pressure codes
            // actually branch on (ACI has no SCC provisions at all and reads only
            // this); picking an F class clears it, or the class would be ignored.
            setGroupField('concrete', {
              consistencyClass: value,
              selfCompacting: value === 'SCC' ? true : undefined,
            })
          }}
          options={CONSISTENCY_OPTIONS}
          value={concrete.selfCompacting ? 'SCC' : concrete.consistencyClass}
        />
        <OptionalNumberField
          assumed={String(DEFAULT_DENSITY_KG_M3)}
          hint="ACI's w — drives Table 2.1's unit-weight coefficient and the fluid head."
          label="Density"
          max={5000}
          min={100}
          onChange={(value) => setGroupField('concrete', { densityKgM3: value })}
          step={10}
          unit="kg/m³"
          value={concrete.densityKgM3}
        />
        <OptionalNumberField
          assumed={String(DEFAULT_UNIT_WEIGHT_KN_M3)}
          hint="DIN's and CIRIA's γc, and what a soffit's own load is computed from."
          label="Unit weight"
          max={50}
          min={1}
          onChange={(value) => setGroupField('concrete', { unitWeightKnM3: value })}
          step={0.5}
          unit="kN/m³"
          value={concrete.unitWeightKnM3}
        />
        <OptionalNumberField
          hint={`Over ${ACI_SLUMP_LIMIT_MM} mm ACI's special-case formulas do not apply and the fluid head governs.`}
          label="Slump"
          max={300}
          min={0}
          onChange={(value) => setGroupField('concrete', { slumpMm: value })}
          step={5}
          unit="mm"
          value={concrete.slumpMm}
        />
        <OptionalNumberField
          assumed={String(DIN_REFERENCE_SETTING_H)}
          hint="DIN's tE. A mix that stays workable longer keeps pushing over more of the lift, so a late set raises the pressure rather than lowering it."
          label="End of setting"
          max={48}
          min={0.5}
          onChange={(value) => setGroupField('concrete', { endOfSettingH: value })}
          step={0.5}
          unit="h"
          value={concrete.endOfSettingH}
        />
        <OptionalNumberField
          assumed={String(DIN_DEFAULT_REFERENCE_TEMPERATURE_C)}
          hint="DIN's TRef. Only its difference from the placing temperature above matters."
          label="Reference temp"
          max={60}
          min={-20}
          onChange={(value) => setGroupField('concrete', { referenceTemperatureC: value })}
          step={1}
          unit="°C"
          value={concrete.referenceTemperatureC}
        />
      </PanelSection>

      <PanelSection defaultExpanded={false} title="Binder">
        <GroupNote>
          Asked as what the binder is rather than as the coefficient it implies — ACI's Cc and
          CIRIA's C2 are both lookups on these same three questions, so asking once is what lets the
          two codes be compared on one mix.
        </GroupNote>
        <OptionalNumberField
          assumed="0"
          hint="Fraction of the binder replaced by ggbs, 0–1. Over 0.70 is ACI's high blend and worth 40 % on the pressure."
          label="Slag"
          max={1}
          min={0}
          onChange={(value) => setCementField({ slagFraction: value })}
          step={0.05}
          value={concrete.cement?.slagFraction}
        />
        <OptionalNumberField
          assumed="0"
          hint="Fraction replaced by fly ash, 0–1. Over 0.40 is the high blend."
          label="Fly ash"
          max={1}
          min={0}
          onChange={(value) => setCementField({ flyAshFraction: value })}
          step={0.05}
          value={concrete.cement?.flyAshFraction}
        />
        <OptionalToggleField
          assumed="no"
          label="Retarder"
          onChange={(value) => setCementField({ retarder: value })}
          value={concrete.cement?.retarder}
        />
        <OptionalToggleField
          assumed="no"
          hint="Asked separately from the retarder because ACI's Table 2.2 footnote counts a high-range water reducer that delays setting as one — the most commonly missed clause in the chapter, and worth 20 % of the pressure."
          label="Superplasticizer"
          onChange={(value) => setCementField({ superplasticizer: value })}
          value={concrete.cement?.superplasticizer}
        />
        <OptionalNumberField
          assumed="derived from the blend above"
          hint="CIRIA's C2, overriding what the binder implies. Exposed because it is the least verified coefficient in the reference and a job may have been handed one."
          label="CIRIA C2"
          max={10}
          min={0.1}
          onChange={(value) => setGroupField('concrete', { ciriaC2: value })}
          step={0.05}
          value={concrete.ciriaC2}
        />
      </PanelSection>

      <PanelSection defaultExpanded={false} title="Soffit loads">
        <GroupNote>
          What a deck carries beyond the concrete itself. Each is raised to ACI §2.2.1's floor if
          stated lower, so a small figure here cannot design a deck below the code.
        </GroupNote>
        <OptionalNumberField
          assumed={String(DEFAULT_FORMWORK_SELF_WEIGHT_KPA)}
          hint="Deck, joists, bearers and props themselves."
          label="Formwork weight"
          max={10}
          min={0}
          onChange={(value) => setGroupField('falseworkLoads', { formworkSelfWeightKpa: value })}
          step={0.1}
          unit="kPa"
          value={loads.formworkSelfWeightKpa}
        />
        <OptionalNumberField
          assumed={String(DEFAULT_REBAR_KN_M3)}
          hint="Reinforcement, per cubic metre of concrete."
          label="Rebar"
          max={10}
          min={0}
          onChange={(value) => setGroupField('falseworkLoads', { rebarKnM3: value })}
          step={0.1}
          unit="kN/m³"
          value={loads.rebarKnM3}
        />
        <OptionalNumberField
          assumed={String(MIN_LIVE_LOAD_KPA)}
          hint={`Crew, tools and stacked materials. Raised to ${MIN_LIVE_LOAD_KPA} kPa, or ${MIN_LIVE_LOAD_CARTS_KPA} with powered buggies, whatever is entered.`}
          label="Live load"
          max={50}
          min={0}
          onChange={(value) => setGroupField('falseworkLoads', { liveLoadKpa: value })}
          step={0.1}
          unit="kPa"
          value={loads.liveLoadKpa}
        />
        <OptionalToggleField
          assumed="no"
          hint="Powered buggies on the deck raise both the live-load floor and the combined minimum."
          label="Motorized carts"
          onChange={(value) => setGroupField('falseworkLoads', { motorizedCarts: value })}
          value={loads.motorizedCarts}
        />
      </PanelSection>

      <PanelSection defaultExpanded={false} title="Wall bracing">
        <GroupNote>
          A wall form is not braced against the concrete — the ties do that — but against wind,
          against the impact of dumping, and against the code's own minimum, whichever is largest.
        </GroupNote>
        <OptionalNumberField
          assumed={String(MIN_WIND_PRESSURE_KPA)}
          hint="Wind on the form. The code minimum for an exposed wall is assumed."
          label="Wind pressure"
          max={10}
          min={0}
          onChange={(value) => setGroupField('bracing', { windPressureKpa: value })}
          step={0.05}
          unit="kPa"
          value={bracing.windPressureKpa}
        />
        <OptionalNumberField
          assumed="0"
          hint="Weight of the form the bracing holds, per metre of wall — ACI's 2 % term."
          label="Form dead load"
          max={100}
          min={0}
          onChange={(value) => setGroupField('bracing', { formDeadLoadKnM: value })}
          step={0.5}
          unit="kN/m"
          value={bracing.formDeadLoadKnM}
        />
        <OptionalNumberField
          assumed="2"
          hint="Raker centres along the wall. Wider centres put more force through each raker and its anchor."
          label="Raker spacing"
          max={20}
          min={0.5}
          onChange={(value) => setGroupField('bracing', { rakerSpacingM: value })}
          step={0.1}
          unit="m"
          value={bracing.rakerSpacingM}
        />
        <OptionalNumberField
          assumed="45"
          hint="Inclination from the horizontal. A shallower raker takes less uplift and needs more length."
          label="Raker angle"
          max={85}
          min={5}
          onChange={(value) => setGroupField('bracing', { rakerAngleDeg: value })}
          step={5}
          unit="°"
          value={bracing.rakerAngleDeg}
        />
        <OptionalToggleField
          assumed="no"
          hint="A guy takes tension only, so it needs a partner opposite; a raker takes both and one line will do."
          label="Guy wires"
          onChange={(value) => setGroupField('bracing', { guyWires: value })}
          value={bracing.guyWires}
        />
      </PanelSection>

      <PanelSection defaultExpanded={false} title="Parts">
        <GroupNote>
          What the design chain resolves against. These decide what every solved spacing is a
          spacing <em>of</em> — a waler centre is meaningless without the section it belongs to.
        </GroupNote>
        <OptionalSelectField
          assumedLabel={labelFor(SYSTEM_OPTIONS, DEFAULT_FORMWORK_SYSTEM_ID)}
          hint="Panel system for wall and column forms. The layout works in its widths, its corners and its tie holes, so this changes the drawing and not just the rating."
          label="System"
          onChange={(value) => setGroupField('parts', { systemId: value })}
          options={SYSTEM_OPTIONS}
          value={parts.systemId}
        />
        <OptionalSelectField
          assumedLabel={labelFor(SHEATHING_OPTIONS, DEFAULT_SHEATHING_ID)}
          hint="Face material — the ply or the panel's formlining. Sets the stud spacing."
          label="Sheathing"
          onChange={(value) => setGroupField('parts', { sheathingId: value })}
          options={SHEATHING_OPTIONS}
          value={parts.sheathingId}
        />
        <OptionalSelectField
          assumedLabel={labelFor(BEAM_OPTIONS, DEFAULT_FALSEWORK_BEAM_ID)}
          hint="The section used for studs, walers, joists and bearers alike."
          label="Beam"
          onChange={(value) => setGroupField('parts', { beamId: value })}
          options={BEAM_OPTIONS}
          value={parts.beamId}
        />
        <OptionalSelectField
          assumedLabel={labelFor(PROP_OPTIONS, DEFAULT_PROP_ID)}
          hint="Prop under a soffit. Capacity falls with extension and the published table is not monotonic, so this is looked up rather than interpolated."
          label="Prop"
          onChange={(value) => setGroupField('parts', { propId: value })}
          options={PROP_OPTIONS}
          value={parts.propId}
        />
        <OptionalToggleField
          assumed="no"
          hint="Walers paired either side of the tie, which halves what each member bends under and usually opens the tie spacing."
          label="Doubled walers"
          onChange={(value) => setGroupField('parts', { doubledWalers: value })}
          value={parts.doubledWalers}
        />
      </PanelSection>

      <PanelSection defaultExpanded={false} title="Owned stock">
        <GroupNote>
          What the yard already holds, by catalog id — the takeoff draws on these before it hires.
          It is a count rather than a yes/no because ownership is a pool: owning 200 of a panel and
          needing 260 hires 60. The split is per scope, since the same panels serve the next pour
          once stripped, so two levels' owned figures are not a total.
        </GroupNote>
        <StockRackField
          onClear={clearOwnedStock}
          onSet={(catalogId, quantity) => setOwnedStock({ [catalogId]: quantity })}
          options={STOCKABLE_CATALOG_PARTS}
          owned={node?.stock?.owned}
        />
      </PanelSection>

      <PanelSection defaultExpanded={false} title="Rates">
        <GroupNote>
          What the project pays, by catalog id — the one input a takeoff needs that no code
          publishes and no product carries. It is here rather than on the catalog because a price is
          a fact about this project's commercial terms: the same panel is different money to two
          yards in the same city, and different again next quarter. So nothing is assumed for a
          rate, and a bill with no rates carries no money at all rather than a total of zero.
        </GroupNote>
        <RateTableField
          onClear={clearRates}
          onSetRate={setRate}
          onSetTerms={setRateTerms}
          options={STOCKABLE_CATALOG_PARTS}
          rates={node?.rates}
        />
        <GroupNote>
          This prices what the formwork costs to <em>hold</em> — hire for the period charged, the
          list price recharged on hired parts this pour alters, and what is spent. It is not the
          cost of forming the job: there is no labour, no transport and no finance in it, and labour
          is normally the largest of those. Owned stock is excluded rather than priced at zero,
          because a panel the yard already holds amortises over a reuse count nothing here records.
        </GroupNote>
      </PanelSection>

      <PanelSection defaultExpanded={false} title="Programme">
        <GroupNote>
          The two lead times that turn a pour date into a delivery date. Nothing is assumed for
          either, for the rates' reason: a striking period has a published table behind it, a lead
          time is only how this yard works, and a zero would say the shutter appears on the morning
          of the pour. Both are calendar days rather than working days, because a hire is charged
          over a weekend.
        </GroupNote>
        <OptionalNumberField
          hint="Delivery, erecting, aligning and the pre-pour check. Until this is stated the takeoff shows no delivery date at all — only the pour and the strike."
          label="Wanted before pour"
          max={365}
          min={0}
          onChange={(value) => setGroupField('schedule', { erectionLeadDays: value })}
          step={1}
          unit="days"
          value={schedule.erectionLeadDays}
        />
        <OptionalNumberField
          hint="Stripping, cleaning, repair and the trip back. Unstated, the takeoff shows the set free the day it is struck, which is a floor rather than an answer."
          label="Back after striking"
          max={365}
          min={0}
          onChange={(value) => setGroupField('schedule', { returnLeadDays: value })}
          step={1}
          unit="days"
          value={schedule.returnLeadDays}
        />
        <GroupNote>
          The dates themselves are not here. A 9 m wall cast in three lifts is three pours a week
          apart, so a date belongs to a shutter rather than to the project or the wall — set it on
          the assembly, or ask the AI to. Until at least one pour is dated the takeoff carries no
          programme at all, rather than one inferred from the order the shutters were built in.
        </GroupNote>
      </PanelSection>

      {stated && (
        <div className="p-3">
          <ActionButton
            icon={<RotateCcw className="h-3.5 w-3.5" />}
            label="Reset to assumed defaults"
            onClick={clearAll}
          />
        </div>
      )}
    </div>
  )
}

export default FormworkSettingsPanel
