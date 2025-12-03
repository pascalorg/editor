'use client'

import { ArrowRight, Box, Mic, Paperclip } from 'lucide-react'
import { type ReactNode, useEffect } from 'react'
import { useShallow } from 'zustand/shallow'
import { Button } from '@/components/ui/button'
import { useEditor } from '@/hooks/use-editor'

// Helper to get icon based on node type
function getNodeIcon(type: string): ReactNode {
  const className = 'h-4 w-4 object-contain'
  const size = 16

  switch (type) {
    case 'wall':
      return (
        <img alt="wall" className={className} height={size} src="/icons/wall.png" width={size} />
      )
    case 'roof':
      return (
        <img alt="roof" className={className} height={size} src="/icons/roof.png" width={size} />
      )
    case 'column':
      return (
        <img
          alt="column"
          className={className}
          height={size}
          src="/icons/column.png"
          width={size}
        />
      )
    case 'slab':
      return (
        <img alt="slab" className={className} height={size} src="/icons/floor.png" width={size} />
      )
    case 'ceiling':
      return (
        <img
          alt="ceiling"
          className={className}
          height={size}
          src="/icons/ceiling.png"
          width={size}
        />
      )
    case 'group':
    case 'room':
      return (
        <img alt="room" className={className} height={size} src="/icons/room.png" width={size} />
      )
    case 'custom-room':
      return (
        <img
          alt="custom room"
          className={className}
          height={size}
          src="/icons/custom-room.png"
          width={size}
        />
      )
    case 'door':
      return (
        <img alt="door" className={className} height={size} src="/icons/door.png" width={size} />
      )
    case 'window':
      return (
        <img
          alt="window"
          className={className}
          height={size}
          src="/icons/window.png"
          width={size}
        />
      )
    case 'image':
      return (
        <img
          alt="reference"
          className={className}
          height={size}
          src="/icons/floorplan.png"
          width={size}
        />
      )
    case 'scan':
      return (
        <img alt="scan" className={className} height={size} src="/icons/mesh.png" width={size} />
      )
    case 'level':
      return (
        <img alt="level" className={className} height={size} src="/icons/level.png" width={size} />
      )
    case 'site':
      return (
        <img alt="site" className={className} height={size} src="/icons/site.png" width={size} />
      )
    case 'building':
      return (
        <img
          alt="building"
          className={className}
          height={size}
          src="/icons/building.png"
          width={size}
        />
      )
    case 'stair':
      return (
        <img
          alt="stairs"
          className={className}
          height={size}
          src="/icons/stairs.png"
          width={size}
        />
      )
    case 'item':
      return (
        <img alt="item" className={className} height={size} src="/icons/item.png" width={size} />
      )
    default:
      return <Box className="h-4 w-4 text-muted-foreground" />
  }
}

export function RequestPanel() {
  const { selectedNodeIds, getNode } = useEditor(
    useShallow((state) => ({
      selectedNodeIds: state.selectedNodeIds,
      getNode: state.getNode,
    })),
  )

  // Get the first selected node and its parent
  const selectedNode = selectedNodeIds.length > 0 ? getNode(selectedNodeIds[0]) : null
  const selectedNodeData = selectedNode?.data()
  const parentNode = selectedNode?.parent()
  const parentNodeData = parentNode?.data()

  const levels = useEditor((state) => {
    const building = state.scene.root.children?.[0]?.children.find((c) => c.type === 'building')
    return building ? building.children : []
  })
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const selectFloor = useEditor((state) => state.selectFloor)

  useEffect(() => {
    if (!selectedFloorId && levels.length > 0) {
      selectFloor(levels[0].id)
    }
  }, [selectedFloorId, levels, selectFloor])

  return (
    <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-xl">
        {/* Text input row */}
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <input
            className="flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
            placeholder="Describe or upload what you want..."
            type="text"
          />
          <button
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            type="button"
          >
            <Paperclip className="h-5 w-5" />
          </button>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            type="button"
          >
            <Mic className="h-5 w-5" />
          </button>
        </div>

        {/* Bottom row: Selection info + Order button */}
        <div className="flex">
          {/* Selection info - left half */}
          <div className="flex flex-1 items-center gap-2 px-4 py-3">
            {selectedNodeData ? (
              <>
                {/* Parent node (if exists) */}
                {parentNodeData && (
                  <>
                    <div className="flex items-center gap-1.5 rounded border px-2 py-1">
                      {getNodeIcon(parentNodeData.type)}
                      <span className="text-muted-foreground text-sm">
                        {parentNodeData.name || parentNodeData.type}
                      </span>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </>
                )}
                {/* Selected node */}
                <div className="flex items-center gap-1.5 rounded border px-2 py-1">
                  {getNodeIcon(selectedNodeData.type)}
                  <span className="font-medium text-sm">
                    {selectedNodeData.name || selectedNodeData.type}
                  </span>
                </div>
              </>
            ) : (
              <span className="text-muted-foreground text-sm">No selection</span>
            )}
          </div>

          {/* Order button - right half */}
          <Button
            className="h-auto flex-1 rounded-none rounded-br-2xl bg-blue-500 px-6 py-3 font-medium text-white hover:cursor-pointer hover:bg-blue-600"
            type="button"
          >
            Order work
          </Button>
        </div>
      </div>
    </div>
  )
}
