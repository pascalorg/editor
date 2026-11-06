'use client'
import { type AnyNodeId, type PipeSegmentNode, useScene } from '@pascal-app/core'
import { useState } from 'react'
import { resizePipe } from './resize-operation'

export default function PipeResizeInspector({ node }: { node: PipeSegmentNode }) {
  const [diameter, setDiameter] = useState(node.diameter)
  const [scope, setScope] = useState<'segment' | 'branch'>('segment')
  const [message, setMessage] = useState('')
  const apply = (preview: boolean) => {
    try {
      const outcome = resizePipe(
        useScene.getState().nodes,
        { nodeId: node.id, diameter, scope },
        { activeLevelId: node.parentId },
      )
      if (preview || !outcome.changes) {
        setMessage(
          outcome.changes
            ? `${outcome.result.runs} runs, ${outcome.result.fittings} fittings, ${outcome.result.reducers} new reducers. Grades stay unchanged.`
            : String(outcome.result.message),
        )
        return
      }
      useScene.getState().applyNodeChanges({
        create: outcome.changes.create?.map((entry) => ({
          ...entry,
          parentId: entry.parentId as AnyNodeId,
        })),
        update: outcome.changes.update?.map((entry) => ({ ...entry, id: entry.id as AnyNodeId })),
      })
      setMessage('Resized in one undo step. Grades and boundary connections preserved.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to resize pipe.')
    }
  }
  return (
    <section className="space-y-2 border-t pt-3 text-xs">
      <h3 className="text-sm font-medium">Pipe size</h3>
      <p>Current diameter: {node.diameter} in</p>
      <label className="flex justify-between">
        Diameter (in)
        <input
          aria-label="Pipe resize diameter"
          type="number"
          min={1.25}
          max={8}
          step={0.25}
          value={Number.isFinite(diameter) ? diameter : ''}
          onChange={(event) => {
            setDiameter(event.target.valueAsNumber)
            setMessage('')
          }}
          className="w-24 border bg-background p-1"
        />
      </label>
      <select
        aria-label="Pipe resize scope"
        value={scope}
        onChange={(event) => {
          setScope(event.target.value as typeof scope)
          setMessage('')
        }}
        className="w-full border bg-background p-1"
      >
        <option value="segment">This segment</option>
        <option value="branch">Connected branch</option>
      </select>
      <p className="text-muted-foreground">
        Branches stop at junctions, size or material changes, and fixture connections. Reducers keep
        boundary collars fixed.
      </p>
      <div className="flex gap-2">
        <button type="button" className="flex-1 rounded border p-1" onClick={() => apply(true)}>
          Check resize
        </button>
        <button type="button" className="flex-1 rounded border p-1" onClick={() => apply(false)}>
          Apply pipe size
        </button>
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  )
}
