'use client'

import {
  ADJUSTABLE_COLUMN_CLAMPS,
  type CatalogEntry,
  COLUMN_FORMS,
  FALSEWORK_BEAMS,
  type FormworkPart,
  type FormworkSettings,
  mergeFormworkPartOverride,
  orphanedOverrides,
  PART_KIND_LABELS,
  PROP_TYPES,
  partByMark,
  partLabel,
  SHEATHING_TYPES,
  SHEET_STOCK,
  withoutPartOverrides,
} from '@pascal-app/core/formwork'
import type { AnyNodeId } from '@pascal-app/core/schema'
import { cn } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { OptionalSelectField, OptionalToggleField } from '../formwork-project-settings'
import { assemblySystem } from './geometry-shared'
import { locusLabel, useHostShutters } from './parts-summary'
import {
  mm,
  Note,
  Readout,
  Section,
  type UnitSystem,
  utilisationClass,
  WarningLine,
} from './report-ui'
import type { FormworkAssemblyNode } from './schema'
import { useSelectedPart } from './selected-part'

/**
 * One part of the shutter, and the two decisions a person makes about it.
 *
 * The two are substitution and omission, and they are the ones the yard argues about:
 * *this* run uses the 900 panel because the 750s are on another job, and *this* prop is
 * already on site so leave it off the order. Both are recorded against the mark rather
 * than against the solve, so the layout is free to re-solve — a wall that grows keeps
 * every decision whose part it still produces, and reports the ones it no longer does
 * instead of quietly dropping them.
 *
 * There is deliberately no way to edit a size, a length or a utilisation here. Those
 * are results: a panel is 900 wide because the run divides that way at the system's
 * module, and typing 850 over it would produce a bill that does not fit the wall.
 */

const KINDS_WITHOUT_SUBSTITUTES = new Set(['tie', 'brace', 'stop-end', 'accessory', 'consumable'])

/**
 * The catalog entries that could stand in for this part.
 *
 * Narrowed by kind, because a substitution list is only useful if everything on it
 * physically does the job: a prop can be swapped for another prop and a beam for
 * another beam, and offering a sheathing type as an alternative to a waler is how a
 * bill ends up unbuildable. Panels, corners and fillers come from the assembly's own
 * system rather than from every system in the catalog — mixing two manufacturers'
 * panels in one run is a tie-hole mismatch, not a saving.
 */
function substitutesFor(
  part: FormworkPart,
  settings: FormworkSettings,
  systemId: string | undefined,
): readonly CatalogEntry[] {
  const system = assemblySystem(settings, systemId)
  switch (part.kind) {
    case 'panel':
      // A column form is a panel too, and it is what a column's own panels come from.
      return [...(system?.panels ?? []), ...COLUMN_FORMS]
    case 'filler':
      return system?.fillers ?? []
    case 'corner':
      return system?.corners ?? []
    case 'waler':
      return part.member === 'clamp' ? ADJUSTABLE_COLUMN_CLAMPS : FALSEWORK_BEAMS
    case 'joist':
      return FALSEWORK_BEAMS
    case 'ply-piece':
      return [...SHEATHING_TYPES, ...SHEET_STOCK]
    case 'prop':
      return PROP_TYPES
    default:
      return []
  }
}

/**
 * The part picked in the 3D shutter or in the parts table, if it is still there.
 *
 * A mark that stops resolving is normal: the wall was shortened, the tie spacing
 * changed, the panel the click landed on is not in this solve. The selection is
 * cleared on the next render rather than persisted, because a highlighted row for a
 * part that no longer exists reads as a solver fault.
 */
export function FormworkPartInspector({
  node,
  onUpdate,
}: {
  node: FormworkAssemblyNode
  onUpdate: (patch: Partial<FormworkAssemblyNode>) => void
}) {
  const unitSystem = useViewer((s) => s.unit)
  const assemblyId = node.id as string
  const mark = useSelectedPart((s) => s.byAssembly[assemblyId])
  const clear = useSelectedPart((s) => s.clear)
  const { shutters, settings } = useHostShutters(node.parentId as AnyNodeId | undefined)

  const shutter = shutters.find((candidate) => (candidate.assembly.id as string) === assemblyId)
  const parts = shutter?.parts ?? []
  const part = partByMark(parts, mark)
  const stale = orphanedOverrides(parts, node.partOverrides)

  if (mark !== undefined && !part && parts.length > 0) clear(assemblyId)

  return (
    <div className="space-y-2 px-1 pb-1">
      {part ? (
        <PartDetail
          onUpdate={onUpdate}
          overrides={node.partOverrides}
          part={part}
          settings={settings}
          systemId={node.systemId}
          unitSystem={unitSystem}
        />
      ) : (
        <Note>
          Click a panel, waler, tie or prop on the shutter in the viewport — or a row in the parts
          list below — to substitute it or leave it off the order.
        </Note>
      )}
      {stale.length > 0 && (
        <Section title={`${stale.length} stale ${stale.length === 1 ? 'edit' : 'edits'}`}>
          {/* Not discarded automatically. A wall shortened below a panel and then put
              back should get its decisions back, so the orphan waits for somebody to
              say it is genuinely finished with. */}
          <Note>
            These edits name parts this layout no longer produces. They are kept in case the layout
            comes back — clear them once the change is settled.
          </Note>
          {stale.map((orphan) => (
            <div className="font-mono text-[10px] text-muted-foreground" key={orphan}>
              {orphan}
            </div>
          ))}
          <button
            className="mt-1 rounded-md border border-border/50 px-2 py-1 text-[10px] text-foreground/80 hover:bg-accent/40"
            onClick={() =>
              onUpdate({ partOverrides: withoutPartOverrides(node.partOverrides, stale) })
            }
            type="button"
          >
            Discard {stale.length === 1 ? 'it' : 'them all'}
          </button>
        </Section>
      )}
    </div>
  )
}

function PartDetail({
  onUpdate,
  overrides,
  part,
  settings,
  systemId,
  unitSystem,
}: {
  onUpdate: (patch: Partial<FormworkAssemblyNode>) => void
  overrides: FormworkAssemblyNode['partOverrides']
  part: FormworkPart
  settings: FormworkSettings
  systemId: string | undefined
  unitSystem: UnitSystem
}) {
  const utilisation = part.structure?.utilisation
  const substitutes = KINDS_WITHOUT_SUBSTITUTES.has(part.kind)
    ? []
    : substitutesFor(part, settings, systemId)

  // Merged against the record the node currently holds rather than written flat, so
  // leaving a part off the order does not wipe a substitution made a moment before.
  const write = (patch: { catalogId?: string; omitted?: boolean }) =>
    onUpdate({ partOverrides: mergeFormworkPartOverride(overrides, part.mark, patch) })

  return (
    <>
      <Section title={`${partLabel(part)} ${part.mark}`}>
        <Readout label="Kind" value={PART_KIND_LABELS[part.kind]} />
        <Readout label="Item" value={part.description} />
        <Readout label="Position" value={locusLabel(part.locus, unitSystem)} />
        {part.catalogId && <Readout label="Catalog" value={part.catalogId} />}
        <Readout label="Provenance" value={part.provenance} />
        {part.weightKg !== undefined && (
          <Readout label="Weight" value={`${part.weightKg.toFixed(1)} kg`} />
        )}
        {part.weightKg === undefined && (
          <Readout label="Weight" value="not stated" value2="published sheet" />
        )}
        <PartDimensions part={part} unitSystem={unitSystem} />
        {utilisation !== undefined && (
          <div className="flex items-baseline justify-between gap-2 text-[11px]">
            <span className="text-muted-foreground">Utilisation</span>
            <span className="flex items-baseline gap-1.5">
              <span className="text-[10px] text-muted-foreground/70">
                {part.structure?.governingCheck}
              </span>
              <span className={cn('font-mono', utilisationClass(utilisation))}>
                {Math.round(utilisation * 100)} %
              </span>
            </span>
          </div>
        )}
        {utilisation !== undefined && utilisation > 1 && (
          <WarningLine message="This part is beyond its capacity as set out. Tighten the spacing, take a slower rise, or a stronger member." />
        )}
      </Section>
      <Section title="This one, on this pour">
        {substitutes.length > 0 ? (
          <OptionalSelectField
            assumedLabel={part.catalogId ?? 'as solved'}
            hint="What the yard is actually sending. A substitution is recorded as a decision, so the bill shows it as modified rather than folding it back into stock."
            label="Use instead"
            onChange={(value) => write({ catalogId: value })}
            options={substitutes.map((entry) => ({
              label: `${entry.label}${entry.weightKg > 0 ? ` — ${entry.weightKg.toFixed(0)} kg` : ''}`,
              value: entry.id,
            }))}
            value={part.provenance === 'modified' ? part.catalogId : undefined}
          />
        ) : (
          <Note>
            {part.kind === 'tie' || part.kind === 'brace'
              ? 'Ties and braces are sized against the force they carry, so there is nothing to swap them for without redesigning the shutter.'
              : 'Made on site to the shutter rather than ordered, so there is no catalog alternative.'}
          </Note>
        )}
        <OptionalToggleField
          assumed="no"
          hint="Yes leaves it off the bill and off the weight. The model still draws it, because it is still in the shutter — somebody else supplied it."
          label="Already on site"
          onChange={(value) => write({ omitted: value })}
          value={part.omitted ? true : undefined}
        />
      </Section>
    </>
  )
}

/**
 * The figures that make this part orderable, per kind. Read-only: every one of them is
 * an output of the layout, and a size typed over the top of it is a size that does not
 * fit the wall it was solved for.
 */
function PartDimensions({ part, unitSystem }: { part: FormworkPart; unitSystem: UnitSystem }) {
  const size = (widthMm: number, heightMm: number) =>
    `${mm(widthMm / 1000, unitSystem)} × ${mm(heightMm / 1000, unitSystem)}`

  switch (part.kind) {
    case 'panel':
      return (
        <>
          <Readout label="Size" value={size(part.widthMm, part.heightMm)} />
          {part.tieHoleCount !== undefined && (
            <Readout label="Tie holes" value={String(part.tieHoleCount)} />
          )}
        </>
      )
    case 'filler':
      return (
        <>
          <Readout label="Size" value={size(part.widthMm, part.heightMm)} />
          <Readout label="Made from" value={part.madeFrom} />
        </>
      )
    case 'ply-piece':
      return <Readout label="Size" value={size(part.widthMm, part.heightMm)} />
    case 'corner':
      return (
        <>
          <Readout label="Legs" value={`${part.legLengthsMm[0]} / ${part.legLengthsMm[1]} mm`} />
          <Readout label="Height" value={mm(part.heightMm / 1000, unitSystem)} />
          <Readout label="Owned by" value={part.owned ? 'this shutter' : 'the neighbour'} />
        </>
      )
    case 'stop-end':
      return (
        <>
          <Readout label="Area" value={`${part.areaSqM.toFixed(2)} m²`} />
          {part.starterPenetrations && <Note>Starter bars pass through — needs sleeving.</Note>}
        </>
      )
    case 'waler':
    case 'joist':
      return <Readout label="Length" value={mm(part.lengthMm / 1000, unitSystem)} />
    case 'tie':
      return (
        <>
          <Readout label="Length" value={mm(part.lengthMm / 1000, unitSystem)} />
          <Readout
            label="Force"
            value={`${part.forceKn.toFixed(1)} / ${part.capacityKn.toFixed(1)} kN`}
            value2={part.capacityComponent}
          />
        </>
      )
    case 'prop':
      return (
        <>
          <Readout label="Extended to" value={mm(part.extendedLengthMm / 1000, unitSystem)} />
          <Readout
            label="Load"
            value={`${part.loadKn.toFixed(1)} / ${part.capacityKn.toFixed(1)} kN`}
          />
        </>
      )
    case 'brace':
      return (
        <>
          <Readout label="Length" value={mm(part.lengthMm / 1000, unitSystem)} />
          <Readout label="Force" value={`${part.forceKn.toFixed(1)} kN`} />
          <Readout label="Anchor uplift" value={`${part.anchorUpliftKn.toFixed(1)} kN`} />
        </>
      )
    case 'accessory':
      return <Readout label="Quantity" value={String(part.quantity)} />
    case 'consumable':
      return <Readout label="Quantity" value={`${part.quantity} ${part.unit}`} />
  }
}
