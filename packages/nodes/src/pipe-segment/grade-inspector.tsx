'use client'
import { type AnyNodeId, type PipeSegmentNode, useScene } from '@pascal-app/core'
import { useState } from 'react'
import RunHangerInspector from '../shared/run-hanger-inspector'
import { editPipeGrade, type PipeGradeInput } from './grade-operation'
import PipeOffsetInspector from './offset-inspector'
import PipeResizeInspector from './resize-inspector'
import { pipeGrade, pipeGradeLabel } from './slope'

export default function PipeGradeInspector({ node }: { node: PipeSegmentNode }) {
  return (
    <>
      <PipeResizeInspector key={`size:${node.id}:${node.diameter}`} node={node} />
      <GradeForm key={`${node.id}:${JSON.stringify(node.path)}`} node={node} />
      <PipeOffsetInspector key={`offset:${node.id}`} node={node} />
      <RunHangerInspector node={node} />
    </>
  )
}
function GradeForm({ node }: { node: PipeSegmentNode }) {
  const initial = pipeGrade(node.path[0]!, node.path[1]!) ?? 0
  const [grade, setGrade] = useState(Math.abs(initial) * 100)
  const [flow, setFlow] = useState<'forward' | 'reverse'>(initial < 0 ? 'reverse' : 'forward')
  const [anchor, setAnchor] = useState<'start' | 'end'>('start')
  const [elevation, setElevation] = useState(node.path[0]![1])
  const [message, setMessage] = useState('')
  const apply = (input: Partial<PipeGradeInput>) => {
    try {
      const outcome = editPipeGrade(
        useScene.getState().nodes,
        { nodeId: node.id, action: 'grade', anchor, ...input },
        { activeLevelId: node.parentId },
      )
      useScene.getState().applyNodeChanges({
        update: outcome.changes?.update?.map((entry) => ({
          ...entry,
          id: entry.id as AnyNodeId,
        })),
      })
      setMessage('Applied in one undo step.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to edit pipe.')
    }
  }
  return (
    <section className="space-y-2 border-t pt-3 text-xs">
      <h3 className="text-sm font-medium">Grade and flow</h3>
      <p>
        Centerline elevations above level: start {node.path[0]![1].toFixed(3)} m · end{' '}
        {node.path.at(-1)![1].toFixed(3)} m
      </p>
      {node.path.slice(1).map((point, index) => (
        <p key={`${index}:${point.join(',')}`}>
          Leg {index + 1}: {pipeGradeLabel(node.path[index]!, point)}
        </p>
      ))}
      <p className="text-muted-foreground">
        Arrows show downhill direction. Level runs have no gravity fall. Editing a path point
        preserves each leg’s grade.
      </p>
      <label className="flex justify-between">
        Grade (%)
        <input
          aria-label="Pipe grade percent"
          type="number"
          min={0}
          step={0.1}
          value={Number.isFinite(grade) ? grade : ''}
          onChange={(event) => setGrade(event.target.valueAsNumber)}
          className="w-24 border bg-background p-1"
        />
      </label>
      <select
        aria-label="Pipe downhill flow"
        className="w-full border bg-background p-1"
        value={flow}
        onChange={(event) => setFlow(event.target.value as typeof flow)}
      >
        <option value="forward">Start → end</option>
        <option value="reverse">End → start</option>
      </select>
      <select
        aria-label="Fixed pipe endpoint"
        className="w-full border bg-background p-1"
        value={anchor}
        onChange={(event) => {
          const next = event.target.value as typeof anchor
          setAnchor(next)
          setElevation(next === 'start' ? node.path[0]![1] : node.path.at(-1)![1])
        }}
      >
        <option value="start">Keep start elevation</option>
        <option value="end">Keep end elevation</option>
      </select>
      <button
        type="button"
        className="w-full rounded border p-1"
        onClick={() => apply({ gradePercent: grade, flow })}
      >
        Apply grade to horizontal legs
      </button>
      <label className="flex justify-between">
        {anchor === 'start' ? 'Start' : 'End'} elevation (m)
        <input
          aria-label="Pipe anchor elevation"
          type="number"
          step={0.01}
          value={Number.isFinite(elevation) ? elevation : ''}
          onChange={(event) => setElevation(event.target.valueAsNumber)}
          className="w-24 border bg-background p-1"
        />
      </label>
      <button
        type="button"
        className="w-full rounded border p-1"
        onClick={() => apply({ action: 'elevation', elevation })}
      >
        Move elevation, keep grades
      </button>
      {message && <p role="status">{message}</p>}
    </section>
  )
}
