'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import type { WallNode } from '@pascal-app/core/schema'
import type { FormworkSystemNode } from './schema'

/**
 * Read-only summary of the host wall's construction fields, since the
 * formwork node's own schema only carries `panelWidth` — everything else
 * (formworkType/tieSpacing/walerSpacing/scaffoldRequired) that drives
 * `buildFormworkGeometry` lives on the wall. Selecting a formwork node
 * with no panel at all (item 9 in the reported gaps) left users unable
 * to see the assembly's construction state without hunting down the
 * host wall panel.
 */
export function FormworkHostSummary({ node }: { node: FormworkSystemNode }) {
  const setSelection = useViewer((s) => s.setSelection)
  const wall = useScene((s) =>
    node.parentId ? (s.nodes[node.parentId as AnyNodeId] as WallNode | undefined) : undefined,
  )

  if (!wall) {
    return <div className="px-3 py-2 text-muted-foreground text-xs">Host wall not found.</div>
  }

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2 text-xs">
      <SummaryRow label="Formwork type" value={wall.formworkType ?? 'none'} />
      <SummaryRow label="Tie spacing" value={`${(wall.tieSpacing ?? 0.6).toFixed(2)} m`} />
      <SummaryRow label="Waler spacing" value={`${(wall.walerSpacing ?? 0.9).toFixed(2)} m`} />
      <SummaryRow label="Scaffold" value={wall.scaffoldRequired ? 'Required' : 'Not required'} />
      <button
        className="mt-1 self-start rounded-md border border-border/50 px-2 py-1 text-foreground/80 text-xs hover:bg-accent/40"
        onClick={() => setSelection({ selectedIds: [wall.id as AnyNode['id']] })}
        type="button"
      >
        Select host wall
      </button>
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
