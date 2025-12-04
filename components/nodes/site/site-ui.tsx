'use client'

import { GripVertical, MapPin, Plus, Trash2, X } from 'lucide-react'
import { Reorder, useDragControls } from 'motion/react'
import { useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/shallow'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type StoreState, useEditor } from '@/hooks/use-editor'
import type { SiteNode } from '@/lib/scenegraph/schema/index'
import { cn } from '@/lib/utils'

interface PointItemProps {
  point: [number, number]
  index: number
  onUpdate: (index: number, x: number, y: number) => void
  onDelete: (index: number) => void
  canDelete: boolean
}

function PointItem({ point, index, onUpdate, onDelete, canDelete }: PointItemProps) {
  const controls = useDragControls()

  return (
    <Reorder.Item
      as="div"
      className={cn(
        'flex items-center gap-2 rounded-lg border p-3 transition-all',
        'border-border bg-card hover:border-primary/50',
      )}
      dragControls={controls}
      dragListener={false}
      value={index}
    >
      <div
        className="cursor-grab touch-none p-0.5 text-muted-foreground hover:text-foreground active:cursor-grabbing"
        onPointerDown={(e) => controls.start(e)}
      >
        <GripVertical className="h-4 w-4" />
      </div>

      <span className="w-6 font-medium text-foreground">{index + 1}.</span>

      <div className="flex flex-1 items-center gap-2">
        <div className="space-y-1">
          <label className="font-medium text-muted-foreground text-xs">X (m)</label>
          <input
            className="w-full rounded border border-input bg-background p-2 text-foreground text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            onChange={(e) => {
              const value = Number.parseFloat(e.target.value)
              if (!Number.isNaN(value)) {
                onUpdate(index, value, point[1])
              }
            }}
            step="0.5"
            type="number"
            value={point[0]}
          />
        </div>

        <div className="space-y-1">
          <label className="font-medium text-muted-foreground text-xs">Y (m)</label>
          <input
            className="w-full rounded border border-input bg-background p-2 text-foreground text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            onChange={(e) => {
              const value = Number.parseFloat(e.target.value)
              if (!Number.isNaN(value)) {
                onUpdate(index, point[0], value)
              }
            }}
            step="0.5"
            type="number"
            value={point[1]}
          />
        </div>
      </div>

      <button
        className={cn(
          'rounded p-1 text-muted-foreground transition-colors',
          canDelete
            ? 'hover:bg-destructive/10 hover:text-destructive'
            : 'cursor-not-allowed opacity-30',
        )}
        disabled={!canDelete}
        onClick={() => onDelete(index)}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </Reorder.Item>
  )
}

/**
 * Site property line editor panel
 * Positioned as a fixed panel on the right side of the viewport
 * Only visible when a site node is selected and in edit mode
 */
export function SiteUI() {
  const { nodeId, polygon, nodeName, setControlMode } = useEditor(
    useShallow((state: StoreState) => {
      const base = {
        nodeId: null as string | null,
        polygon: undefined as SiteNode['polygon'] | undefined,
        nodeName: 'Site',
        setControlMode: state.setControlMode,
      }

      // Only show when in edit mode
      if (state.controlMode !== 'edit') return base

      // Find selected site node
      if (state.selectedNodeIds.length !== 1) return base
      const handle = state.graph.getNodeById(state.selectedNodeIds[0] as any)
      const node = handle?.data()
      if (node?.type !== 'site') return base

      return {
        nodeId: node.id,
        polygon: (node as SiteNode)?.polygon,
        nodeName: node?.name || 'Site',
        setControlMode: state.setControlMode,
      }
    }),
  )

  const updateNode = useEditor((state) => state.updateNode)

  // Default points if not present
  const points = useMemo(() => {
    if (polygon?.points && polygon.points.length > 0) {
      return polygon.points
    }
    return [
      [0, 0],
      [30, 0],
      [30, 30],
      [0, 30],
    ] as [number, number][]
  }, [polygon])

  const handleUpdatePoint = useCallback(
    (index: number, x: number, y: number) => {
      if (!nodeId) return
      const newPoints = [...points]
      newPoints[index] = [x, y]
      updateNode(nodeId, {
        polygon: {
          type: 'polygon',
          points: newPoints,
        },
      })
    },
    [points, updateNode, nodeId],
  )

  const handleDeletePoint = useCallback(
    (index: number) => {
      if (!nodeId) return
      if (points.length <= 3) return // Minimum 3 points for a polygon
      const newPoints = points.filter((_, i) => i !== index)
      updateNode(nodeId, {
        polygon: {
          type: 'polygon',
          points: newPoints,
        },
      })
    },
    [points, updateNode, nodeId],
  )

  const handleAddPoint = useCallback(() => {
    if (!nodeId) return
    // Add a new point after the last point, midway between last and first
    const lastPoint = points[points.length - 1]
    const firstPoint = points[0]
    const newPoint: [number, number] = [
      Math.round(((lastPoint[0] + firstPoint[0]) / 2) * 100) / 100, // Round to 2 decimals
      Math.round(((lastPoint[1] + firstPoint[1]) / 2) * 100) / 100,
    ]

    updateNode(nodeId, {
      polygon: {
        type: 'polygon',
        points: [...points, newPoint],
      },
    })
  }, [points, updateNode, nodeId])

  const handleReorder = useCallback(
    (newOrder: number[]) => {
      if (!nodeId) return
      const newPoints = newOrder.map((index) => points[index])
      updateNode(nodeId, {
        polygon: {
          type: 'polygon',
          points: newPoints,
        },
      })
    },
    [points, updateNode, nodeId],
  )

  const handleClose = useCallback(() => {
    setControlMode('select')
  }, [setControlMode])

  // Calculate area (using shoelace formula)
  const area = useMemo(() => {
    if (points.length < 3) return 0
    let sum = 0
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length
      sum += points[i][0] * points[j][1]
      sum -= points[j][0] * points[i][1]
    }
    return Math.abs(sum / 2)
  }, [points])

  // Calculate perimeter
  const perimeter = useMemo(() => {
    if (points.length < 2) return 0
    let sum = 0
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length
      const dx = points[j][0] - points[i][0]
      const dy = points[j][1] - points[i][1]
      sum += Math.sqrt(dx * dx + dy * dy)
    }
    return sum
  }, [points])

  if (!nodeId) return null

  return (
    <div className="pointer-events-auto fixed top-20 right-4 z-50 flex h-[calc(100vh-6rem)] w-80 flex-col overflow-hidden rounded-lg border border-border bg-background/95 shadow-xl backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center justify-between border-b p-4">
        <div className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-orange-400" />
          <h1 className="font-bold text-foreground text-lg">Property Line</h1>
        </div>
        <button
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={handleClose}
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-6">
          {/* Stats */}
          <div className="space-y-2">
            <h2 className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
              Measurements
            </h2>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="text-muted-foreground text-xs">Area</div>
                <div className="font-semibold text-foreground text-lg">{area.toFixed(1)} m²</div>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="text-muted-foreground text-xs">Perimeter</div>
                <div className="font-semibold text-foreground text-lg">
                  {perimeter.toFixed(1)} m
                </div>
              </div>
            </div>
          </div>

          <hr className="border-border" />

          {/* Vertices */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
                Vertices ({points.length})
              </h2>
              <button
                className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground text-xs transition-colors hover:bg-primary/90"
                onClick={handleAddPoint}
              >
                <Plus className="h-3 w-3" />
                Add Point
              </button>
            </div>

            <Reorder.Group
              as="div"
              axis="y"
              className="space-y-2"
              onReorder={handleReorder}
              values={points.map((_, i) => i)}
            >
              {points.map((point, index) => (
                <PointItem
                  canDelete={points.length > 3}
                  index={index}
                  key={index}
                  onDelete={handleDeletePoint}
                  onUpdate={handleUpdatePoint}
                  point={point}
                />
              ))}
            </Reorder.Group>
          </div>

          <hr className="border-border" />

          {/* Help */}
          <p className="text-muted-foreground text-xs">
            Drag the white handles in the 3D view or edit coordinates above to adjust the property
            boundary. Use the grip handles to reorder vertices.
          </p>
        </div>
      </div>
    </div>
  )
}
