'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { applyPourDatePatch } from '@pascal-app/core/formwork'
import { useViewer } from '@pascal-app/viewer'
import { useState } from 'react'
import type { CastableHostNode } from './attach'
import { FormworkCoverageList } from './coverage-summary'
import { FormworkDesignReport } from './design-report'
import { SPACING_LABELS } from './host-controls'
import { FormworkPartInspector } from './part-inspector'
import { FormworkBom, FormworkPartsList } from './parts-summary'
import type { FormworkAssemblyNode } from './schema'

/**
 * What this assembly covers. A host element can carry several assemblies —
 * one per pour segment per lift — so the scope has to be on screen or two
 * shutters of the same wall are indistinguishable in the inspector.
 */
export function FormworkScopeSummary({ node }: { node: FormworkAssemblyNode }) {
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2 text-xs">
      <SummaryRow label="Pour segment" value={`#${node.segmentIndex + 1}`} />
      <SummaryRow
        label="Lift"
        value={node.liftIndex === 0 ? '1 (base)' : `${node.liftIndex + 1}`}
      />
      <SummaryRow label="System" value={node.systemId ?? 'project default'} />
    </div>
  )
}

/**
 * The day this pour is cast — the one input that turns the striking periods into dates.
 *
 * On the shutter rather than in the project settings because a pour date is per pour: a
 * 9 m wall in three lifts is three dates a week apart, and a field on the wall could only
 * be one of them. The two lead times that turn this into a delivery date *are* project
 * settings, and are the same for every pour on the job.
 *
 * Written through `applyPourDatePatch`, which is core's and shared with both AI surfaces,
 * for the check a date input cannot make: the browser control emits `2026-02-30` for a
 * February the user overtyped, the schema's regex accepts it, and `Date.UTC` reads it back
 * as 1 March — so every date derived from it is a day out while the field still shows what
 * was typed. The refusal is shown rather than swallowed, because a box that silently keeps
 * a value nothing was stored for is worse than one that says why.
 *
 * Nothing is defaulted or suggested here. There is no sequence in this model to read a date
 * off, so an empty field means unprogrammed and the takeoff carries no dates for this pour.
 */
export function FormworkPourDate({
  node,
  onUpdate,
}: {
  node: FormworkAssemblyNode
  onUpdate: (patch: Partial<FormworkAssemblyNode>) => void
}) {
  const [refused, setRefused] = useState<string | undefined>(undefined)

  return (
    <div className="flex flex-col gap-1 px-3 py-2 text-xs">
      <label className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-muted-foreground">Cast on</span>
        <input
          className="h-7 shrink-0 rounded-md border border-border/50 bg-[#2C2C2E] px-2 font-mono text-foreground outline-none"
          defaultValue={node.pourAt ?? ''}
          // Remount when the stored date changes from elsewhere — the AI setting the same
          // pour, or an undo — so the box does not keep a stale draft.
          key={node.pourAt ?? 'unprogrammed'}
          onBlur={(event) => {
            const raw = event.currentTarget.value.trim()
            const result = applyPourDatePatch({ pourAt: raw === '' ? null : raw })
            setRefused(result.error)
            if (result.error === undefined) onUpdate({ pourAt: result.writes.pourAt })
          }}
          type="date"
        />
      </label>
      {refused !== undefined ? (
        <p className="text-[10px] text-amber-400/80 leading-snug">{refused}</p>
      ) : (
        <p className="text-[10px] text-muted-foreground/70 leading-snug">
          {node.pourAt === undefined
            ? 'Unprogrammed, so the takeoff carries no dates for this pour. A date is per pour rather than per element — the other lifts of this element are dated on their own shutters.'
            : 'The delivery and strike dates follow from this and the project’s two lead times. Clear the field to unprogramme the pour.'}
        </p>
      )}
    </div>
  )
}

/**
 * A spacing the job has fixed, or the fact that it has not. An unstated spacing is
 * solved from the pour — it varies up the lift and with the panel system's drilling —
 * so printing a figure here would name one row of a graded grid as if it were the
 * whole schedule.
 */
function stated(spacingM: number | undefined): string {
  return spacingM === undefined ? 'calculated' : `${spacingM.toFixed(2)} m (stated)`
}

/**
 * Read-only summary of the host element's construction fields. The assembly owns
 * its scope, layout, and overrides; the concrete's own properties
 * (formworkType/tieSpacing/walerSpacing/scaffoldRequired, cast order, pour id)
 * belong to the element being cast and are surfaced here with a shortcut to
 * the element's own panel rather than duplicated.
 */
export function FormworkHostSummary({ node }: { node: FormworkAssemblyNode }) {
  const setSelection = useViewer((s) => s.setSelection)
  const host = useScene((s) =>
    node.parentId
      ? (s.nodes[node.parentId as AnyNodeId] as CastableHostNode | undefined)
      : undefined,
  )

  if (!host) {
    return (
      <div className="px-3 py-2 text-muted-foreground text-xs">
        Host wall, column or slab not found.
      </div>
    )
  }

  const labels = SPACING_LABELS[host.type]
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2 text-xs">
      <SummaryRow label="Host" value={host.type} />
      <SummaryRow label="Formwork type" value={host.formworkType ?? 'none'} />
      <SummaryRow label="Mode" value={host.formworkMode ?? 'double-sided'} />
      <SummaryRow label={labels.tie} value={stated(host.tieSpacing)} />
      <SummaryRow label={labels.waler} value={stated(host.walerSpacing)} />
      <SummaryRow label="Scaffold" value={host.scaffoldRequired ? 'Required' : 'Not required'} />
      <SummaryRow
        label="Cast order"
        value={host.castOrder === undefined ? 'unsequenced' : String(host.castOrder)}
      />
      <SummaryRow label="Pour ID" value={host.pourId ?? 'own pour'} />
      <button
        className="mt-1 self-start rounded-md border border-border/50 px-2 py-1 text-foreground/80 text-xs hover:bg-accent/40"
        onClick={() => setSelection({ selectedIds: [host.id as AnyNode['id']] })}
        type="button"
      >
        Select host {host.type}
      </button>
    </div>
  )
}

/**
 * What this shutter was designed against, member by member. Scoped to the
 * assembly's own pour unit: the design is a function of the head, so the base lift
 * of a stack and the one above it are genuinely different shutters and reporting
 * either one's numbers against both would understate the base.
 *
 * The host's spacing fields say only `calculated` or `stated`. This is where a
 * stated spacing that fails its own check says so.
 */
export function FormworkDesignSummary({ node }: { node: FormworkAssemblyNode }) {
  return (
    <FormworkDesignReport
      hostId={node.parentId as AnyNodeId | undefined}
      scope={{ segmentIndex: node.segmentIndex, liftIndex: node.liftIndex }}
      systemId={node.systemId}
    />
  )
}

/**
 * Which faces of the host this assembly actually shutters, and why. The
 * formwork node carries no faces of its own — coverage is derived from the
 * host's cast order against its level neighbours, scoped to this assembly's own
 * pour unit so a stack of lifts doesn't show the same faces three times.
 */
export function FormworkCoverageSummary({ node }: { node: FormworkAssemblyNode }) {
  return (
    <FormworkCoverageList
      hostId={node.parentId as AnyNodeId | undefined}
      scope={{ segmentIndex: node.segmentIndex, liftIndex: node.liftIndex }}
    />
  )
}

/**
 * The one part being looked at. Scoped to this assembly, so a click on the shutter
 * next door does not repoint this panel — the store is keyed by assembly id for the
 * same reason.
 *
 * `onUpdate` is the inspector's own, which is what makes a substitution one undo step:
 * the patch goes through `parametrics.derive` and out in a single `updateNodes` call,
 * and that same call dirties the assembly so the shutter rebuilds with the part
 * omitted or swapped.
 */
export function FormworkSelectedPart({
  node,
  onUpdate,
}: {
  node: FormworkAssemblyNode
  onUpdate: (patch: Partial<FormworkAssemblyNode>) => void
}) {
  return <FormworkPartInspector node={node} onUpdate={onUpdate} />
}

/**
 * Every part of this shutter, grouped by the face it is set out on. Scoped to the
 * assembly's own pour: a lift's parts are the lift's, and merging two lifts' panel
 * lists would produce a table no shutter on site matches.
 */
export function FormworkPartsSummary({ node }: { node: FormworkAssemblyNode }) {
  return (
    <FormworkPartsList
      hostId={node.parentId as AnyNodeId | undefined}
      scope={{ segmentIndex: node.segmentIndex, liftIndex: node.liftIndex }}
    />
  )
}

/**
 * What to order for this shutter. Scoped like the parts list, so the figure is what
 * this pour needs standing at once — the host element's own panel is where the whole
 * element's order is totalled.
 */
export function FormworkBomSummary({ node }: { node: FormworkAssemblyNode }) {
  return (
    <FormworkBom
      hostId={node.parentId as AnyNodeId | undefined}
      scope={{ segmentIndex: node.segmentIndex, liftIndex: node.liftIndex }}
    />
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground/90">{value}</span>
    </div>
  )
}
