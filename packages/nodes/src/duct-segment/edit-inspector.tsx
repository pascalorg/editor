'use client'

import { type AnyNodeId, type DuctSegmentNode, useScene } from '@pascal-app/core'
import { useMemo, useState } from 'react'
import RunHangerInspector from '../shared/run-hanger-inspector'
import { type DuctEditInput, editDuct } from './edit-operation'

export default function DuctEditInspector({ node }: { node: DuctSegmentNode }) {
  return (
    <>
      <DuctEditForm
        key={`${node.id}:${node.shape}:${node.diameter}:${node.width}:${node.height}:${JSON.stringify(node.path)}`}
        node={node}
      />
      <RunHangerInspector node={node} />
    </>
  )
}

function DuctEditForm({ node }: { node: DuctSegmentNode }) {
  const nodes = useScene((state) => state.nodes)
  const [input, setInput] = useState<DuctEditInput>({
    nodeId: node.id,
    action: 'resize',
    scope: 'segment',
    alignment: 'center',
    shape: node.shape,
    diameter: node.diameter,
    width: node.width,
    height: node.height,
    from: 1,
    to: 2,
    offset: 1,
  })
  const [notice, setNotice] = useState('')
  const preview = useMemo(() => {
    try {
      return { outcome: editDuct(nodes, input, { activeLevelId: node.parentId }), error: '' }
    } catch (error) {
      return {
        outcome: null,
        error: error instanceof Error ? error.message : 'Unable to plan this edit.',
      }
    }
  }, [nodes, input, node.parentId])
  const update = (patch: Partial<DuctEditInput>) => {
    setInput((previous) => ({ ...previous, ...patch }))
    setNotice('')
  }
  const numberField = (
    key: 'diameter' | 'width' | 'height' | 'from' | 'to' | 'offset',
    label: string,
  ) => (
    <label className="flex items-center justify-between gap-2">
      {label}
      <input
        aria-label={label}
        type="number"
        step={input.action === 'offset' ? 0.05 : 1}
        className="w-20 rounded border bg-background p-1"
        value={Number.isFinite(input[key]) ? input[key] : ''}
        onChange={(event) => update({ [key]: event.target.valueAsNumber })}
      />
    </label>
  )
  const changes = preview.outcome?.changes
  const count = (changes?.update?.length ?? 0) + (changes?.create?.length ?? 0)
  const paths =
    input.action === 'offset' && changes
      ? [
          ...changes
            .update!.filter((entry) => entry.id === node.id)
            .map((entry) => (entry.data as DuctSegmentNode).path),
          ...changes.create!.flatMap((entry) =>
            entry.node.type === 'duct-segment' ? [entry.node.path] : [],
          ),
        ]
      : []
  const length = Math.hypot(...node.path[1]!.map((v, i) => v - node.path[0]![i]!))
  const elevation = Math.max(Math.abs(input.offset ?? 1), 0.1)
  const project = (point: number[]) => {
    const along =
      point.reduce(
        (sum, value, i) =>
          sum + (value - node.path[0]![i]!) * (node.path[1]![i]! - node.path[0]![i]!),
        0,
      ) / (length || 1)
    const baseline = (input.offset ?? 0) > 0 ? 90 : 26
    return `${16 + (along / (length || 1)) * 228},${baseline - ((point[1]! - node.path[0]![1]) / elevation) * 64}`
  }
  return (
    <section className="space-y-2 border-t pt-3 text-xs">
      <h3 className="text-sm font-medium">Edit duct route</h3>
      <select
        aria-label="Duct edit"
        className="w-full rounded border bg-background p-1"
        value={input.action}
        onChange={(event) => update({ action: event.target.value as DuctEditInput['action'] })}
      >
        <option value="resize">Resize with connections</option>
        <option value="offset">Offset around obstacle</option>
      </select>
      {input.action === 'resize' ? (
        <>
          <select
            aria-label="Resize scope"
            className="w-full rounded border bg-background p-1"
            value={input.scope}
            onChange={(event) => update({ scope: event.target.value as DuctEditInput['scope'] })}
          >
            <option value="segment">This segment</option>
            <option value="branch">Connected same-size branch</option>
          </select>
          <p className="text-muted-foreground">
            Branch stops at junctions, size changes and equipment. Boundary collars stay fixed.
          </p>
          <select
            aria-label="Duct shape"
            className="w-full rounded border bg-background p-1"
            value={input.shape}
            onChange={(event) => update({ shape: event.target.value as DuctEditInput['shape'] })}
          >
            <option value="round">Round</option>
            <option value="rect">Rectangular</option>
            <option value="oval">Oval</option>
          </select>
          {input.shape === 'round' ? (
            numberField('diameter', 'Diameter (in)')
          ) : (
            <>
              {numberField('width', 'Width (in)')}
              {numberField('height', 'Height (in)')}
            </>
          )}
          <select
            aria-label="Preserve duct alignment"
            className="w-full rounded border bg-background p-1"
            value={input.alignment}
            onChange={(event) =>
              update({ alignment: event.target.value as DuctEditInput['alignment'] })
            }
          >
            <option value="center">Keep centerline</option>
            <option value="top">Keep top face</option>
            <option value="bottom">Keep bottom face</option>
            <option value="left">Keep left face</option>
            <option value="right">Keep right face</option>
          </select>
          <p className="text-muted-foreground">
            Face alignment applies to free straight runs. Left and right follow the run’s section
            axes.
          </p>
        </>
      ) : (
        <>
          {numberField('from', 'First bend from start (m)')}
          {numberField('to', 'Last bend from start (m)')}
          {numberField('offset', 'Vertical offset (m)')}
          <p className="text-muted-foreground">
            Positive moves up; negative moves down. Four elbows preserve both endpoints. Check the
            obstacle’s clearance; this does not detect collisions.
          </p>
        </>
      )}
      {paths.length > 0 && (
        <figure className="rounded border p-2">
          <svg
            viewBox="0 0 260 116"
            role="img"
            aria-label="Offset side elevation preview"
            className="w-full"
          >
            <title>Offset side elevation preview</title>
            <polyline
              points={node.path.map(project).join(' ')}
              fill="none"
              stroke="currentColor"
              opacity="0.3"
              strokeDasharray="4 4"
            />
            <polyline
              points={paths.flat().map(project).join(' ')}
              fill="none"
              stroke="#818cf8"
              strokeWidth="3"
            />
          </svg>
          <figcaption className="text-muted-foreground">
            Side elevation · dashed line is the original route
          </figcaption>
        </figure>
      )}
      <p role="status" className={preview.error ? 'text-amber-600' : 'text-muted-foreground'}>
        {preview.error ||
          `${changes?.update?.length ?? 0} existing parts affected · ${changes?.create?.length ?? 0} new parts`}
      </p>
      <button
        type="button"
        disabled={!count || !!preview.error}
        className="w-full rounded border px-2 py-1 disabled:opacity-40"
        onClick={() => {
          try {
            const outcome = editDuct(useScene.getState().nodes, input, {
              activeLevelId: node.parentId,
            })
            const plan = outcome.changes
            if (plan)
              useScene.getState().applyNodeChanges({
                create: plan.create?.map((entry) => ({
                  ...entry,
                  parentId: entry.parentId as AnyNodeId | undefined,
                })),
                update: plan.update?.map((entry) => ({ ...entry, id: entry.id as AnyNodeId })),
              })
            setNotice(String(outcome.result.message))
          } catch (error) {
            setNotice(error instanceof Error ? error.message : 'Unable to apply edit.')
          }
        }}
      >
        Apply {input.action === 'resize' ? 'resize' : 'offset'}
      </button>
      {notice && <p role="status">{notice}</p>}
    </section>
  )
}
