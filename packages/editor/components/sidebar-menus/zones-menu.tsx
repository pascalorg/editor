'use client'

import { Hexagon, Plus, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import {
  TreeExpander,
  TreeIcon,
  TreeLabel,
  TreeNode,
  TreeNodeContent,
  TreeNodeTrigger,
} from '@/components/tree'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { type StoreState, useEditor } from '@/hooks/use-editor'
import type { Zone } from '@pascal/core/scenegraph/schema/zones'
import { cn } from '@/lib/utils'
import { RenamePopover } from './shared'

// Preset colors for zones
const PRESET_COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#eab308', // yellow
  '#f97316', // orange
  '#ef4444', // red
  '#a855f7', // purple
  '#ec4899', // pink
  '#06b6d4', // cyan
]

// Zone item component
interface ZoneItemProps {
  zone: Zone
  isLast: boolean
  level: number
  onNodeClick: (nodeId: string, hasChildren: boolean) => void
}

export function ZoneItem({ zone, isLast, level, onNodeClick }: ZoneItemProps) {
  const renameZone = useEditor((state) => state.renameZone)
  const deleteZone = useEditor((state) => state.deleteZone)
  const setZoneColor = useEditor((state) => state.setZoneColor)
  const selectZone = useEditor((state) => state.selectZone)
  const selectedZoneId = useEditor((state) => state.selectedZoneId)

  const [isRenaming, setIsRenaming] = useState(false)
  const labelRef = useRef<HTMLSpanElement>(null)

  const isSelected = selectedZoneId === zone.id

  const handleRename = (newName: string) => {
    renameZone(zone.id, newName)
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    deleteZone(zone.id)
  }

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    // Select this zone for boundary editing
    selectZone(isSelected ? null : zone.id)
  }

  // Get level name for display
  const levels = useEditor(
    useShallow((state: StoreState) => {
      const building = state.scene.root.children?.[0]?.children.find((c) => c.type === 'building')
      return building?.children || []
    }),
  )
  const levelName = levels.find((l) => l.id === zone.levelId)?.name || 'Unknown Level'

  return (
    <TreeNode isLast={isLast} level={level} nodeId={zone.id}>
      <TreeNodeTrigger
        className={cn('group', isSelected && 'bg-accent ring-1 ring-primary')}
        onClick={(e) => handleClick(e)}
      >
        <TreeExpander hasChildren={false} />

        {/* Color indicator with color picker */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              className="mr-1 size-4 shrink-0 rounded-sm border border-border/50 transition-transform hover:scale-110"
              onClick={(e) => e.stopPropagation()}
              style={{ backgroundColor: zone.color }}
            />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-2" onClick={(e) => e.stopPropagation()}>
            <div className="grid grid-cols-4 gap-1">
              {PRESET_COLORS.map((color) => (
                <button
                  className={cn(
                    'size-6 rounded-sm border transition-transform hover:scale-110',
                    color === zone.color ? 'ring-2 ring-primary ring-offset-1' : '',
                  )}
                  key={color}
                  onClick={() => setZoneColor(zone.id, color)}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <TreeIcon
          hasChildren={false}
          icon={
            <img
              alt="Zone"
              className="size-4"
              height={22}
              src="/icons/zone.png"
              width={22}
            />
          }
        />

        <TreeLabel
          className="flex-1 cursor-text"
          onDoubleClick={(e) => {
            e.stopPropagation()
            setIsRenaming(true)
          }}
          ref={labelRef}
        >
          {zone.name}
          <span className="ml-1 text-muted-foreground text-xs">({levelName})</span>
        </TreeLabel>
        <RenamePopover
          anchorRef={labelRef}
          currentName={zone.name}
          isOpen={isRenaming}
          onOpenChange={setIsRenaming}
          onRename={handleRename}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className="size-4 p-0 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              onClick={handleDelete}
              size="sm"
              variant="ghost"
            >
              <Trash2 className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Delete zone</TooltipContent>
        </Tooltip>
      </TreeNodeTrigger>
    </TreeNode>
  )
}

// Zones section component
interface ZonesSectionProps {
  level: number
  onNodeClick: (nodeId: string, hasChildren: boolean) => void
  isLast?: boolean
}

export function ZonesSection({ level, onNodeClick, isLast }: ZonesSectionProps) {
  const zones = useEditor(useShallow((state: StoreState) => state.scene.zones || []))
  const setActiveTool = useEditor((state) => state.setActiveTool)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)

  const handleAddZone = (e: React.MouseEvent) => {
    e.stopPropagation()
    // Activate the zone tool - it will create a zone when the user finishes drawing
    if (selectedFloorId) {
      setActiveTool('zone')
    }
  }

  const hasZones = zones.length > 0

  return (
    <TreeNode isLast={isLast} level={level} nodeId="zones-section">
      <TreeNodeTrigger
        className="group sticky top-0 z-10 bg-background"
        onClick={() => onNodeClick('zones-section', hasZones)}
      >
        <TreeExpander hasChildren={hasZones} />
        <TreeIcon
          className="size-7"
          hasChildren={hasZones}
          icon={
            <img
              alt="Zones"
              className="object-contain"
              height={24}
              src="/icons/zone.png"
              width={24}
            />
          }
        />
        <TreeLabel>Zones</TreeLabel>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className="h-5 w-5 p-0"
              disabled={!selectedFloorId}
              onClick={handleAddZone}
              size="sm"
              variant="ghost"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {selectedFloorId ? 'Add new zone' : 'Select a level first'}
          </TooltipContent>
        </Tooltip>
      </TreeNodeTrigger>

      <TreeNodeContent hasChildren={hasZones}>
        {zones.map((zone, index) => (
          <ZoneItem
            isLast={index === zones.length - 1}
            key={zone.id}
            level={level + 1}
            onNodeClick={onNodeClick}
            zone={zone}
          />
        ))}
      </TreeNodeContent>
    </TreeNode>
  )
}
