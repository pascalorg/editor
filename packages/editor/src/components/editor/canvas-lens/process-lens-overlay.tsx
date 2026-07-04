'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import useViewer from '@pascal-app/viewer/store'
import { Html } from '@react-three/drei'
import { Network } from 'lucide-react'
import { memo, useMemo } from 'react'
import { resolveObjectCapabilities } from '../../../lib/object-capabilities'
import { buildSceneStructure } from '../../../lib/scene-structure'
import { cn } from '../../../lib/utils'
import useEditor from '../../../store/use-editor'

type ProcessLensStation = {
  nodeId: string
  label: string
  detail?: string
  badge?: string
  position: [number, number, number]
  ports: string[]
}

type AnyRecord = Record<string, unknown>

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function vector3(value: unknown): [number, number, number] | undefined {
  if (
    Array.isArray(value) &&
    value.length >= 3 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    typeof value[2] === 'number'
  ) {
    return [value[0], value[1], value[2]]
  }
  return undefined
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function estimateNodeLabelHeight(node: AnyNode | undefined) {
  if (!node) return 1.5
  const record = node as unknown as AnyRecord
  const type = String(node.type)
  if (type === 'assembly') return 2.8
  if (type === 'tank') return (numberValue(record.height) ?? 2) + 0.8
  if (type === 'pipe') return (numberValue(record.elevation) ?? 1) + 0.6
  return (numberValue(record.height) ?? 1.2) + 0.7
}

function nodeWorldPosition(node: AnyNode | undefined): [number, number, number] {
  if (!node) return [0, 1.5, 0]
  const record = node as unknown as AnyRecord
  const position = vector3(record.position)
  if (position) return [position[0], position[1] + estimateNodeLabelHeight(node), position[2]]

  const start = Array.isArray(record.start) ? record.start : undefined
  const end = Array.isArray(record.end) ? record.end : undefined
  if (
    start &&
    end &&
    typeof start[0] === 'number' &&
    typeof start[1] === 'number' &&
    typeof end[0] === 'number' &&
    typeof end[1] === 'number'
  ) {
    return [(start[0] + end[0]) / 2, estimateNodeLabelHeight(node), (start[1] + end[1]) / 2]
  }

  return [0, estimateNodeLabelHeight(node), 0]
}

function processLensStations(
  nodes: Record<string, AnyNode | undefined>,
  rootNodeIds: readonly string[],
) {
  const tree = buildSceneStructure({ nodes, rootNodeIds, mode: 'process' })
  return tree.groups.flatMap((group) =>
    group.items.slice(0, 32).map((item): ProcessLensStation => {
      const node = nodes[item.nodeId]
      const profile = resolveObjectCapabilities(node, nodes)
      return {
        nodeId: item.nodeId,
        label: item.label,
        detail: item.detail ?? group.label,
        badge: item.badge,
        position: nodeWorldPosition(node),
        ports: profile?.ports.map((port) => port.id).slice(0, 4) ?? [],
      }
    }),
  )
}

export const ProcessLensOverlay = memo(function ProcessLensOverlay() {
  const canvasLens = useEditor((state) => state.canvasLens)
  const nodes = useScene((state) => state.nodes)
  const rootNodeIds = useScene((state) => state.rootNodeIds)
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const setSelection = useViewer((state) => state.setSelection)
  const stations = useMemo(
    () => (canvasLens === 'process' ? processLensStations(nodes, rootNodeIds) : []),
    [canvasLens, nodes, rootNodeIds],
  )

  if (canvasLens !== 'process' || stations.length === 0) return null

  return (
    <group name="process-lens-overlay">
      {stations.map((station) => {
        const selected = selectedIds.map(String).includes(station.nodeId)
        return (
          <Html
            center
            distanceFactor={18}
            key={station.nodeId}
            position={station.position}
            zIndexRange={[40, 0]}
          >
            <button
              className={cn(
                'pointer-events-auto min-w-36 max-w-56 rounded-lg border px-2.5 py-2 text-left text-white shadow-xl backdrop-blur-md transition-colors',
                selected
                  ? 'border-cyan-300/80 bg-cyan-500/25'
                  : 'border-white/15 bg-zinc-950/80 hover:border-cyan-300/60 hover:bg-zinc-900/90',
              )}
              data-process-lens-node-id={station.nodeId}
              data-testid={`process-lens-station-${station.nodeId}`}
              onClick={() => setSelection({ selectedIds: [station.nodeId as AnyNodeId] })}
              type="button"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <Network className="h-3.5 w-3.5 shrink-0 text-cyan-200" />
                <span className="truncate font-medium text-[12px]">{station.label}</span>
              </span>
              <span className="mt-0.5 block truncate text-[10px] text-cyan-100/70">
                {station.badge ?? station.detail ?? 'process station'}
              </span>
              {station.ports.length > 0 && (
                <span className="mt-1.5 flex flex-wrap gap-1">
                  {station.ports.map((port) => (
                    <span
                      className="rounded border border-cyan-200/20 bg-cyan-200/10 px-1.5 py-0.5 text-[9px] text-cyan-50"
                      data-testid={`process-lens-port-${station.nodeId}-${port}`}
                      key={port}
                    >
                      {port}
                    </span>
                  ))}
                </span>
              )}
            </button>
          </Html>
        )
      })}
    </group>
  )
})
