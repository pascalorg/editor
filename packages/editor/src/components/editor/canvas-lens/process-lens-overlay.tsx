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
import {
  type AnyRecord,
  type LensNodeMap,
  metadataOf,
  numberValue,
  processIdOf,
  stationIdOf,
  stringValue,
  vector3,
} from './canvas-lens-helpers'

type ProcessLensStation = {
  nodeId: string
  stationId?: string
  processId?: string
  label: string
  detail?: string
  badge?: string
  position: [number, number, number]
  ports: string[]
}

type ProcessLensRoute = {
  id: string
  fromNodeId: string
  toNodeId: string
  fromPortId?: string
  toPortId?: string
  medium?: string
  visualKind?: string
  points: [[number, number, number], [number, number, number]]
  midpoint: [number, number, number]
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

function processLensStations(nodes: LensNodeMap, rootNodeIds: readonly string[]) {
  const tree = buildSceneStructure({ nodes, rootNodeIds, mode: 'process' })
  return tree.groups.flatMap((group) =>
    group.items.slice(0, 32).map((item): ProcessLensStation => {
      const node = nodes[item.nodeId]
      const profile = resolveObjectCapabilities(node, nodes)
      return {
        nodeId: item.nodeId,
        stationId: stationIdOf(node),
        processId: processIdOf(node),
        label: item.label,
        detail: item.detail ?? group.label,
        badge: item.badge,
        position: nodeWorldPosition(node),
        ports: profile?.ports.map((port) => port.id).slice(0, 4) ?? [],
      }
    }),
  )
}

function routeEndpoint(metadata: AnyRecord, primaryKey: string, alternateKeys: string[]) {
  return (
    stringValue(metadata[primaryKey]) ??
    alternateKeys.map((key) => stringValue(metadata[key])).find(Boolean)
  )
}

function processLensRoutes(nodes: LensNodeMap, stations: ProcessLensStation[]) {
  const stationByStationId = new Map<string, ProcessLensStation>()
  for (const station of stations) {
    if (station.stationId && !stationByStationId.has(station.stationId)) {
      stationByStationId.set(station.stationId, station)
    }
  }

  const routes: ProcessLensRoute[] = []
  const seenRoutes = new Set<string>()
  for (const node of Object.values(nodes)) {
    const metadata = metadataOf(node)
    const fromStationId = routeEndpoint(metadata, 'fromStationId', [
      'sourceStationId',
      'upstreamStationId',
    ])
    const toStationId = routeEndpoint(metadata, 'toStationId', [
      'targetStationId',
      'downstreamStationId',
    ])
    if (!fromStationId || !toStationId || fromStationId === toStationId) continue

    const fromStation = stationByStationId.get(fromStationId)
    const toStation = stationByStationId.get(toStationId)
    if (!fromStation || !toStation) continue

    const processId = stringValue(metadata.processId)
    if (
      processId &&
      ((fromStation.processId && fromStation.processId !== processId) ||
        (toStation.processId && toStation.processId !== processId))
    ) {
      continue
    }

    const fromPortId = stringValue(metadata.fromPortId)
    const toPortId = stringValue(metadata.toPortId)
    const routeKey = [
      fromStation.nodeId,
      toStation.nodeId,
      fromPortId ?? '',
      toPortId ?? '',
      stringValue(metadata.visualKind) ?? '',
    ].join(':')
    if (seenRoutes.has(routeKey)) continue
    seenRoutes.add(routeKey)

    const y = Math.max(fromStation.position[1], toStation.position[1]) + 0.25
    const fromPoint: [number, number, number] = [
      fromStation.position[0],
      y,
      fromStation.position[2],
    ]
    const toPoint: [number, number, number] = [toStation.position[0], y, toStation.position[2]]
    routes.push({
      id: routeKey,
      fromNodeId: fromStation.nodeId,
      toNodeId: toStation.nodeId,
      fromPortId,
      toPortId,
      medium: stringValue(metadata.medium),
      visualKind: stringValue(metadata.visualKind),
      points: [fromPoint, toPoint],
      midpoint: [(fromPoint[0] + toPoint[0]) / 2, y + 0.15, (fromPoint[2] + toPoint[2]) / 2],
    })
  }

  return routes.slice(0, 48)
}

function routeColor(route: ProcessLensRoute) {
  if (route.medium === 'power' || route.visualKind === 'cable_tray') return '#facc15'
  if (route.medium === 'gas' || route.medium === 'hydrogen' || route.medium === 'oxygen')
    return '#93c5fd'
  if (route.medium === 'water' || route.medium === 'cooling') return '#38bdf8'
  if (route.visualKind === 'hot_gas_duct' || route.visualKind === 'hot_material_chute')
    return '#fb923c'
  return '#67e8f9'
}

function routeSegment(route: ProcessLensRoute) {
  const [fromPoint, toPoint] = route.points
  const dx = toPoint[0] - fromPoint[0]
  const dz = toPoint[2] - fromPoint[2]
  return {
    length: Math.max(0.1, Math.hypot(dx, dz)),
    position: [(fromPoint[0] + toPoint[0]) / 2, fromPoint[1], (fromPoint[2] + toPoint[2]) / 2] as [
      number,
      number,
      number,
    ],
    rotationY: Math.atan2(-dz, dx),
  }
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
  const routes = useMemo(
    () => (canvasLens === 'process' ? processLensRoutes(nodes, stations) : []),
    [canvasLens, nodes, stations],
  )
  const selectedIdSet = useMemo(() => new Set(selectedIds.map(String)), [selectedIds])

  if (canvasLens !== 'process' || stations.length === 0) return null

  return (
    <group name="process-lens-overlay">
      {routes.map((route) => {
        const color = routeColor(route)
        const segment = routeSegment(route)
        return (
          <group key={route.id}>
            <mesh position={segment.position} rotation={[0, segment.rotationY, 0]}>
              <boxGeometry args={[segment.length, 0.035, 0.035]} />
              <meshBasicMaterial color={color} opacity={0.75} transparent />
            </mesh>
            <Html center distanceFactor={20} position={route.midpoint} zIndexRange={[35, 0]}>
              <div
                className="pointer-events-none rounded-full border border-white/15 bg-zinc-950/75 px-2 py-0.5 text-[9px] text-cyan-50 shadow-lg backdrop-blur"
                data-testid={`process-lens-route-${route.fromNodeId}-${route.toNodeId}`}
              >
                {[route.fromPortId ?? 'out', route.toPortId ?? 'in'].join(' -> ')}
              </div>
            </Html>
          </group>
        )
      })}
      {stations.map((station) => {
        const selected = selectedIdSet.has(station.nodeId)
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
