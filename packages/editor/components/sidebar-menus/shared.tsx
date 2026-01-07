'use client'

import { Box, Check, Eye, EyeOff, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { useEditor } from '@/hooks/use-editor'
import { cn } from '@/lib/utils'

// Fine-grained selection hook - only re-renders when THIS node's selection state changes
// Uses useSyncExternalStore to subscribe to zustand store efficiently
export function useIsNodeSelected(nodeId: string): boolean {
  return useSyncExternalStore(
    useEditor.subscribe,
    () => useEditor.getState().selectedNodeIds.includes(nodeId),
    () => useEditor.getState().selectedNodeIds.includes(nodeId),
  )
}

// Fine-grained floor selection hook - only re-renders when THIS floor's selection state changes
export function useIsFloorSelected(floorId: string): boolean {
  return useSyncExternalStore(
    useEditor.subscribe,
    () => useEditor.getState().selectedFloorId === floorId,
    () => useEditor.getState().selectedFloorId === floorId,
  )
}

// Context for layers menu interaction
export interface LayersMenuContextType {
  handleNodeClick: (nodeId: string, hasChildren: boolean) => void
}

export const LayersMenuContext = createContext<LayersMenuContextType | null>(null)

export function useLayersMenu() {
  const context = useContext(LayersMenuContext)
  if (!context) {
    throw new Error('useLayersMenu must be used within a LayersMenu')
  }
  return context
}

// Helper to get icon based on node type
export function getNodeIcon(type: string): ReactNode {
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
    case 'reference-image':
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
    case 'environment':
      return (
        <img
          alt="environment"
          className={className}
          height={size}
          src="/icons/environment.png"
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
      return <Box className="h-4 w-4 text-gray-400" />
  }
}

// Helper to get node label
export function getNodeLabel(type: string, index: number, name?: string): string {
  // If a custom name is provided, use it for most node types
  if (name) {
    return name
  }

  switch (type) {
    case 'wall':
      return `Wall ${index + 1}`
    case 'roof':
      return `Roof ${index + 1}`
    case 'column':
      return `Column ${index + 1}`
    case 'slab':
      return `Floor ${index + 1}`
    case 'ceiling':
      return `Ceiling ${index + 1}`
    case 'group':
      return `Room ${index + 1}`
    case 'door':
      return `Door ${index + 1}`
    case 'window':
      return `Window ${index + 1}`
    case 'reference-image':
      return `Reference ${index + 1}`
    case 'scan':
      return `Scan ${index + 1}`
    case 'level':
      return `Level ${index + 1}`
    case 'site':
      return 'Site'
    case 'building':
      return 'Building'
    case 'item':
      return `Item ${index + 1}`
    case 'environment':
      return 'Environment'
    default:
      return `Node ${index + 1}`
  }
}

export function VisibilityToggle({
  visible,
  onToggle,
}: {
  visible: boolean
  onToggle: () => void
}) {
  return (
    <Button
      className={cn(
        'h-5 w-5 p-0 transition-opacity',
        visible ? 'opacity-0 group-hover/item:opacity-100' : 'opacity-100',
      )}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      size="sm"
      variant="ghost"
    >
      {visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
    </Button>
  )
}

export interface RenamePopoverProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  currentName: string
  onRename: (newName: string) => void
  anchorRef: React.RefObject<HTMLSpanElement | null>
}

export function RenamePopover({
  isOpen,
  onOpenChange,
  currentName,
  onRename,
  anchorRef,
}: RenamePopoverProps) {
  const [name, setName] = useState(currentName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setName(currentName)
      // Focus the input after popover opens
      setTimeout(() => inputRef.current?.select(), 0)
    }
  }, [isOpen, currentName])

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()
    e?.stopPropagation()
    if (name.trim()) {
      onRename(name.trim())
      onOpenChange(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      onOpenChange(false)
    } else if (e.key === 'Enter') {
      handleSubmit()
    }
  }

  // Don't render anything when closed to avoid thousands of Popover instances
  if (!isOpen) return null

  return (
    <Popover onOpenChange={onOpenChange} open={isOpen}>
      <PopoverAnchor
        virtualRef={anchorRef as React.RefObject<{ getBoundingClientRect: () => DOMRect }>}
      />
      <PopoverContent
        align="start"
        className="dark w-52 p-2"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        sideOffset={4}
      >
        <form className="flex items-center gap-1" onSubmit={handleSubmit}>
          <Input
            autoFocus
            className="h-7 flex-1 text-sm"
            onChange={(e) => setName(e.target.value)}
            ref={inputRef}
            value={name}
          />
          <Button
            className="h-7 w-7 p-0"
            onClick={(e) => {
              e.stopPropagation()
              handleSubmit()
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Check className="h-3 w-3" />
          </Button>
          <Button
            className="h-7 w-7 p-0"
            onClick={(e) => {
              e.stopPropagation()
              onOpenChange(false)
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            <X className="h-3 w-3" />
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}

export interface ModelPositionPopoverProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  position: [number, number, number]
  onPositionChange: (position: [number, number, number]) => void
  anchorRef: React.RefObject<HTMLElement | null>
}

export function ModelPositionPopover({
  isOpen,
  onOpenChange,
  position,
  onPositionChange,
  anchorRef,
}: ModelPositionPopoverProps) {
  const handleChange = (axis: 'x' | 'y' | 'z', value: string) => {
    const numValue = Number.parseFloat(value) || 0
    const newPosition: [number, number, number] = [...position]
    if (axis === 'x') newPosition[0] = numValue
    else if (axis === 'y') newPosition[1] = numValue
    else newPosition[2] = numValue
    onPositionChange(newPosition)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      onOpenChange(false)
    }
  }

  // Don't render anything when closed to avoid unnecessary Popover instances
  if (!isOpen) return null

  return (
    <Popover onOpenChange={onOpenChange} open={isOpen}>
      <PopoverAnchor
        virtualRef={anchorRef as React.RefObject<{ getBoundingClientRect: () => DOMRect }>}
      />
      <PopoverContent
        align="start"
        className="dark w-48 p-3"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        sideOffset={4}
      >
        <div className="flex flex-col gap-3">
          <div className="font-medium text-sm">Model Position</div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="w-6 text-muted-foreground text-xs">X</span>
              <Input
                autoFocus
                className="h-7 flex-1 text-sm"
                onChange={(e) => handleChange('x', e.target.value)}
                step="0.1"
                type="number"
                value={position[0]}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-6 text-muted-foreground text-xs">Y</span>
              <Input
                className="h-7 flex-1 text-sm"
                onChange={(e) => handleChange('y', e.target.value)}
                step="0.1"
                type="number"
                value={position[1]}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-6 text-muted-foreground text-xs">Z</span>
              <Input
                className="h-7 flex-1 text-sm"
                onChange={(e) => handleChange('z', e.target.value)}
                step="0.1"
                type="number"
                value={position[2]}
              />
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
