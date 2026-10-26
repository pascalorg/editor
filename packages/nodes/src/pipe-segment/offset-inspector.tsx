'use client'
import { type AnyNodeId, type PipeSegmentNode, useScene } from '@pascal-app/core'
import { useMemo, useState } from 'react'
import { offsetPipe, type PipeOffsetInput } from './offset-operation'

type Point = [number, number, number]
export default function PipeOffsetInspector({ node }: { node: PipeSegmentNode }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="space-y-2 border-t pt-3 text-xs">
      <button
        type="button"
        aria-expanded={open}
        className="w-full text-left text-sm font-medium"
        onClick={() => setOpen(!open)}
      >
        Offset around obstacle
      </button>
      {open && <OffsetForm node={node} />}
    </section>
  )
}
function OffsetForm({ node }: { node: PipeSegmentNode }) {
  const nodes = useScene((state) => state.nodes)
  const start = node.path[0]!,
    end = node.path.at(-1)!
  const length = Math.hypot(end[0] - start[0], end[2] - start[2])
  const [input, setInput] = useState<PipeOffsetInput>({
    nodeId: node.id,
    from: Number((length / 4).toFixed(3)),
    to: Number(((length * 3) / 4).toFixed(3)),
    offset: Number(Math.min(0.5, length / 8).toFixed(3)),
  })
  const [notice, setNotice] = useState('')
  const [appliedPath, setAppliedPath] = useState<string | null>(null)
  const preview = useMemo(() => {
    try {
      return { outcome: offsetPipe(nodes, input, { activeLevelId: node.parentId }), error: '' }
    } catch (error) {
      return {
        outcome: null,
        error: error instanceof Error ? error.message : 'Unable to plan offset.',
      }
    }
  }, [nodes, input, node.parentId])
  const paths = (preview.outcome?.result.paths ?? []) as Point[][]
  const all = [start, end, ...paths.flat()]
  const minY = Math.min(...all.map((p) => p[1])),
    maxY = Math.max(...all.map((p) => p[1]))
  const project = (p: Point) => {
    const distance =
      ((p[0] - start[0]) * (end[0] - start[0]) + (p[2] - start[2]) * (end[2] - start[2])) /
      (length || 1)
    return `${16 + (228 * distance) / (length || 1)},${100 - (80 * (p[1] - minY)) / (maxY - minY || 1)}`
  }
  const apply = () => {
    try {
      const outcome = offsetPipe(useScene.getState().nodes, input, { activeLevelId: node.parentId })
      useScene.getState().applyNodeChanges({
        create: outcome.changes?.create?.map((entry) => ({
          ...entry,
          parentId: entry.parentId as AnyNodeId,
        })),
        update: outcome.changes?.update?.map((entry) => ({ ...entry, id: entry.id as AnyNodeId })),
      })
      setNotice('Offset applied in one undo step. End connections stayed fixed.')
      const appliedNode = useScene.getState().nodes[node.id]
      setAppliedPath(appliedNode?.type === 'pipe-segment' ? JSON.stringify(appliedNode.path) : null)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to apply offset.')
    }
  }
  if (appliedPath === JSON.stringify(node.path)) return <p role="status">{notice}</p>
  return (
    <div className="space-y-2">
      <p>
        Choose the first and last bend by horizontal distance from the start. Positive offset goes
        up; negative goes down. Each connector uses the offset height in horizontal travel.
      </p>
      {(['from', 'to', 'offset'] as const).map((key) => (
        <label key={key} className="flex justify-between gap-2">
          {{ from: 'First bend (m)', to: 'Last bend (m)', offset: 'Vertical offset (m)' }[key]}
          <input
            aria-label={`Pipe offset ${key}`}
            type="number"
            step={0.05}
            className="w-24 border bg-background p-1"
            value={Number.isFinite(input[key]) ? input[key] : ''}
            onChange={(event) => {
              setInput({ ...input, [key]: event.target.valueAsNumber })
              setNotice('')
            }}
          />
        </label>
      ))}
      {paths.length > 0 && (
        <>
          <svg
            viewBox="0 0 260 120"
            role="img"
            aria-label="Pipe offset side profile preview"
            className="w-full rounded border"
          >
            <polyline
              points={[start, end].map(project).join(' ')}
              fill="none"
              stroke="currentColor"
              strokeDasharray="4 4"
              opacity={0.4}
            />
            <polyline
              points={paths.flat().map(project).join(' ')}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            />
            {[start, end].map((point, index) => {
              const [cx, cy] = project(point).split(',')
              return <circle key={index} cx={cx} cy={cy} r={3} fill="currentColor" />
            })}
          </svg>
          <p>
            Side profile (schematic). Four bends · five pipe sections. Parallel sections keep the
            original grade; both end connections stay fixed.
          </p>
          {preview.outcome?.result.uphill === true && (
            <p role="note">
              This offset includes an uphill waste section. It does not provide continuous downhill
              drainage.
            </p>
          )}
        </>
      )}
      <p className="text-muted-foreground">
        Check obstacle clearance. The preview does not detect collisions.
      </p>
      {preview.error && <p role="alert">{preview.error}</p>}
      <button
        type="button"
        disabled={!preview.outcome}
        className="w-full rounded border p-1 disabled:opacity-50"
        onClick={apply}
      >
        Apply pipe offset
      </button>
      {notice && <p role="status">{notice}</p>}
    </div>
  )
}
