'use client'

import type { Zone } from '@pascal/core/scenegraph/schema/zones'
import { Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import { RenamePopover } from '@/components/sidebar-menus'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { type StoreState, useEditor } from '@/hooks/use-editor'
import { cn } from '@/lib/utils'

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

interface ZoneItemProps {
  zone: Zone
}

function ZoneItem({ zone }: ZoneItemProps) {
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

  const handleClick = () => {
    selectZone(isSelected ? null : zone.id)
  }

  const levels = useEditor(
    useShallow((state: StoreState) => {
      const building = state.scene.root.children?.[0]?.children.find((c) => c.type === 'building')
      return building?.children || []
    }),
  )
  const levelName = levels.find((l) => l.id === zone.levelId)?.name || 'Unknown Level'

  return (
    <div
      className={cn(
        'group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent',
        isSelected && 'bg-accent ring-1 ring-primary',
      )}
      onClick={handleClick}
    >
      {/* Color indicator with color picker */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            className="size-3 shrink-0 rounded-full border border-border/50 transition-transform hover:scale-110"
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

      <span
        className="flex-1 cursor-text truncate"
        onDoubleClick={(e) => {
          e.stopPropagation()
          setIsRenaming(true)
        }}
        ref={labelRef}
      >
        {zone.name}
      </span>
      <span className="text-muted-foreground text-xs">({levelName})</span>

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
            className="size-5 p-0 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            onClick={handleDelete}
            size="sm"
            variant="ghost"
          >
            <Trash2 className="size-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Delete zone</TooltipContent>
      </Tooltip>
    </div>
  )
}

export function ZonesPanel() {
  const zones = useEditor(useShallow((state: StoreState) => state.scene.zones || []))

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {zones.length === 0 ? (
          <div className="py-4 text-center text-muted-foreground text-sm">
            No zones yet. Select a level and click + to add one.
          </div>
        ) : (
          zones.map((zone) => <ZoneItem key={zone.id} zone={zone} />)
        )}
      </div>
    </div>
  )
}
