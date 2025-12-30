'use client'

import { Eye, Plus, Trash2, Video } from 'lucide-react'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { emitter } from '@pascal/core/events'
import { type StoreState, useEditor } from '@/hooks/use-editor'
import type { View } from '@pascal/core/scenegraph/schema/views'
import { RenamePopover } from './shared'

interface ViewItemProps {
  view: View
  isLast: boolean
  level: number
  onNodeClick: (nodeId: string, hasChildren: boolean) => void
}

export function ViewItem({ view, isLast, level, onNodeClick }: ViewItemProps) {
  const applyView = useEditor((state) => state.applyView)
  const deleteView = useEditor((state) => state.deleteView)
  const updateView = useEditor((state) => state.updateView)

  const [isRenaming, setIsRenaming] = useState(false)
  const labelRef = useRef<HTMLSpanElement>(null)

  const handleRename = (newName: string) => {
    updateView(view.id, { name: newName })
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    deleteView(view.id)
  }

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    applyView(view.id)
  }

  return (
    <TreeNode isLast={isLast} level={level} nodeId={view.id}>
      <TreeNodeTrigger className="group" onClick={handleClick}>
        <TreeExpander hasChildren={false} />
        <TreeIcon hasChildren={false} icon={<Video className="h-4 w-4 text-blue-500" />} />
        <TreeLabel
          className="flex-1 cursor-text"
          onDoubleClick={(e) => {
            e.stopPropagation()
            setIsRenaming(true)
          }}
          ref={labelRef}
        >
          {view.name}
        </TreeLabel>
        <RenamePopover
          anchorRef={labelRef}
          currentName={view.name}
          isOpen={isRenaming}
          onOpenChange={setIsRenaming}
          onRename={handleRename}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className="h-5 w-5 p-0 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              onClick={handleDelete}
              size="sm"
              variant="ghost"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Delete view</TooltipContent>
        </Tooltip>
      </TreeNodeTrigger>
    </TreeNode>
  )
}

interface ViewsSectionProps {
  level: number
  onNodeClick: (nodeId: string, hasChildren: boolean) => void
  isLast?: boolean
}

export function ViewsSection({ level, onNodeClick, isLast }: ViewsSectionProps) {
  const views = useEditor(useShallow((state: StoreState) => state.scene.views || []))

  const handleAddView = (e: React.MouseEvent) => {
    e.stopPropagation()
    // Generate name
    const existingNames = views.map((v) => v.name)
    let counter = 1
    let newName = `View ${counter}`
    while (existingNames.includes(newName)) {
      counter++
      newName = `View ${counter}`
    }

    emitter.emit('view:request-capture', { name: newName })
  }

  const hasViews = views.length > 0

  return (
    <TreeNode isLast={isLast} level={level} nodeId="views-section">
      <TreeNodeTrigger
        className="group sticky top-0 z-10 bg-background"
        onClick={() => onNodeClick('views-section', hasViews)}
      >
        <TreeExpander hasChildren={hasViews} />
        <TreeIcon hasChildren={hasViews} icon={<Eye className="h-4 w-4 text-blue-500" />} />
        <TreeLabel>Views</TreeLabel>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button className="h-5 w-5 p-0" onClick={handleAddView} size="sm" variant="ghost">
              <Plus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Save current view</TooltipContent>
        </Tooltip>
      </TreeNodeTrigger>

      <TreeNodeContent hasChildren={hasViews}>
        {views.map((view, index) => (
          <ViewItem
            isLast={index === views.length - 1}
            key={view.id}
            level={level + 1}
            onNodeClick={onNodeClick}
            view={view}
          />
        ))}
      </TreeNodeContent>
    </TreeNode>
  )
}
