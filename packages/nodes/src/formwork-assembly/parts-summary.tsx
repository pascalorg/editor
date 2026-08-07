'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import {
  bomLines,
  bomWeightKg,
  duplicateMarks,
  type FaceRole,
  type FormworkPart,
  type FormworkSettings,
  formworkSettingsFor,
  type PartLocus,
  partLabel,
  worstUtilisation,
} from '@pascal-app/core/formwork'
import { cn } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useMemo } from 'react'
import type { CastableHostNode } from './attach'
import { FACE_ORDER, FACE_ROLE_LABELS } from './face-labels'
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
import { type SolvedShutter, solveShuttersForHost } from './solve'

/**
 * What this shutter is made of, part by part, and what it takes to order it.
 *
 * The list is solved here from the same `buildFormwork` call the 3D shutter is built
 * from, which is the whole point: a parts table written from the catalog and the
 * spacings on its own would be a second enumeration, and the first edit to either
 * side would have the bill ordering five panels for a run the model draws six on.
 *
 * The geometry that solve also produces is dropped. Its meshes are never added to a
 * scene, so nothing is uploaded to the GPU and nothing needs disposing — and building
 * it is exactly what guarantees the table and the shutter came out of one pass.
 */

const CASTABLE_TYPES = ['wall', 'column', 'slab'] as const

export interface HostShutters {
  host: CastableHostNode | undefined
  settings: FormworkSettings
  shutters: SolvedShutter[]
}

/**
 * Every shutter on this host, solved.
 *
 * The solve itself is `solveShuttersForHost`, shared with the chat tool so the bill
 * the AI quotes is the bill on screen. This is only the store read around it.
 *
 * Memoised on the node map and nothing narrower, the way `useHostPours` and
 * `useHostCoverage` are. A caller passes a fresh scope object every render, so a
 * dependency on the scope would re-solve every shutter on every keystroke elsewhere
 * in the inspector while looking as though it did not.
 */
export function useHostShutters(hostId: AnyNodeId | undefined): HostShutters {
  const nodes = useScene((s) => s.nodes)

  return useMemo(() => {
    const settings = formworkSettingsFor(Object.values(nodes))
    const candidate = hostId ? nodes[hostId] : undefined
    if (!candidate || !(CASTABLE_TYPES as readonly string[]).includes(candidate.type)) {
      return { host: undefined, settings, shutters: [] }
    }
    const host = candidate as CastableHostNode
    return { host, settings, shutters: solveShuttersForHost(host, nodes) }
  }, [nodes, hostId])
}

/** The pour this shutter covers, said the way the design report says it. */
export function shutterLabel(assembly: FormworkAssemblyNode): string {
  return `Pour ${assembly.segmentIndex + 1}, lift ${assembly.liftIndex + 1}`
}

export interface ShutterScope {
  segmentIndex: number
  liftIndex: number
}

function scopedShutters(
  shutters: SolvedShutter[],
  scope: ShutterScope | undefined,
): SolvedShutter[] {
  if (!scope) return shutters
  return shutters.filter(
    (shutter) =>
      shutter.assembly.segmentIndex === scope.segmentIndex &&
      shutter.assembly.liftIndex === scope.liftIndex,
  )
}

/**
 * Why there is nothing to list. Three different answers, because they call for three
 * different actions: fix the selection, choose a system, or generate the shutter.
 */
function EmptyState({ host, scoped }: { host: CastableHostNode | undefined; scoped: boolean }) {
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
        Not formed — nothing to order. Choose a shuttering system above.
      </div>
    )
  }
  if (scoped) {
    return (
      <div className="px-1 text-[11px] text-amber-500">
        This assembly's pour unit no longer exists — the host's pour limits changed. Regenerate the
        formwork.
      </div>
    )
  }
  return (
    <div className="px-1 text-[11px] text-muted-foreground">
      No shutter generated yet — add the formwork geometry above and the parts appear here.
    </div>
  )
}

export function FormworkPartsList({
  hostId,
  scope,
}: {
  hostId: AnyNodeId | undefined
  /** Restricts the list to one assembly's own shutter. */
  scope?: ShutterScope
}) {
  const unitSystem = useViewer((s) => s.unit)
  const { host, shutters } = useHostShutters(hostId)
  const shown = scopedShutters(shutters, scope)

  if (shown.length === 0) {
    return <EmptyState host={host} scoped={Boolean(scope) && shutters.length > 0} />
  }

  return (
    <div className="space-y-2 px-1 pb-1">
      {shown.map((shutter) => (
        <ShutterParts
          key={shutter.assembly.id as string}
          named={shown.length > 1}
          shutter={shutter}
          unitSystem={unitSystem}
        />
      ))}
    </div>
  )
}

function ShutterParts({
  named,
  shutter,
  unitSystem,
}: {
  named: boolean
  shutter: SolvedShutter
  unitSystem: UnitSystem
}) {
  const assemblyId = shutter.assembly.id as string
  const selectedMark = useSelectedPart((s) => s.byAssembly[assemblyId])
  const select = useSelectedPart((s) => s.select)
  const { parts } = shutter

  const worst = worstUtilisation(parts)
  const omitted = parts.filter((part) => part.omitted).length
  const clashes = duplicateMarks(parts)
  const loose = parts.filter((part) => faceOf(part.locus) === undefined)

  return (
    <div className={cn('space-y-1.5', named && 'rounded-md border border-border/30 p-1.5')}>
      {named && (
        <div className="font-medium text-[11px] text-foreground/90">
          {shutterLabel(shutter.assembly)}
        </div>
      )}
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-muted-foreground">
          {parts.length} {parts.length === 1 ? 'part' : 'parts'}
          {omitted > 0 ? ` · ${omitted} omitted` : ''}
        </span>
        {worst && (
          <span className={cn('font-mono', utilisationClass(worst.utilisation))}>
            worst {Math.round(worst.utilisation * 100)} %
          </span>
        )}
      </div>
      {worst && (
        <Note>
          Hardest worked: {partLabel(worst.part)} {worst.part.mark} —{' '}
          {worst.part.structure?.governingCheck}.
        </Note>
      )}
      {/* A mark carries enough of its own position to be collision-free, so a
          duplicate is not a naming problem: it is two parts solved into one spot,
          and the drawing would call both of them the same thing. */}
      {clashes.map((mark) => (
        <WarningLine
          key={mark}
          message={`Two parts share mark ${mark} — the layout placed them at the same position. Check the shutter at that station.`}
        />
      ))}
      {FACE_ORDER.map((role) => (
        <FaceGroup
          key={role}
          onSelect={(mark) => select(assemblyId, mark)}
          parts={parts.filter((part) => faceOf(part.locus) === role)}
          selectedMark={selectedMark}
          title={FACE_ROLE_LABELS[role]}
          unitSystem={unitSystem}
        />
      ))}
      {/* Ties pass through the wall, props stand under the deck, and a box-out is in
          the opening — they belong to the shutter rather than to one of its faces. */}
      <FaceGroup
        onSelect={(mark) => select(assemblyId, mark)}
        parts={loose}
        selectedMark={selectedMark}
        title="Through and under"
        unitSystem={unitSystem}
      />
    </div>
  )
}

function FaceGroup({
  onSelect,
  parts,
  selectedMark,
  title,
  unitSystem,
}: {
  onSelect: (mark: string) => void
  parts: FormworkPart[]
  selectedMark: string | undefined
  title: string
  unitSystem: UnitSystem
}) {
  if (parts.length === 0) return null
  return (
    <Section title={`${title} — ${parts.length}`}>
      {parts.map((part) => (
        <PartRow
          key={part.mark}
          onSelect={onSelect}
          part={part}
          selected={part.mark === selectedMark}
          unitSystem={unitSystem}
        />
      ))}
    </Section>
  )
}

/**
 * One part. Clickable because the mark is the only handle there is on it, and
 * clicking the same part in the 3D shutter writes the same selection — so the row
 * and the thing on screen are two ways into one part rather than two lists that
 * happen to agree.
 */
function PartRow({
  onSelect,
  part,
  selected,
  unitSystem,
}: {
  onSelect: (mark: string) => void
  part: FormworkPart
  selected: boolean
  unitSystem: UnitSystem
}) {
  const utilisation = part.structure?.utilisation
  return (
    <div className="border-border/30 border-t pt-1 first:border-t-0 first:pt-0">
      <button
        className={cn(
          'w-full space-y-0.5 rounded px-1 py-0.5 text-left',
          selected ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]',
        )}
        onClick={() => onSelect(part.mark)}
        type="button"
      >
        <span className="flex items-baseline justify-between gap-2 text-[11px]">
          <span
            className={cn(
              'font-mono',
              part.omitted ? 'text-muted-foreground line-through' : 'text-foreground/90',
            )}
          >
            {part.mark}
          </span>
          <span className="flex items-baseline gap-1.5">
            {part.provenance !== 'standard' && (
              <span className="text-[10px] text-amber-500/80">{part.provenance}</span>
            )}
            {utilisation !== undefined && (
              <span className={cn('font-mono text-[10px]', utilisationClass(utilisation))}>
                {Math.round(utilisation * 100)} %
              </span>
            )}
          </span>
        </span>
        <span className="flex items-baseline justify-between gap-2 text-[10px] text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">
            {partLabel(part)} · {part.description}
          </span>
          <span className="shrink-0 font-mono text-muted-foreground/70">
            {locusLabel(part.locus, unitSystem)}
          </span>
        </span>
      </button>
      {part.omitted && <Note>Left out of the bill — the model still draws it.</Note>}
      {part.note && <Note>{part.note}</Note>}
    </div>
  )
}

/** The face a part is measured against, where its own position is set out on one. */
export function faceOf(locus: PartLocus): FaceRole | undefined {
  switch (locus.on) {
    case 'run':
    case 'facet':
      return locus.face
    case 'elevation':
      return locus.face
    default:
      return undefined
  }
}

/**
 * Where the part is, in the terms its own kind is set out in — the figures the mark
 * encodes, spelled out. A mark is deliberately terse because it is read on site off
 * a panel; this is the setting-out line beside it.
 */
export function locusLabel(locus: PartLocus, unitSystem: UnitSystem): string {
  switch (locus.on) {
    case 'run': {
      const course = locus.courseIndex === undefined ? '' : ` · course ${locus.courseIndex + 1}`
      const elevation =
        locus.elevationMm === undefined ? '' : ` / ${mm(locus.elevationMm / 1000, unitSystem)}`
      return `${mm(locus.stationMm / 1000, unitSystem)}${elevation}${course}`
    }
    case 'facet':
      return `${locus.angleDeg.toFixed(0)}°${
        locus.courseIndex === undefined ? '' : ` · course ${locus.courseIndex + 1}`
      }`
    case 'grid':
      return `${mm(locus.xMm / 1000, unitSystem)} × ${mm(locus.zMm / 1000, unitSystem)}`
    case 'elevation':
      return `${mm(locus.elevationMm / 1000, unitSystem)}${
        locus.stationMm === undefined ? '' : ` / ${mm(locus.stationMm / 1000, unitSystem)}`
      }`
    case 'opening':
      return locus.reveal
    case 'end':
      return locus.end === 'edge' ? 'edge' : `${locus.end} end`
    case 'item':
      return locus.use
  }
}

/**
 * The bill: what to order, in orderable lines.
 *
 * Weight carries its own completeness. A part with no published weight voids its
 * line's total rather than counting as zero, because a total that is quietly short is
 * worse than no total at all — somebody reads it as the lifting weight of the set.
 */
export function FormworkBom({
  hostId,
  scope,
}: {
  hostId: AnyNodeId | undefined
  scope?: ShutterScope
}) {
  const { host, shutters } = useHostShutters(hostId)
  const shown = scopedShutters(shutters, scope)

  if (shown.length === 0) {
    return <EmptyState host={host} scoped={Boolean(scope) && shutters.length > 0} />
  }

  // One bill across every shutter in scope. A wall cast in three lifts is one
  // delivery, and three bills of the same panels is not what gets ordered — but it
  // is also not what stands up at once, which is why the count is stated.
  const lines = bomLines(shown.flatMap((shutter) => shutter.parts))
  const weight = bomWeightKg(lines)

  return (
    <div className="space-y-2 px-1 pb-1">
      {shown.length > 1 && (
        <Note>
          All {shown.length} pours of this element together — what it takes as one order, not what
          is standing at any one time.
        </Note>
      )}
      <Section title={`${lines.length} ${lines.length === 1 ? 'line' : 'lines'}`}>
        {lines.map((line) => (
          <div
            className="space-y-0.5 border-border/30 border-t pt-1 first:border-t-0 first:pt-0"
            key={`${line.kind}-${line.catalogId ?? ''}-${line.description}-${line.provenance}`}
          >
            <div className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="min-w-0 flex-1 truncate text-foreground/90">{line.description}</span>
              <span className="shrink-0 font-mono text-foreground">
                {line.quantity}
                {line.unit === 'no' ? '' : ` ${line.unit}`}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2 text-[10px] text-muted-foreground">
              <span className="min-w-0 flex-1 truncate">
                {line.catalogId ?? 'made on site'}
                {line.provenance === 'standard' ? '' : ` · ${line.provenance}`}
              </span>
              <span className="shrink-0 font-mono">
                {line.totalWeightKg === undefined
                  ? 'weight not stated'
                  : `${line.totalWeightKg.toFixed(0)} kg`}
              </span>
            </div>
          </div>
        ))}
      </Section>
      <Readout
        label="Total weight"
        value={`${weight.totalKg.toFixed(0)} kg`}
        value2={weight.complete ? undefined : 'part of the set'}
      />
      {!weight.complete && (
        <Note>
          Some parts have no published weight, so this totals only the ones that do. It is not the
          lifting weight of the set.
        </Note>
      )}
    </div>
  )
}
