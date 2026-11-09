'use client'

import {
  type AnyNodeId,
  clampFencePicketRailProjection,
  type FenceNode,
  findLevelAncestorId,
  formatFixed,
  getClampedWallCurveOffset,
  getFenceCenterlineLength,
  getFenceControlHandle,
  getFenceSpanMode,
  getMaxWallCurveOffset,
  getTwoPointFenceCurveTangents,
  getWallArcData,
  getWallCurveFrameAt,
  getWallCurveLength,
  maxFencePicketRailProjection,
  nodeRegistry,
  normalizeWallCurveOffset,
  sampleFenceSpline,
  usePascalI18n,
  useScene,
} from '@pascal-app/core'
import { SliderControl } from '@pascal-app/editor'

export function FencePatternInfo({ node }: { node: FenceNode }) {
  const i18n = usePascalI18n()
  return (
    <p className="text-xs text-muted-foreground">
      {i18n._({
        id: 'node.fence.inspectorEditors.distributionInfo',
        message:
          '{style, select, picket {Distribution controls pickets in each bay between posts.} horizontal {Distribution controls posts along the full fence.} other {Distribution controls infill pieces between the two end posts.}} Spacing is measured between centers. The available width limits the count so pieces do not overlap.',
        values: {
          style: node.style === 'picket' || node.style === 'horizontal' ? node.style : 'other',
        },
      })}
    </p>
  )
}

export function FencePicketRailProjectionEditor({
  node,
  onUpdate,
}: {
  node: FenceNode
  onUpdate: (patch: Partial<FenceNode>) => void
}) {
  const i18n = usePascalI18n()
  const max = maxFencePicketRailProjection(node.postSize)
  return (
    <SliderControl
      label={i18n._({
        id: 'node.fence.inspectorEditors.picketRailProjection',
        message: 'Picket rail projection',
      })}
      max={max}
      min={0.001}
      onChange={(value) =>
        onUpdate({ picketRailProjection: clampFencePicketRailProjection(value, node.postSize) })
      }
      precision={3}
      step={0.002}
      unit="m"
      value={clampFencePicketRailProjection(node.picketRailProjection, node.postSize)}
    />
  )
}

export function FenceSurfaceEditor({
  node,
  onUpdate,
}: {
  node: FenceNode
  onUpdate: (patch: Partial<FenceNode>) => void
}) {
  const i18n = usePascalI18n()
  const nodes = useScene((state) => state.nodes)
  const levelId = findLevelAncestorId(node.id as AnyNodeId, nodes)
  const hosts = Object.values(nodes).filter(
    (candidate) =>
      candidate.id !== node.id &&
      candidate.visible !== false &&
      (candidate.type === 'slab' ||
        !!nodeRegistry.get(candidate.type)?.capabilities.surfaces?.top) &&
      findLevelAncestorId(candidate.id as AnyNodeId, nodes) === levelId,
  )
  const selectedId = node.supportSurfaceNodeId ?? node.supportSlabId ?? ''

  return (
    <div className="space-y-2 text-xs">
      <label className="flex items-center justify-between gap-2">
        {i18n._({ id: 'node.fence.inspectorEditors.surfaceBehavior', message: 'Surface behavior' })}
        <select
          className="rounded border bg-background p-1"
          value={node.surfaceMode}
          onChange={(event) => {
            const mode = event.target.value as FenceNode['surfaceMode']
            if (mode === 'selected' && !selectedId && hosts[0]) {
              const host = hosts[0]
              onUpdate({
                surfaceMode: mode,
                supportSlabId: host.type === 'slab' ? host.id : undefined,
                supportSurfaceNodeId: host.type === 'slab' ? undefined : host.id,
              })
            } else {
              onUpdate({ surfaceMode: mode })
            }
          }}
        >
          <option value="auto">
            {i18n._({
              id: 'node.fence.inspectorEditors.followHighestSurface',
              message: 'Follow highest surface',
            })}
          </option>
          <option disabled={hosts.length === 0} value="selected">
            {i18n._({
              id: 'node.fence.inspectorEditors.followSelectedSurface',
              message: 'Follow selected surface',
            })}
          </option>
          <option value="level">
            {i18n._({
              id: 'node.fence.inspectorEditors.holdStartingHeight',
              message: 'Hold starting height',
            })}
          </option>
        </select>
      </label>
      {node.surfaceMode === 'selected' && (
        <label className="flex items-center justify-between gap-2">
          {i18n._({ id: 'node.fence.inspectorEditors.surface', message: 'Surface' })}
          <select
            className="min-w-0 max-w-40 rounded border bg-background p-1"
            value={selectedId}
            onChange={(event) => {
              const host = nodes[event.target.value as AnyNodeId]
              onUpdate({
                supportSlabId: host?.type === 'slab' ? host.id : undefined,
                supportSurfaceNodeId: host && host.type !== 'slab' ? host.id : undefined,
              })
            }}
          >
            <option value="">
              {i18n._({
                id: 'node.fence.inspectorEditors.chooseASurface',
                message: 'Choose a surface',
              })}
            </option>
            {hosts.map((host) => (
              <option key={host.id} value={host.id}>
                {host.name || host.type} ({host.type})
              </option>
            ))}
          </select>
        </label>
      )}
      {node.surfaceMode === 'selected' && !selectedId && (
        <p className="text-muted-foreground">
          {i18n._({
            id: 'node.fence.inspectorEditors.chooseASlabOrShapedSurface',
            message: 'Choose a slab or shaped surface on this level.',
          })}
        </p>
      )}
    </div>
  )
}

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
  const i18n = usePascalI18n()
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
      label={i18n._({ id: 'node.fence.inspectorEditors.length', message: 'Length' })}
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
  const i18n = usePascalI18n()
  const curveOffset = getClampedWallCurveOffset(node)
  const maxCurveOffset = getMaxWallCurveOffset(node)

  return (
    <div className="space-y-2">
      <SliderControl
        label={i18n._({ id: 'node.fence.inspectorEditors.curve', message: 'Curve' })}
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
            spanModes: Array.from({ length: spans }, () =>
              arc ? ('curve' as const) : ('straight' as const),
            ),
            tangents: frames.map((frame) => [
              frame.tangent.x * handleLength,
              frame.tangent.y * handleLength,
            ]),
            curveOffset: undefined,
          })
        }}
      >
        {i18n._({ id: 'node.fence.inspectorEditors.editPath', message: 'Edit path' })}
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
  const i18n = usePascalI18n()
  const path = node.path ?? []
  const tangents = path.map((_, i) => node.tangents?.[i] ?? null)
  const spanModes = path
    .slice(1)
    .map((_, i) => getFenceSpanMode(path, node.tangents, node.spanModes, i))
  const update = (points: [number, number][], handles = tangents, modes = spanModes) => {
    if (points.length < 2) return
    onUpdate({
      path: points,
      tangents: handles,
      spanModes: modes,
      start: points[0]!,
      end: points.at(-1)!,
    })
  }
  return (
    <div className="space-y-2 text-xs">
      <p>
        {i18n._({
          id: 'node.fence.inspectorEditors.pathSummary',
          message: '{count, plural, one {{number} point} other {{number} points}} · {length} m',
          values: {
            count: path.length,
            number: String(path.length),
            length: formatFixed(getFenceCenterlineLength(node), 2, i18n.getLocale()),
          },
        })}
      </p>
      <p className="text-muted-foreground">
        {i18n._({
          id: 'node.fence.inspectorEditors.setEachSpanToStraightOr',
          message:
            'Set each span to straight or curved, then drag its points and curve handles in either view.',
        })}
      </p>
      {path.map((point, index) => (
        <details key={`curve-editor-${index}`} className="rounded border p-2">
          <summary className="cursor-pointer">
            {i18n._({ id: 'node.fence.inspectorEditors.point', message: 'Point' })} {index + 1}
          </summary>
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
          {index < path.length - 1 && (
            <label className="mt-2 flex items-center justify-between">
              {i18n._({
                id: 'node.fence.inspectorEditors.spanToPointNumber',
                message: 'Span to point {number}',
                values: { number: index + 2 },
              })}
              <select
                className="rounded border bg-background p-1"
                value={spanModes[index]}
                onChange={(event) => {
                  const modes = [...spanModes]
                  modes[index] = event.target.value as 'straight' | 'curve'
                  const handles =
                    path.length === 2 && modes[index] === 'curve' && spanModes[index] === 'straight'
                      ? (getTwoPointFenceCurveTangents(path) ?? tangents)
                      : tangents
                  update(path, handles, modes)
                }}
              >
                <option value="straight">
                  {i18n._({ id: 'node.fence.inspectorEditors.straight', message: 'Straight' })}
                </option>
                <option value="curve">
                  {i18n._({ id: 'node.fence.inspectorEditors.curved', message: 'Curved' })}
                </option>
              </select>
            </label>
          )}
          {(spanModes[index - 1] === 'curve' || spanModes[index] === 'curve') && (
            <label className="mt-2 flex items-center justify-between">
              {i18n._({ id: 'node.fence.inspectorEditors.join', message: 'Join' })}
              <select
                className="rounded border bg-background p-1"
                value={
                  tangents[index]?.[0] === 0 && tangents[index]?.[1] === 0 ? 'corner' : 'smooth'
                }
                onChange={(event) => {
                  const handles = [...tangents]
                  handles[index] = event.target.value === 'corner' ? [0, 0] : null
                  update(path, handles)
                }}
              >
                <option value="smooth">
                  {i18n._({ id: 'node.fence.inspectorEditors.smooth', message: 'Smooth' })}
                </option>
                <option value="corner">
                  {i18n._({ id: 'node.fence.inspectorEditors.corner', message: 'Corner' })}
                </option>
              </select>
            </label>
          )}
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
                    [spanModes[index]!],
                  )
                  const midpoint = samples[1]!
                  const points = [...path]
                  points.splice(index + 1, 0, [midpoint.x, midpoint.y])
                  const handles = [...tangents]
                  handles.splice(index + 1, 0, null)
                  const modes = [...spanModes]
                  modes.splice(index, 1, spanModes[index]!, spanModes[index]!)
                  update(points, handles, modes)
                }}
              >
                {i18n._({
                  id: 'node.fence.inspectorEditors.addPointAfter',
                  message: 'Add point after',
                })}
              </button>
            )}
            {index === path.length - 1 && (
              <button
                type="button"
                className="rounded border px-2 py-1"
                onClick={() => {
                  const previous = path[index - 1]!
                  update(
                    [
                      ...path,
                      [point[0] + point[0] - previous[0], point[1] + point[1] - previous[1]],
                    ],
                    [...tangents, null],
                    [...spanModes, 'straight'],
                  )
                }}
              >
                {i18n._({ id: 'node.fence.inspectorEditors.extendPath', message: 'Extend path' })}
              </button>
            )}
            <button
              type="button"
              className="rounded border px-2 py-1 disabled:opacity-40"
              disabled={path.length <= 2}
              onClick={() => {
                const modes = [...spanModes]
                if (index === 0) modes.shift()
                else if (index === path.length - 1) modes.pop()
                else
                  modes.splice(
                    index - 1,
                    2,
                    spanModes[index - 1] === 'straight' && spanModes[index] === 'straight'
                      ? 'straight'
                      : 'curve',
                  )
                update(
                  path.filter((_, i) => i !== index),
                  tangents.filter((_, i) => i !== index),
                  modes,
                )
              }}
            >
              {i18n._({ id: 'node.fence.inspectorEditors.removePoint', message: 'Remove point' })}
            </button>
          </div>
        </details>
      ))}
    </div>
  )
}
