'use client'

import {
  createSceneApi,
  type RampNode,
  rampFacts,
  rampStations,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { isTypingTarget, PanelSection, PanelWrapper, useInteractionScope } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { moveRampPoint, type PlanPoint, rampSegmentFrames, rampSegmentThrough } from './centreline'
import { commitRampEdit } from './edit'
import { RampNumberField } from './number-field'

type Grip = { kind: 'point' | 'bend'; index: number }

/** The same little plan editor is available from either viewport's inspector. */
function CentrelineEditor({
  node,
  commit,
  report,
}: {
  node: RampNode
  commit: (patch: Partial<RampNode>) => void
  report: (message: string | null) => void
}) {
  const [preview, setPreview] = useState<RampNode>(node)
  const [activeSegment, setActiveSegment] = useState(0)
  const drag = useRef<{ grip: Grip; initial: RampNode; patch: Partial<RampNode> | null } | null>(
    null,
  )
  const svgRef = useRef<SVGSVGElement>(null)
  const frames = rampSegmentFrames(preview)
  const stations = rampStations(preview)
  const original = rampStations(node)
  const xs = original.map((station) => station.point[0])
  const zs = original.map((station) => station.point[1])
  const minX = Math.min(...xs) - node.width
  const minZ = Math.min(...zs) - node.width
  const size = Math.max(Math.max(...xs) - minX + node.width, Math.max(...zs) - minZ + node.width, 5)
  const radius = size / 55
  const clear = useCallback(() => {
    drag.current = null
    useLiveNodeOverrides.getState().clear(node.id)
    useScene.getState().markDirty(node.id)
    useInteractionScope
      .getState()
      .endIf(
        (scope) =>
          scope.kind === 'handle-drag' &&
          scope.nodeId === node.id &&
          scope.handle === 'ramp-centreline',
      )
  }, [node.id])
  useEffect(() => {
    setPreview(node)
    setActiveSegment((index) => Math.min(index, node.segments.length - 1))
  }, [node])
  useEffect(() => clear, [clear])
  useEffect(() => {
    const cancel = () => {
      if (drag.current) {
        clear()
        setPreview(node)
      }
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !drag.current || isTypingTarget(event.target)) return
      event.preventDefault()
      cancel()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', cancel)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', cancel)
    }
  }, [clear, node])
  const start = (event: PointerEvent<SVGCircleElement>, grip: Grip) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    svgRef.current?.setPointerCapture(event.pointerId)
    drag.current = { grip, initial: node, patch: null }
    if (grip.kind === 'bend') setActiveSegment(grip.index)
    useInteractionScope
      .getState()
      .begin({ kind: 'handle-drag', nodeId: node.id, handle: 'ramp-centreline' })
  }
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const current = drag.current
    const matrix = event.currentTarget.getScreenCTM()
    if (!(current && matrix)) return
    const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    const point: PlanPoint = [local.x, local.y]
    try {
      let patch: Partial<RampNode>
      if (current.grip.kind === 'point')
        patch = moveRampPoint(current.initial, current.grip.index, point)
      else {
        const frame = rampSegmentFrames(current.initial)[current.grip.index]
        if (!frame) return
        const segments = [...current.initial.segments]
        segments[current.grip.index] = rampSegmentThrough(frame.start, frame.end, point)
        patch = { segments }
      }
      const next = { ...current.initial, ...patch }
      rampStations(next)
      current.patch = patch
      setPreview(next)
      useLiveNodeOverrides.getState().set(node.id, patch)
      useScene.getState().markDirty(node.id)
      report(null)
    } catch (error) {
      current.patch = null
      report(error instanceof Error ? error.message : String(error))
    }
  }
  const end = (event: PointerEvent<SVGSVGElement>, cancelled = false) => {
    const patch = drag.current?.patch
    clear()
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
    if (!cancelled && patch) commit(patch)
    setPreview(node)
  }
  const frame = frames[activeSegment]
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Drag orange endpoints to route the ramp. Drag a blue midpoint sideways to bend a segment
        into an arc.
      </p>
      <svg
        aria-label="Ramp centreline editor"
        className="w-full rounded border border-border bg-background"
        onLostPointerCapture={() => {
          if (drag.current) {
            clear()
            setPreview(node)
          }
        }}
        onPointerCancel={(event) => end(event, true)}
        onPointerMove={move}
        onPointerUp={(event) => end(event)}
        ref={svgRef}
        style={{ touchAction: 'none' }}
        viewBox={`${minX} ${minZ} ${size} ${size}`}
      >
        <polyline
          fill="none"
          points={stations.map((station) => station.point.join(',')).join(' ')}
          stroke="#a8a29e"
          strokeLinecap="butt"
          strokeLinejoin="round"
          strokeWidth={node.width}
        />
        <polyline
          fill="none"
          points={stations.map((station) => station.point.join(',')).join(' ')}
          stroke="#0369a1"
          strokeWidth={radius / 3}
        />
        {[preview.start, ...frames.map((part) => part.end)].map((point, index) => (
          <circle
            aria-label={`Endpoint ${index + 1}`}
            cx={point[0]}
            cy={point[1]}
            fill="#fb923c"
            key={`point-${index}`}
            onPointerDown={(event) => start(event, { kind: 'point', index })}
            r={radius}
            style={{ cursor: 'grab' }}
          />
        ))}
        {frames.map((part, index) => (
          <circle
            aria-label={`Bend segment ${index + 1}`}
            cx={part.midpoint[0]}
            cy={part.midpoint[1]}
            fill={index === activeSegment ? '#0284c7' : '#7dd3fc'}
            key={`bend-${index}`}
            onPointerDown={(event) => start(event, { kind: 'bend', index })}
            r={radius}
            style={{ cursor: 'grab' }}
          />
        ))}
      </svg>
      <label className="flex items-center justify-between text-xs">
        Segment
        <select
          aria-label="Ramp segment"
          className="rounded border border-border bg-background px-2 py-1"
          onChange={(event) => setActiveSegment(Number(event.target.value))}
          value={activeSegment}
        >
          {frames.map((part, index) => (
            <option key={index} value={index}>
              {index + 1} · {part.segment.type}
            </option>
          ))}
        </select>
      </label>
      {frame && (
        <>
          <RampNumberField
            label="End X"
            onCommit={(x) => commit(moveRampPoint(node, activeSegment + 1, [x, frame.end[1]]))}
            value={frame.end[0]}
          />
          <RampNumberField
            label="End Z"
            onCommit={(z) => commit(moveRampPoint(node, activeSegment + 1, [frame.end[0], z]))}
            value={frame.end[1]}
          />
          {frame.segment.type === 'arc' && (
            <>
              <RampNumberField
                label="Arc sweep"
                onCommit={(degrees) => {
                  const segments = [...node.segments]
                  segments[activeSegment] = {
                    ...(frame.segment as Extract<RampNode['segments'][number], { type: 'arc' }>),
                    sweep: (degrees * Math.PI) / 180,
                  }
                  commit({ segments })
                }}
                unit="°"
                value={(frame.segment.sweep * 180) / Math.PI}
              />
              <button
                className="rounded-full border border-border px-3 py-1 text-xs"
                onClick={() => {
                  const segments = [...node.segments]
                  segments[activeSegment] = { type: 'line', end: frame.end }
                  commit({ segments })
                }}
                type="button"
              >
                Straighten segment
              </button>
            </>
          )}
          <button
            className="ml-2 rounded-full border border-border px-3 py-1 text-xs"
            onClick={() => {
              const segments = [...node.segments]
              const pieces =
                frame.segment.type === 'line'
                  ? [
                      { type: 'line' as const, end: frame.midpoint },
                      { type: 'line' as const, end: frame.end },
                    ]
                  : [
                      { ...frame.segment, sweep: frame.segment.sweep / 2 },
                      { ...frame.segment, sweep: frame.segment.sweep / 2 },
                    ]
              segments.splice(activeSegment, 1, ...pieces)
              commit({ segments })
            }}
            type="button"
          >
            Split segment
          </button>
        </>
      )}
    </div>
  )
}

export default function RampPanel({ node }: { node: RampNode }) {
  return <RampPanelContent key={node.id} node={node} />
}

function RampPanelContent({ node }: { node: RampNode }) {
  const sceneApi = useMemo(() => createSceneApi(useScene), [])
  const [error, setError] = useState<string | null>(null)
  const nodes = useScene((state) => state.nodes)
  const facts = rampFacts(node, nodes)
  const commit = useCallback(
    (patch: Partial<RampNode>) => {
      try {
        commitRampEdit(sceneApi, node.id, patch)
        setError(null)
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error))
      }
    },
    [node.id, sceneApi],
  )
  return (
    <PanelWrapper
      onClose={() => useViewer.getState().setSelection({ selectedIds: [] })}
      title="Ramp"
      width={320}
    >
      {error && (
        <p className="px-3 py-2 text-xs text-red-500" role="alert">
          {error}
        </p>
      )}
      <PanelSection title="Profile">
        <RampNumberField
          label="Width"
          min={0}
          onCommit={(width) => commit({ width })}
          value={node.width}
        />
        <RampNumberField
          label="Start height"
          onCommit={(startHeight) => commit({ startHeight })}
          value={node.startHeight}
        />
        <RampNumberField
          label="End height"
          onCommit={(endHeight) => commit({ endHeight })}
          value={node.endHeight}
        />
        <p className="text-xs text-muted-foreground">
          Heights are absolute in the Site frame. Terrain regrades with each edit when cut and fill
          is on.
        </p>
        <RampNumberField
          label="Start transition"
          min={0}
          onCommit={(startTransition) => commit({ startTransition })}
          value={node.startTransition}
        />
        <RampNumberField
          label="End transition"
          min={0}
          onCommit={(endTransition) => commit({ endTransition })}
          value={node.endTransition}
        />
        <RampNumberField
          label="Thickness"
          min={0}
          onCommit={(thickness) => commit({ thickness })}
          value={node.thickness}
        />
        <RampNumberField
          label="Retaining height"
          min={0}
          onCommit={(retainingHeight) => commit({ retainingHeight })}
          value={node.retainingHeight}
        />
        <RampNumberField
          label="Slope limit"
          min={0}
          onCommit={(maxSlopePercent) => commit({ maxSlopePercent })}
          unit="%"
          value={node.maxSlopePercent}
        />
        <label className="flex items-center justify-between py-1 text-xs">
          Use
          <select
            aria-label="Ramp use"
            className="rounded border border-border bg-background px-2 py-1"
            onChange={(event) => commit({ use: event.target.value as RampNode['use'] })}
            value={node.use}
          >
            <option value="vehicle">Vehicle</option>
            <option value="pedestrian">Pedestrian</option>
          </select>
        </label>
        <label className="flex items-center justify-between py-1 text-xs">
          Terrain
          <select
            aria-label="Ramp terrain mode"
            className="rounded border border-border bg-background px-2 py-1"
            onChange={(event) =>
              commit({ terrainMode: event.target.value as RampNode['terrainMode'] })
            }
            value={node.terrainMode}
          >
            <option value="cut-fill">Cut and fill</option>
            <option value="none">Leave terrain</option>
          </select>
        </label>
      </PanelSection>
      <PanelSection title="Measured profile">
        <p className="text-xs">
          Length {facts.lengthM.toFixed(2)} m · Rise {facts.riseM.toFixed(2)} m
        </p>
        <p className="text-xs">
          Average slope {facts.averageSlopePercent.toFixed(1)}% · Maximum{' '}
          {facts.maximumSlopePercent.toFixed(1)}%
        </p>
        {facts.warnings.map((warning, index) => (
          <p className="py-1 text-xs text-amber-600" key={`${warning.code}-${index}`}>
            {warning.message}
          </p>
        ))}
      </PanelSection>
      <PanelSection title="Centreline">
        <RampNumberField
          label="Start X"
          onCommit={(x) => commit(moveRampPoint(node, 0, [x, node.start[1]]))}
          value={node.start[0]}
        />
        <RampNumberField
          label="Start Z"
          onCommit={(z) => commit(moveRampPoint(node, 0, [node.start[0], z]))}
          value={node.start[1]}
        />
        <CentrelineEditor commit={commit} node={node} report={setError} />
      </PanelSection>
    </PanelWrapper>
  )
}
