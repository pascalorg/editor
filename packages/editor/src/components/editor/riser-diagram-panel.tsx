'use client'

import { type AnyNodeId, buildRiserDiagram, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { X } from 'lucide-react'
import { useMemo } from 'react'
import useEditor from '../../store/use-editor'

const WASTE_COLOR = '#0ea5e9'
const VENT_COLOR = '#a855f7'
const MARKER_COLOR = '#1e293b'
const PADDING = 32
/** Meters → SVG units. The iso projection is in meters; scale up so a
 *  typical house drain (a few meters) fills the panel. */
const SCALE = 90

/**
 * DWV riser diagram — the plumbing isometric drawn from the scene's
 * drain/waste/vent nodes. Read-only; toggled from the view controls.
 * Vertical stacks read vertical, sloped drains lean at 30°, with size +
 * vent-termination annotations, matching the permit-drawing convention.
 * Clicking a line/marker selects its node in 3D.
 */
export function RiserDiagramPanel() {
  const isOpen = useEditor((s) => s.isRiserOpen)
  // Only the open flag lives here. The whole-scene subscription that drives
  // the diagram lives in the child, mounted only while the panel is open —
  // so a closed panel doesn't re-render on every scene mutation.
  if (!isOpen) return null
  return <RiserDiagramContent />
}

function RiserDiagramContent() {
  const setRiserOpen = useEditor((s) => s.setRiserOpen)
  const nodes = useScene((s) => s.nodes)
  const selectedIds = useViewer((s) => s.selection.selectedIds)

  const diagram = useMemo(() => buildRiserDiagram(nodes), [nodes])

  const select = (nodeId: AnyNodeId) => useViewer.getState().setSelection({ selectedIds: [nodeId] })

  const width = diagram ? (diagram.bounds.maxX - diagram.bounds.minX) * SCALE + PADDING * 2 : 320
  const height = diagram ? (diagram.bounds.maxY - diagram.bounds.minY) * SCALE + PADDING * 2 : 200
  const tx = diagram ? -diagram.bounds.minX * SCALE + PADDING : 0
  const ty = diagram ? -diagram.bounds.minY * SCALE + PADDING : 0

  return (
    <div className="dark pointer-events-auto absolute top-4 right-4 z-30 flex max-h-[80vh] w-[26rem] flex-col overflow-hidden rounded-2xl border border-border/40 bg-background/95 text-foreground shadow-lg backdrop-blur-xl">
      <div className="flex items-center justify-between border-border/40 border-b px-4 py-2.5">
        <div className="flex flex-col">
          <span className="font-medium text-sm">Riser Diagram</span>
          <span className="text-muted-foreground text-xs">DWV plumbing isometric</span>
        </div>
        <button
          className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-white/10"
          onClick={() => setRiserOpen(false)}
        >
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      <div className="flex items-center gap-3 border-border/40 border-b px-4 py-2 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4" style={{ background: WASTE_COLOR }} /> Waste
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0 w-4 border-t-2 border-dashed" style={{ borderColor: VENT_COLOR }} />{' '}
          Vent
        </span>
      </div>

      <div className="overflow-auto p-2">
        {diagram ? (
          <svg
            height={Math.max(height, 120)}
            role="img"
            aria-label="DWV riser diagram"
            viewBox={`0 0 ${Math.max(width, 200)} ${Math.max(height, 120)}`}
            width="100%"
          >
            <g transform={`translate(${tx}, ${ty})`}>
              {diagram.lines.map((line, i) => {
                const isSel = selectedIds.includes(line.nodeId)
                const color = line.system === 'waste' ? WASTE_COLOR : VENT_COLOR
                return (
                  <g key={`${line.nodeId}-${i}`}>
                    <line
                      className="cursor-pointer"
                      onClick={() => select(line.nodeId)}
                      stroke={color}
                      strokeDasharray={line.system === 'vent' ? '5 4' : undefined}
                      strokeLinecap="round"
                      strokeWidth={(line.vertical ? 3.5 : 2.5) + (isSel ? 2 : 0)}
                      x1={line.from[0] * SCALE}
                      x2={line.to[0] * SCALE}
                      y1={line.from[1] * SCALE}
                      y2={line.to[1] * SCALE}
                    />
                    <text
                      fill={color}
                      fontSize={9}
                      x={((line.from[0] + line.to[0]) / 2) * SCALE + 4}
                      y={((line.from[1] + line.to[1]) / 2) * SCALE - 3}
                    >
                      {line.diameter}"
                    </text>
                  </g>
                )
              })}
              {diagram.markers.map((marker, i) => (
                <g
                  className="cursor-pointer"
                  key={`${marker.nodeId}-${i}`}
                  onClick={() => select(marker.nodeId)}
                  transform={`translate(${marker.point[0] * SCALE}, ${marker.point[1] * SCALE})`}
                >
                  {marker.kind === 'vent-termination' ? (
                    <path d="M -5 0 L 0 -7 L 5 0" fill="none" stroke={VENT_COLOR} strokeWidth={2} />
                  ) : (
                    <circle fill={MARKER_COLOR} r={3} stroke={MARKER_COLOR} strokeWidth={1.5} />
                  )}
                  <text fill={MARKER_COLOR} fontSize={9} x={8} y={3}>
                    {marker.label}
                  </text>
                </g>
              ))}
            </g>
          </svg>
        ) : (
          <div className="flex h-32 items-center justify-center px-6 text-center text-muted-foreground text-sm">
            No drain, waste, or vent pipes yet. Draw plumbing to see the riser diagram.
          </div>
        )}
      </div>
    </div>
  )
}
