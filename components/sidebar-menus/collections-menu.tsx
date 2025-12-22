'use client'

import { Check, Folder, Grid2x2, Hexagon, Plus, Trash2 } from 'lucide-react'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { type StoreState, useEditor } from '@/hooks/use-editor'
import type { Collection, CollectionType } from '@/lib/scenegraph/schema/collections'
import { cn } from '@/lib/utils'
import { RenamePopover } from './shared'

const COLLECTION_TYPE_CONFIG: Record<CollectionType, { label: string; icon: React.ReactNode }> = {
  room: { label: 'Room', icon: <Grid2x2 className="h-3 w-3" /> },
  other: { label: 'Zone', icon: <Hexagon className="h-3 w-3" /> },
}

// Preset colors for collections
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

// Collection item component
interface CollectionItemProps {
  collection: Collection
  isLast: boolean
  level: number
  onNodeClick: (nodeId: string, hasChildren: boolean) => void
}

export function CollectionItem({ collection, isLast, level, onNodeClick }: CollectionItemProps) {
  const renameCollection = useEditor((state) => state.renameCollection)
  const deleteCollection = useEditor((state) => state.deleteCollection)
  const setCollectionType = useEditor((state) => state.setCollectionType)
  const setCollectionColor = useEditor((state) => state.setCollectionColor)
  const selectCollection = useEditor((state) => state.selectCollection)
  const selectedCollectionId = useEditor((state) => state.selectedCollectionId)

  const [isRenaming, setIsRenaming] = useState(false)
  const labelRef = useRef<HTMLSpanElement>(null)

  const currentType = collection.type || 'other'
  const typeConfig = COLLECTION_TYPE_CONFIG[currentType]
  const isSelected = selectedCollectionId === collection.id

  const handleRename = (newName: string) => {
    renameCollection(collection.id, newName)
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    deleteCollection(collection.id)
  }

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    // Select this collection for boundary editing
    selectCollection(isSelected ? null : collection.id)
  }

  // Get level name for display
  const levels = useEditor(
    useShallow((state: StoreState) => {
      const building = state.scene.root.children?.[0]?.children.find((c) => c.type === 'building')
      return building?.children || []
    }),
  )
  const levelName = levels.find((l) => l.id === collection.levelId)?.name || 'Unknown Level'

  return (
    <TreeNode isLast={isLast} level={level} nodeId={collection.id}>
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
              style={{ backgroundColor: collection.color }}
            />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-2" onClick={(e) => e.stopPropagation()}>
            <div className="grid grid-cols-4 gap-1">
              {PRESET_COLORS.map((color) => (
                <button
                  className={cn(
                    'size-6 rounded-sm border transition-transform hover:scale-110',
                    color === collection.color ? 'ring-2 ring-primary ring-offset-1' : '',
                  )}
                  key={color}
                  onClick={() => setCollectionColor(collection.id, color)}
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
              alt="Collection"
              className="size-4"
              height={22}
              src="/icons/collection.png"
              width={22}
            />
          }
        />

        {/* Collection type selector */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className="size-4 shrink-0 p-0 opacity-60 hover:opacity-100"
              onClick={(e) => e.stopPropagation()}
              size="sm"
              variant="ghost"
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center justify-center text-muted-foreground">
                    {typeConfig.icon}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">{typeConfig.label}</TooltipContent>
              </Tooltip>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="min-w-24"
            onClick={(e) => e.stopPropagation()}
          >
            {(
              Object.entries(COLLECTION_TYPE_CONFIG) as [CollectionType, typeof typeConfig][]
            ).map(([type, config]) => (
              <DropdownMenuItem
                className="gap-2 text-xs"
                key={type}
                onClick={(e) => {
                  e.stopPropagation()
                  setCollectionType(collection.id, type)
                }}
              >
                <span className="text-muted-foreground">{config.icon}</span>
                {config.label}
                {type === currentType && <Check className="ml-auto h-3 w-3" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <TreeLabel
          className="flex-1 cursor-text"
          onDoubleClick={(e) => {
            e.stopPropagation()
            setIsRenaming(true)
          }}
          ref={labelRef}
        >
          {collection.name}
          <span className="ml-1 text-muted-foreground text-xs">({levelName})</span>
        </TreeLabel>
        <RenamePopover
          anchorRef={labelRef}
          currentName={collection.name}
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
          <TooltipContent>Delete collection</TooltipContent>
        </Tooltip>
      </TreeNodeTrigger>
    </TreeNode>
  )
}

// Collections section component
interface CollectionsSectionProps {
  level: number
  onNodeClick: (nodeId: string, hasChildren: boolean) => void
  isLast?: boolean
}

export function CollectionsSection({ level, onNodeClick, isLast }: CollectionsSectionProps) {
  const collections = useEditor(useShallow((state: StoreState) => state.scene.collections || []))
  const setActiveTool = useEditor((state) => state.setActiveTool)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)

  const handleAddCollection = (e: React.MouseEvent) => {
    e.stopPropagation()
    // Activate the collection tool - it will create a collection when the user finishes drawing
    if (selectedFloorId) {
      setActiveTool('collection')
    }
  }

  const hasCollections = collections.length > 0

  return (
    <TreeNode isLast={isLast} level={level} nodeId="collections-section">
      <TreeNodeTrigger
        className="group sticky top-0 z-10 bg-background"
        onClick={() => onNodeClick('collections-section', hasCollections)}
      >
        <TreeExpander hasChildren={hasCollections} />
        <TreeIcon
          className="size-7"
          hasChildren={hasCollections}
          icon={
            <img
              alt="Collections"
              className="object-contain"
              height={24}
              src="/icons/collection.png"
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
              onClick={handleAddCollection}
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

      <TreeNodeContent hasChildren={hasCollections}>
        {collections.map((collection, index) => (
          <CollectionItem
            collection={collection}
            isLast={index === collections.length - 1}
            key={collection.id}
            level={level + 1}
            onNodeClick={onNodeClick}
          />
        ))}
      </TreeNodeContent>
    </TreeNode>
  )
}
