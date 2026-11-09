'use client'
import {
  type AnyNodeId,
  formatNumber,
  type PipeSegmentNode,
  usePascalI18n,
  useScene,
} from '@pascal-app/core'
import { useState } from 'react'
import { resizePipe } from './resize-operation'

export default function PipeResizeInspector({ node }: { node: PipeSegmentNode }) {
  const i18n = usePascalI18n()
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
            ? i18n._({
                id: 'node.pipeSegment.resizeInspector.resizeSummary',
                message:
                  '{runs, plural, one {# run} other {# runs}}, {fittings, plural, one {# fitting} other {# fittings}}, {reducers, plural, one {# new reducer} other {# new reducers}}. Grades stay unchanged.',
                values: {
                  runs: Number(outcome.result.runs),
                  fittings: Number(outcome.result.fittings),
                  reducers: Number(outcome.result.reducers),
                },
              })
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
      setMessage(
        i18n._({
          id: 'node.pipeSegment.resizeInspector.resized',
          message: 'Resized in one undo step. Grades and boundary connections preserved.',
        }),
      )
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : i18n._({
              id: 'node.pipeSegment.resizeInspector.unableToResize',
              message: 'Unable to resize pipe.',
            }),
      )
    }
  }
  return (
    <section className="space-y-2 border-t pt-3 text-xs">
      <h3 className="text-sm font-medium">
        {i18n._({ id: 'node.pipeSegment.resizeInspector.pipeSize', message: 'Pipe size' })}
      </h3>
      <p>
        {i18n._({
          id: 'node.pipeSegment.resizeInspector.currentDiameter',
          message: 'Current diameter: {diameter} in',
          values: { diameter: formatNumber(node.diameter, { locale: i18n.getLocale() }) },
        })}
      </p>
      <label className="flex justify-between">
        {i18n._({ id: 'node.pipeSegment.resizeInspector.diameterIn', message: 'Diameter (in)' })}
        <input
          aria-label={i18n._({
            id: 'node.pipeSegment.resizeInspector.pipeResizeDiameter',
            message: 'Pipe resize diameter',
          })}
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
        aria-label={i18n._({
          id: 'node.pipeSegment.resizeInspector.pipeResizeScope',
          message: 'Pipe resize scope',
        })}
        value={scope}
        onChange={(event) => {
          setScope(event.target.value as typeof scope)
          setMessage('')
        }}
        className="w-full border bg-background p-1"
      >
        <option value="segment">
          {i18n._({ id: 'node.pipeSegment.resizeInspector.thisSegment', message: 'This segment' })}
        </option>
        <option value="branch">
          {i18n._({
            id: 'node.pipeSegment.resizeInspector.connectedBranch',
            message: 'Connected branch',
          })}
        </option>
      </select>
      <p className="text-muted-foreground">
        {i18n._({
          id: 'node.pipeSegment.resizeInspector.branchesStopAtJunctionsSizeOr',
          message:
            'Branches stop at junctions, size or material changes, and fixture connections. Reducers keep boundary collars fixed.',
        })}
      </p>
      <div className="flex gap-2">
        <button type="button" className="flex-1 rounded border p-1" onClick={() => apply(true)}>
          {i18n._({ id: 'node.pipeSegment.resizeInspector.checkResize', message: 'Check resize' })}
        </button>
        <button type="button" className="flex-1 rounded border p-1" onClick={() => apply(false)}>
          {i18n._({
            id: 'node.pipeSegment.resizeInspector.applyPipeSize',
            message: 'Apply pipe size',
          })}
        </button>
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  )
}
