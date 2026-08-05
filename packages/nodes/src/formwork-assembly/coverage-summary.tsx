'use client'

import {
  type AnyNode,
  type AnyNodeId,
  DEDUCTION_REASON_LABELS,
  type ElementCorner,
  type ElementCoverage,
  FACE_REASON_LABELS,
  type FormworkFace,
  faceBandLabel,
  type OpeningMeasurement,
  POUR_CUT_REASON_LABELS,
  type PourUnit,
  pourCoverageForElement,
  useScene,
} from '@pascal-app/core'
import { cn, formatAreaLabel, formatLinearMeasurement, formatVolumeLabel } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useMemo } from 'react'
import { FACE_ORDER, FACE_ROLE_LABELS } from './face-labels'

/**
 * Per-face coverage readout, shared by the wall, column and slab panels and the
 * formwork inspector. It shows the engine's *reason* for each face rather than a
 * panel count: "no shutter here" is only trustworthy if you can see why, and the
 * reason is what an estimator or the AI argues with when the layout looks
 * wrong.
 *
 * Coverage is reported per pour unit, because that is the scope one shutter
 * covers. A wall split into lifts genuinely has a different answer per lift —
 * the lower one's top is a joint, not a finished surface — and a single merged
 * figure would hide exactly the faces the split created.
 */

function nodeLabel(node: AnyNode): string {
  return (node as { name?: string }).name?.trim() || node.type
}

type UnitCoverage = { unit: PourUnit; coverage: ElementCoverage }

const CASTABLE_TYPES = ['wall', 'column', 'slab'] as const
type CastableType = (typeof CASTABLE_TYPES)[number]

/**
 * Classifies one host against its level siblings, plus the openings they host.
 * Cast order is a *relative* input, so the whole level has to be in scope — an
 * element on its own always looks freestanding — and openings hang off the walls
 * rather than the level, so they need collecting separately.
 */
function useHostCoverage(hostId: AnyNodeId | undefined): {
  units: UnitCoverage[]
  names: Map<string, string>
  kind: CastableType | undefined
} {
  const nodes = useScene((s) => s.nodes)

  return useMemo(() => {
    const names = new Map<string, string>()
    if (!hostId) return { units: [], names, kind: undefined }

    const host = nodes[hostId]
    if (!host || !(CASTABLE_TYPES as readonly string[]).includes(host.type)) {
      return { units: [], names, kind: undefined }
    }
    const kind = host.type as CastableType

    const level = host.parentId ? nodes[host.parentId as AnyNodeId] : undefined
    const siblingIds = (level as { children?: string[] } | undefined)?.children ?? []
    const elements: AnyNode[] = [host]
    names.set(host.id, nodeLabel(host))
    for (const id of siblingIds) {
      if (id === hostId) continue
      const node = nodes[id as AnyNodeId]
      if (!node) continue
      elements.push(node)
      names.set(node.id, nodeLabel(node))
    }

    const hostIds = new Set(elements.map((element) => element.id as string))
    for (const node of Object.values(nodes)) {
      if (node.type !== 'door' && node.type !== 'window') continue
      const openingHostId = (node as { wallId?: string }).wallId ?? node.parentId
      if (!openingHostId || !hostIds.has(openingHostId)) continue
      elements.push(node)
      names.set(node.id, nodeLabel(node))
    }

    return { units: pourCoverageForElement(hostId, elements), names, kind }
  }, [nodes, hostId])
}

export function FormworkCoverageList({
  hostId,
  scope,
}: {
  hostId: AnyNodeId | undefined
  /** Restricts the readout to one assembly's own pour unit. */
  scope?: { segmentIndex: number; liftIndex: number }
}) {
  const unit = useViewer((s) => s.unit)
  const { units, names, kind } = useHostCoverage(hostId)

  if (units.length === 0) {
    return (
      <div className="px-1 text-[11px] text-muted-foreground">
        Host wall, column or slab not found.
      </div>
    )
  }

  const shown = scope
    ? units.filter(
        (u) => u.unit.segmentIndex === scope.segmentIndex && u.unit.liftIndex === scope.liftIndex,
      )
    : units

  // A scope naming a unit the split no longer produces — the cap was relaxed
  // after the assembly was created. Say so rather than render an empty panel.
  if (shown.length === 0) {
    return (
      <div className="px-1 text-[11px] text-amber-500">
        This assembly's pour unit no longer exists — the host's pour limits changed. Regenerate the
        formwork.
      </div>
    )
  }

  const split = units.length > 1
  return (
    <div className="space-y-2 px-1 pb-1">
      {shown.map(({ coverage, unit: pour }) => (
        <div
          className={cn(split && 'space-y-1.5 rounded-md border border-border/30 p-1.5')}
          key={`${pour.segmentIndex}-${pour.liftIndex}`}
        >
          {split && <PourUnitHeader kind={kind} unit={pour} unitSystem={unit} />}
          <UnitFaces coverage={coverage} names={names} unitSystem={unit} />
        </div>
      ))}
      {split && !scope && <SplitTotals units={units} unitSystem={unit} />}
    </div>
  )
}

/**
 * What this pour unit is and why it was cut out of the element. The cut reason
 * matters more than the extents: a bay ending because the plant cannot supply
 * more concrete is a different argument from one ending at an expansion joint.
 */
function PourUnitHeader({
  kind,
  unit,
  unitSystem,
}: {
  kind: CastableType | undefined
  unit: PourUnit
  unitSystem: 'metric' | 'imperial'
}) {
  const reasons = [unit.startCutReason, unit.endCutReason].filter(
    (reason): reason is NonNullable<typeof reason> => reason !== undefined,
  )
  const distinct = [...new Set(reasons)]
  // A column is a point on the centreline, so its units differ only in height.
  // Reporting "0.00 m long" for one would read as a bug rather than as geometry.
  const runLength = unit.endAlong - unit.startAlong
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-[11px] text-foreground/90">
          Pour {unit.segmentIndex + 1}
          {unit.liftIndex === 0 ? ' · base lift' : ` · lift ${unit.liftIndex + 1}`}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {formatVolumeLabel(unit.volumeCuM, unitSystem, 2)}
        </span>
      </div>
      <div className="text-[10px] text-muted-foreground leading-snug">
        {kind === 'column' || runLength <= 0
          ? ''
          : `${formatLinearMeasurement(runLength, unitSystem)} long, `}
        {formatLinearMeasurement(unit.topElevation - unit.baseElevation, unitSystem)} high
        {unit.hasJointBelow ? ' — bears on the lift below' : ''}
      </div>
      {distinct.map((reason) => (
        <div className="text-[10px] text-muted-foreground/80 leading-snug" key={reason}>
          {POUR_CUT_REASON_LABELS[reason]}
        </div>
      ))}
    </div>
  )
}

function UnitFaces({
  coverage,
  names,
  unitSystem,
}: {
  coverage: ElementCoverage
  names: Map<string, string>
  unitSystem: 'metric' | 'imperial'
}) {
  const byRole = new Map(coverage.faces.map((face) => [face.role, face]))
  const formedCount = coverage.faces.filter((face) => face.formed).length

  return (
    <div className="space-y-1.5">
      {FACE_ORDER.map((role) => {
        const face = byRole.get(role)
        if (!face) return null
        return (
          <CoverageRow
            face={face}
            key={role}
            names={names}
            neighbourName={face.neighbourId ? names.get(face.neighbourId) : undefined}
            unit={unitSystem}
          />
        )
      })}
      {coverage.openings.map((opening) => (
        <OpeningRow
          key={opening.openingId}
          name={names.get(opening.openingId) ?? opening.kind}
          opening={opening}
          unit={unitSystem}
        />
      ))}
      <CornerSummary corners={coverage.corners} names={names} unit={unitSystem} />
      <div className="flex items-center justify-between border-border/40 border-t pt-1.5 text-[11px]">
        <span className="text-muted-foreground">
          {formedCount} formed {formedCount === 1 ? 'face' : 'faces'}
        </span>
        <span className="font-mono text-foreground/90">
          {formatAreaLabel(coverage.physicalArea, unitSystem, 2)}
        </span>
      </div>
      {/* Two numbers, always. `measured` is what the contract pays for and
          `physical` is what you cut, and they only agree on a wall with no
          openings and no junctions. */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Measured (contract)</span>
        <span className="font-mono">{formatAreaLabel(coverage.measuredArea, unitSystem, 2)}</span>
      </div>
    </div>
  )
}

/**
 * The whole element's cost once split. This is deliberately larger than the
 * unsplit figure — every lift joint adds a top and every pour break two
 * bulkheads — and that difference is the number to argue about when deciding
 * where the joints go.
 */
function SplitTotals({
  units,
  unitSystem,
}: {
  units: UnitCoverage[]
  unitSystem: 'metric' | 'imperial'
}) {
  const physical = units.reduce((sum, u) => sum + u.coverage.physicalArea, 0)
  const measured = units.reduce((sum, u) => sum + u.coverage.measuredArea, 0)
  return (
    <div className="space-y-0.5 border-border/40 border-t pt-1.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{units.length} pours, all lifts</span>
        <span className="font-mono text-foreground/90">
          {formatAreaLabel(physical, unitSystem, 2)}
        </span>
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Measured (contract)</span>
        <span className="font-mono">{formatAreaLabel(measured, unitSystem, 2)}</span>
      </div>
    </div>
  )
}

/**
 * The corner units this element's faces turn onto, and which of them it pays
 * for. Both walls at an L see the same unit and only one bills it, so a panel
 * showing a bare count would read as a double-count to anyone checking the BOM
 * against the model — the split is the number that has to be visible.
 */
function CornerSummary({
  corners,
  names,
  unit,
}: {
  corners: ElementCorner[]
  names: Map<string, string>
  unit: 'metric' | 'imperial'
}) {
  const formed = corners.filter((corner) => corner.formed)
  if (formed.length === 0) return null
  const owned = formed.filter((corner) => corner.owns)
  const inside = owned.filter((corner) => corner.corner.side === 'inside').length
  const outside = owned.length - inside

  return (
    <div className="rounded-md border border-border/40 border-dashed px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground/90 text-xs">Corner units</span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {inside} inside · {outside} outside
        </span>
      </div>
      {formed.length > owned.length && (
        <div className="text-[10px] text-muted-foreground leading-snug">
          {formed.length - owned.length} more turn onto this element but are billed by the neighbour
          cast first.
        </div>
      )}
      {formed.map((corner, index) => (
        <div
          className="text-[10px] text-muted-foreground/80 leading-snug"
          // Two units can land on one face at one point — a T's spine — so the
          // leg alone is not a key.
          key={`${corner.corner.side}-${corner.leg.face}-${corner.leg.alongM}-${index}`}
        >
          {corner.corner.side === 'inside' ? 'Inside' : 'Outside'} ·{' '}
          {corner.leg.face === 'a' ? 'front' : 'back'} face at{' '}
          {formatLinearMeasurement(corner.leg.alongM, unit)}
          {corner.owns ? '' : ` — billed by ${cornerNeighbourName(corner, names)}`}
        </div>
      ))}
    </div>
  )
}

function cornerNeighbourName(corner: ElementCorner, names: Map<string, string>): string {
  const other = corner.corner.legs.find((leg) => leg.elementId !== corner.leg.elementId)
  return (other && names.get(other.elementId)) ?? 'the neighbour'
}

function OpeningRow({
  name,
  opening,
  unit,
}: {
  name: string
  opening: OpeningMeasurement
  unit: 'metric' | 'imperial'
}) {
  const net = opening.revealAreaSqM - 2 * opening.measuredDeductionPerFace
  return (
    <div className="rounded-md border border-border/40 border-dashed px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground/90 text-xs">{name}</span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {net >= 0 ? '+' : '−'}
          {formatAreaLabel(Math.abs(net), unit, 2)}
        </span>
      </div>
      <div className="text-[10px] text-muted-foreground leading-snug">
        {DEDUCTION_REASON_LABELS[opening.reason]}
        {opening.extraOverBand ? ` (${opening.extraOverBand})` : ''}
      </div>
      <div className="text-[10px] text-muted-foreground/80 leading-snug">
        {opening.revealSides} reveal {opening.revealSides === 1 ? 'side' : 'sides'},{' '}
        {formatAreaLabel(opening.revealAreaSqM, unit, 2)}
        {opening.revealsMeasured ? '' : ' — deemed included in the opening item'}
      </div>
    </div>
  )
}

/** Losses to a neighbour rather than to an opening — the corner overlap rules. */
function trimDeductionsOf(face: FormworkFace) {
  return face.deductions.filter(
    (deduction) =>
      deduction.reason === 'CORNER_OVERLAP_REASSIGNED' || deduction.reason === 'INTERSECTION',
  )
}

function CoverageRow({
  face,
  names,
  neighbourName,
  unit,
}: {
  face: FormworkFace
  names: Map<string, string>
  neighbourName: string | undefined
  unit: 'metric' | 'imperial'
}) {
  return (
    <div
      className={cn(
        'rounded-md border px-2 py-1.5',
        face.formed ? 'border-border/60 bg-white/[0.02]' : 'border-border/30',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            'font-medium text-xs',
            face.formed ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {FACE_ROLE_LABELS[face.role]}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {face.formed ? formatAreaLabel(face.physicalArea, unit, 2) : 'no shutter'}
        </span>
      </div>
      <div className="text-[10px] text-muted-foreground leading-snug">
        {FACE_REASON_LABELS[face.reason]}
        {neighbourName ? ` (${neighbourName})` : ''}
      </div>
      {/* The contract's reading of this face, which is not always the unit its
          area is measured in: a nib or a slab edge is billed by the metre. The
          stage labels stay in the clause's own units — "≤ 200 mm" is the band's
          name, not a length to convert. */}
      {face.measurement && (
        <div
          className="font-mono text-[10px] text-muted-foreground/80 leading-snug"
          title={face.measurement.sourceRefs.join('\n')}
        >
          {face.measurement.unit === 'm'
            ? `${formatLinearMeasurement(face.measurement.quantity, unit)} run`
            : formatAreaLabel(face.measurement.quantity, unit, 2)}
          {faceBandLabel(face.measurement) ? ` · ${faceBandLabel(face.measurement)}` : ''}
        </div>
      )}
      {/* Why this face is smaller than its rectangle, and who took the rest. A
          trimmed area with no named owner is the complaint the audit trail
          exists to answer: "12 m² instead of 15" invites the question. */}
      {trimDeductionsOf(face).map((deduction) => (
        <div
          className="text-[10px] text-muted-foreground/80 leading-snug"
          key={`${deduction.reason}-${deduction.sourceId}`}
        >
          −{formatAreaLabel(deduction.physicalSqM, unit, 2)} ·{' '}
          {names.get(deduction.sourceId) ?? 'neighbour'} —{' '}
          {DEDUCTION_REASON_LABELS[deduction.reason]}
        </div>
      ))}
      {face.reason === 'STOP_END_UNSEQUENCED' && (
        <div className="text-[10px] text-amber-500 leading-snug">
          Set cast order on both elements to resolve this.
        </div>
      )}
      {face.starterPenetrations && (
        <div className="text-[10px] text-muted-foreground/80 leading-snug">
          Starter bars penetrate this bulkhead.
        </div>
      )}
      {face.upliftLoaded && (
        <div className="text-[10px] text-muted-foreground/80 leading-snug">
          Loaded in uplift — needs hold-down anchors, not props.
        </div>
      )}
    </div>
  )
}
