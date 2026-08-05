'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import type { CastableHostNode } from './attach'
import { FormworkCoverageList } from './coverage-summary'
import { FormworkDesignReport } from './design-report'
import { SPACING_LABELS } from './host-controls'
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

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground/90">{value}</span>
    </div>
  )
}
