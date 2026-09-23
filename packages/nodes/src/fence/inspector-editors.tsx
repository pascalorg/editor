'use client'

import {
  type FenceNode,
  getClampedWallCurveOffset,
  getFenceCenterlineLength,
  getFenceControlHandle,
  getMaxWallCurveOffset,
  getWallArcData,
  getWallCurveFrameAt,
  getWallCurveLength,
  normalizeWallCurveOffset,
  sampleFenceSpline,
} from '@pascal-app/core'
import { SliderControl } from '@pascal-app/editor'

/**
 * Custom inspector editors for fence fields that don't map to a single
 * node property in the canonical way:
 *
 * - **Length** is derived from `start`/`end`. Adjusting the slider
 *   moves `end` along the existing direction so the fence resizes from
 *   the start point. Matches the legacy `FencePanel`'s "Length" slider.
 * - **Curve** is a slider on `curveOffset` with min/max bounded by the
 *   chord length (per-node), normalized via `normalizeWallCurveOffset`.
 *   Can't use a plain `number` field because the bounds change with
 *   the fence's shape.
 *
 * Both are wired through `parametrics.fields[].kind: 'custom'`.
 */
export function FenceLengthEditor({
  node,
  onUpdate,
}: {
  node: FenceNode
  onUpdate: (patch: Partial<FenceNode>) => void
}) {
  const length = getWallCurveLength(node)

  const handleChange = (newLength: number) => {
    if (newLength <= 0) return
    const dx = node.end[0] - node.start[0]
    const dz = node.end[1] - node.start[1]
    const currentLength = Math.sqrt(dx * dx + dz * dz)
    if (currentLength === 0) return
    const dirX = dx / currentLength
    const dirZ = dz / currentLength
    const newEnd: [number, number] = [
      node.start[0] + dirX * newLength,
      node.start[1] + dirZ * newLength,
    ]
    onUpdate({ end: newEnd })
  }

  return (
    <SliderControl
      label="Length"
      max={50}
      min={0.1}
      onChange={handleChange}
      precision={2}
      step={0.01}
      unit="m"
      value={length}
    />
  )
}

export function FenceCurveEditor({
  node,
  onUpdate,
}: {
  node: FenceNode
  onUpdate: (patch: Partial<FenceNode>) => void
}) {
  const curveOffset = getClampedWallCurveOffset(node)
  const maxCurveOffset = getMaxWallCurveOffset(node)

  return (
    <div className="space-y-2">
      <SliderControl
        label="Curve"
        max={Math.max(0.01, maxCurveOffset)}
        min={-Math.max(0.01, maxCurveOffset)}
        onChange={(value) => onUpdate({ curveOffset: normalizeWallCurveOffset(node, value) })}
        precision={2}
        step={0.1}
        unit="m"
        value={curveOffset}
      />
      <button
        type="button"
        className="rounded border px-2 py-1 text-xs"
        onClick={() => {
          const arc = getWallArcData(node)
          const spans = arc ? 4 : 1
          const handleLength = arc
            ? (4 / 3) * arc.radius * Math.tan(Math.abs(arc.delta) / spans / 4)
            : getWallCurveLength(node) / 3
          const frames = Array.from({ length: spans + 1 }, (_, i) =>
            getWallCurveFrameAt(node, i / spans),
          )
          onUpdate({
            path: frames.map((frame) => [frame.point.x, frame.point.y]),
            tangents: frames.map((frame) => [
              frame.tangent.x * handleLength,
              frame.tangent.y * handleLength,
            ]),
            curveOffset: undefined,
          })
        }}
      >
        Edit as free curve
      </button>
    </div>
  )
}

export function FencePathEditor({
  node,
  onUpdate,
}: {
  node: FenceNode
  onUpdate: (patch: Partial<FenceNode>) => void
}) {
  const path = node.path ?? []
  const tangents = path.map((_, i) => node.tangents?.[i] ?? null)
  const update = (points: [number, number][], handles = tangents) => {
    if (points.length < 2) return
    onUpdate({ path: points, tangents: handles, start: points[0]!, end: points.at(-1)! })
  }
  return (
    <div className="space-y-2 text-xs">
      <p>
        {path.length} points · {getFenceCenterlineLength(node).toFixed(2)} m
      </p>
      <p className="text-muted-foreground">
        Drag the point handles in either view, or edit coordinates below.
      </p>
      {path.map((point, index) => (
        <details key={`curve-editor-${index}`} className="rounded border p-2">
          <summary className="cursor-pointer">Point {index + 1}</summary>
          <div className="mt-2 flex gap-2">
            {(['X', 'Z'] as const).map((axis, coordinate) => (
              <label key={axis} className="min-w-0 flex-1">
                {axis} (m)
                <input
                  type="number"
                  step="0.05"
                  className="w-full rounded border bg-transparent p-1"
                  key={`${index}-${axis}-${point[coordinate]}`}
                  defaultValue={point[coordinate]}
                  onBlur={(event) => {
                    const value = event.currentTarget.valueAsNumber
                    if (!Number.isFinite(value) || value === point[coordinate]) return
                    update(
                      path.map((p, i): [number, number] =>
                        i === index ? (coordinate === 0 ? [value, p[1]] : [p[0], value]) : p,
                      ),
                    )
                  }}
                />
              </label>
            ))}
          </div>
          <label className="mt-2 flex items-center justify-between">
            Join
            <select
              className="rounded border bg-background p-1"
              value={tangents[index]?.[0] === 0 && tangents[index]?.[1] === 0 ? 'corner' : 'smooth'}
              onChange={(event) => {
                const handles = [...tangents]
                handles[index] = event.target.value === 'corner' ? [0, 0] : null
                update(path, handles)
              }}
            >
              <option value="smooth">Smooth</option>
              <option value="corner">Corner</option>
            </select>
          </label>
          <div className="mt-2 flex gap-2">
            {index < path.length - 1 && (
              <button
                type="button"
                className="rounded border px-2 py-1"
                onClick={() => {
                  const a = getFenceControlHandle(path, node.tangents, index)
                  const b = getFenceControlHandle(path, node.tangents, index + 1)
                  const samples = sampleFenceSpline(
                    [point, path[index + 1]!],
                    [
                      [a.x, a.y],
                      [b.x, b.y],
                    ],
                    2,
                  )
                  const midpoint = samples[1]!
                  const points = [...path]
                  points.splice(index + 1, 0, [midpoint.x, midpoint.y])
                  const handles = [...tangents]
                  handles.splice(index + 1, 0, null)
                  update(points, handles)
                }}
              >
                Add point after
              </button>
            )}
            <button
              type="button"
              className="rounded border px-2 py-1 disabled:opacity-40"
              disabled={path.length <= 2}
              onClick={() =>
                update(
                  path.filter((_, i) => i !== index),
                  tangents.filter((_, i) => i !== index),
                )
              }
            >
              Remove point
            </button>
          </div>
        </details>
      ))}
    </div>
  )
}
