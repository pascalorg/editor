'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import {
  type ConstructionJointNode,
  type JointTreatment,
  JointTreatmentKind,
} from '@pascal-app/core/schema'

const TREATMENT_LABELS: Record<JointTreatment['kind'], string> = {
  roughening: 'Roughen (CSP 5–7)',
  'shear-key': 'Shear key',
  'starter-bars': 'Starter bars',
  waterstop: 'Waterstop',
  'bonding-agent': 'Bonding agent',
  'injectable-hose': 'Injectable hose',
  'filler-board': 'Filler board',
  'slip-membrane': 'Slip membrane',
  'crack-inducer': 'Crack inducer',
}

/**
 * Treatments as a toggle list rather than a repeating sub-form. Each one changes
 * the stop-end that forms the joint — starter bars need slotted penetrations, a
 * PVC waterstop splits the plate in two — so the set has to be editable, but the
 * per-treatment numbers (waterstop type, key depth) come from the catalog
 * default until a treatment is actually selected.
 */
export function JointTreatmentsEditor({
  node,
  onUpdate,
}: {
  node: ConstructionJointNode
  onUpdate: (patch: Partial<ConstructionJointNode>) => void
}) {
  const active = new Set(node.treatments.map((t) => t.kind))

  const toggle = (kind: JointTreatment['kind']) => {
    const next = active.has(kind)
      ? node.treatments.filter((t) => t.kind !== kind)
      : [...node.treatments, { kind }]
    onUpdate({ treatments: next })
  }

  return (
    <div className="flex flex-col gap-1 px-3 py-2">
      {JointTreatmentKind.options.map((kind) => (
        <label className="flex items-center gap-2 text-xs" key={kind}>
          <input checked={active.has(kind)} onChange={() => toggle(kind)} type="checkbox" />
          <span className="text-foreground/90">{TREATMENT_LABELS[kind]}</span>
        </label>
      ))}
    </div>
  )
}

/**
 * Which elements the joint separates, and whether the solver owns its position.
 * A solver-placed construction joint may be moved to satisfy pour volume; one
 * the engineer specified is a fixed constraint, and the difference decides
 * whether a later re-solve is allowed to touch it.
 */
export function JointScopeSummary({ node }: { node: ConstructionJointNode }) {
  const names = useScene((s) =>
    node.elementIds
      .map((id) => s.nodes[id as AnyNodeId])
      .map((n) => {
        if (!n) return 'missing'
        const name = (n.metadata as { name?: unknown } | null)?.name
        return typeof name === 'string' ? name : n.type
      })
      .join(', '),
  )

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2 text-xs">
      <SummaryRow label="Between" value={names || 'unassigned'} />
      <SummaryRow label="Position" value={node.solverPlaced ? 'solver-placed' : 'fixed'} />
      <SummaryRow
        label="Elevation"
        value={node.elevation === undefined ? 'vertical joint' : `${node.elevation.toFixed(2)} m`}
      />
    </div>
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
