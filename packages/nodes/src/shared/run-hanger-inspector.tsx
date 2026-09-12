'use client'

import { type AnyNodeId, emitter, useScene } from '@pascal-app/core'
import { useMemo } from 'react'
import { planRunHangerSlots, type SupportedRun } from './run-hangers'
import SystemCheckPanel from './system-check-panel'

export default function RunHangerInspector({ node }: { node: SupportedRun }) {
  const nodes = useScene((state) => state.nodes)
  const slots = useMemo(() => planRunHangerSlots(node, nodes), [node, nodes])
  if (!node.autoHangers) return <SystemCheckPanel nodeId={node.id} nodes={nodes} />
  const hosts = Object.values(nodes).filter(
    (candidate) =>
      candidate.parentId === node.parentId &&
      (candidate.type === 'wall' || candidate.type === 'ceiling'),
  )
  const update = (id: string, patch: { fraction?: number; skipped?: boolean; hostId?: string }) => {
    const live = useScene.getState().nodes[node.id]
    if (live?.type !== 'duct-segment' && live?.type !== 'pipe-segment') return
    useScene.getState().updateNode(node.id, {
      hangerOverrides: {
        ...live.hangerOverrides,
        [id]: { ...live.hangerOverrides?.[id], ...patch },
      },
    })
  }
  return (
    <>
      <SystemCheckPanel nodeId={node.id} nodes={nodes} />
      <section className="space-y-2 border-t pt-3">
        <h3 className="text-sm font-medium">Individual hangers</h3>
        <p className="text-xs text-muted-foreground">
          Positions are measured along each path segment. Changing spacing regenerates the numbered
          slots.
        </p>
        <div className="max-h-72 space-y-3 overflow-y-auto">
          {slots.map((slot, index) => {
            const a = node.path[slot.segmentIndex]!
            const b = node.path[slot.segmentIndex + 1]!
            const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
            const hostId = node.hangerOverrides?.[slot.id]?.hostId ?? ''
            return (
              <div key={slot.id} className="space-y-1 rounded border p-2 text-xs">
                <div className="flex justify-between">
                  <span>
                    Hanger {index + 1} · segment {slot.segmentIndex + 1}
                  </span>
                  <label>
                    <input
                      type="checkbox"
                      checked={slot.skipped}
                      onChange={(event) => update(slot.id, { skipped: event.target.checked })}
                    />{' '}
                    Skip
                  </label>
                </div>
                {!slot.skipped && !slot.hanger && (
                  <p role="status" className="text-amber-600 dark:text-amber-400">
                    No support within reach. Move the hanger or choose another host.
                  </p>
                )}
                <label className="flex justify-between">
                  Position (m)
                  <input
                    key={`${slot.id}:${slot.fraction}`}
                    aria-label={`Hanger ${index + 1} position in metres`}
                    type="number"
                    min={0}
                    max={length}
                    step={0.1}
                    defaultValue={Number((slot.fraction * length).toFixed(3))}
                    className="w-20 bg-transparent"
                    onBlur={(event) => {
                      const value = event.target.valueAsNumber
                      if (
                        Number.isFinite(value) &&
                        value >= 0 &&
                        value <= length &&
                        Math.abs(value - slot.fraction * length) > 0.0005
                      )
                        update(slot.id, { fraction: value / length })
                      else event.target.value = String(Number((slot.fraction * length).toFixed(3)))
                    }}
                  />
                </label>
                <select
                  aria-label={`Hanger ${index + 1} support`}
                  value={hostId}
                  className="w-full bg-background"
                  onChange={(event) => update(slot.id, { hostId: event.target.value })}
                >
                  <option value="">Automatic support</option>
                  {hostId && !hosts.some((host) => host.id === hostId) && (
                    <option value={hostId}>Missing support</option>
                  )}
                  {hosts.map((host) => (
                    <option key={host.id} value={host.id}>
                      {host.name || host.type} · {host.id.slice(-6)}
                    </option>
                  ))}
                </select>
                {slot.hanger && (
                  <button
                    type="button"
                    className="underline"
                    onClick={() =>
                      emitter.emit('camera-controls:focus', {
                        nodeId: slot.hanger!.hostId as AnyNodeId,
                      })
                    }
                  >
                    Reveal support
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </>
  )
}
