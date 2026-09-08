'use client'

import {
  type AnyNode,
  type AnyNodeId,
  emitter,
  getLevelElevations,
  summarizeSystemFor,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useMemo, useState } from 'react'
import { checkDistributionSystems } from './system-checks'

export default function SystemCheckPanel({
  nodeId,
  nodes,
}: {
  nodeId: AnyNodeId
  nodes: Record<AnyNodeId, AnyNode>
}) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('all')
  const summary = useMemo(
    () => (open ? summarizeSystemFor(nodeId, nodes) : null),
    [nodeId, nodes, open],
  )
  const findings = useMemo(() => (open ? checkDistributionSystems(nodes) : []), [nodes, open])
  const reveal = (id: AnyNodeId) => {
    const node = nodes[id]
    if (!node) return
    let parent = node
    const visited = new Set<string>()
    while (parent.parentId && parent.type !== 'level' && !visited.has(parent.id)) {
      visited.add(parent.id)
      const next = nodes[parent.parentId as AnyNodeId]
      if (!next) break
      parent = next
    }
    const buildingId =
      parent.type === 'level' ? getLevelElevations(nodes).get(parent.id)?.buildingId : null
    const building = buildingId ? nodes[buildingId as AnyNodeId] : null
    useViewer.getState().setSelection({
      ...(building?.type === 'building' ? { buildingId: building.id } : {}),
      ...(parent.type === 'level' ? { levelId: parent.id } : {}),
      selectedIds: [id],
    })
    emitter.emit('camera-controls:focus', { nodeId: id })
    emitter.emit('selection:find-node', node)
  }
  return (
    <section className="space-y-2 border-t pt-3">
      <button
        type="button"
        className="text-sm font-medium"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        System checks {open ? '▾' : '▸'}
      </button>
      {open && (
        <>
          {summary && (
            <p className="text-xs text-muted-foreground">
              Selected system: {summary.runCount} runs · {summary.runLengthM.toFixed(2)} m
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Checks cover all distribution systems. Open ends and separate branches may be
            intentional. Intersection warnings use bounding boxes; inspect openings and clearances.
          </p>
          <select
            aria-label="Filter system checks"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="w-full bg-background text-xs"
          >
            <option value="all">All findings ({findings.length})</option>
            <option value="open-end">Open ends</option>
            <option value="connection-mismatch">Incompatible connections</option>
            <option value="disconnected-branch">Disconnected branches</option>
            <option value="possible-intersection">Intersections</option>
            <option value="drainage">Drainage</option>
            <option value="unsupported-hanger">Unsupported hangers</option>
          </select>
          <ul className="max-h-80 space-y-2 overflow-y-auto">
            {findings
              .filter(
                (finding) =>
                  filter === 'all' ||
                  finding.code === filter ||
                  (filter === 'drainage' &&
                    ['slope-too-flat', 'slope-too-steep', 'trap-arm-too-long'].includes(
                      finding.code,
                    )),
              )
              .map((finding, index) => (
                <li
                  key={`${finding.code}:${finding.nodeIds.join(':')}:${index}`}
                  className="rounded border p-2 text-xs"
                >
                  <button
                    type="button"
                    onClick={() => finding.nodeIds[0] && reveal(finding.nodeIds[0])}
                    className={
                      finding.severity === 'error'
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-amber-700 dark:text-amber-400'
                    }
                  >
                    {finding.message}
                  </button>
                  {finding.nodeIds.map((id) => (
                    <button
                      type="button"
                      key={id}
                      className="mr-2 underline"
                      onClick={() => reveal(id)}
                    >
                      {nodes[id]?.name || nodes[id]?.type || id} · {id.slice(-6)}
                    </button>
                  ))}
                </li>
              ))}
          </ul>
          {!findings.length && (
            <p role="status" className="text-xs">
              No findings from the available checks.
            </p>
          )}
        </>
      )}
    </section>
  )
}
