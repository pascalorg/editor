'use client'

import type { AnyNodeId } from '@pascal/core'
import type { Collection } from '@pascal/core/scenegraph/schema/collections'
import { ChevronDown, ChevronRight, FolderInput, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import { getNodeIcon, getNodeLabel, RenamePopover } from '@/components/sidebar-menus'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { type StoreState, useEditor } from '@/hooks/use-editor'
import { cn } from '@/lib/utils'

interface CollectionNodeItemProps {
  nodeId: string
  collectionId: string
  index: number
}

function CollectionNodeItem({ nodeId, collectionId, index }: CollectionNodeItemProps) {
  const { nodeType, nodeName } = useEditor(
    useShallow((state: StoreState) => {
      const handle = state.graph.getNodeById(nodeId as AnyNodeId)
      const node = handle?.data()
      return {
        nodeType: node?.type || 'unknown',
        nodeName: node?.name,
      }
    }),
  )

  const removeNodesFromCollection = useEditor((state) => state.removeNodesFromCollection)
  const handleNodeSelect = useEditor((state) => state.handleNodeSelect)
  const selectedNodeIds = useEditor((state) => state.selectedNodeIds)

  const isSelected = selectedNodeIds.includes(nodeId)

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation()
    removeNodesFromCollection(collectionId, [nodeId])
  }

  return (
    <div
      className={cn(
        'group flex cursor-pointer items-center gap-2 rounded-md py-1 pr-2 pl-6 text-sm transition-colors hover:bg-accent',
        isSelected && 'bg-accent',
      )}
      onClick={(e) => handleNodeSelect(nodeId, e)}
    >
      <span className="size-4 shrink-0">{getNodeIcon(nodeType)}</span>
      <span className="flex-1 truncate">{getNodeLabel(nodeType, index, nodeName)}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className="size-5 p-0 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            onClick={handleRemove}
            size="sm"
            variant="ghost"
          >
            <X className="size-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Remove from collection</TooltipContent>
      </Tooltip>
    </div>
  )
}

interface CollectionItemProps {
  collection: Collection
}

function CollectionItem({ collection }: CollectionItemProps) {
  const renameCollection = useEditor((state) => state.renameCollection)
  const deleteCollection = useEditor((state) => state.deleteCollection)
  const confirmAddToCollection = useEditor((state) => state.confirmAddToCollection)
  const addToCollectionState = useEditor((state) => state.addToCollectionState)
  const selectedNodeIds = useEditor((state) => state.selectedNodeIds)

  const [isRenaming, setIsRenaming] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const labelRef = useRef<HTMLSpanElement>(null)

  const handleRename = (newName: string) => {
    renameCollection(collection.id, newName)
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    deleteCollection(collection.id)
  }

  const handleClick = () => {
    if (addToCollectionState.isActive) {
      confirmAddToCollection(collection.id)
      return
    }

    if (nodeCount > 0) {
      useEditor.setState({ selectedNodeIds: [...collection.nodeIds] })
    }

    setIsExpanded(!isExpanded)
  }

  const nodeCount = collection.nodeIds?.length || 0

  const allNodesSelected =
    nodeCount > 0 && collection.nodeIds.every((id) => selectedNodeIds.includes(id))

  return (
    <div>
      <div
        className={cn(
          'group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent',
          allNodesSelected && 'bg-accent',
          addToCollectionState.isActive && 'ring-1 ring-amber-500/50 hover:bg-amber-500/10',
        )}
        onClick={handleClick}
      >
        {nodeCount > 0 ? (
          <button
            className="size-4 shrink-0 text-muted-foreground"
            onClick={(e) => {
              e.stopPropagation()
              setIsExpanded(!isExpanded)
            }}
          >
            {isExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
        ) : (
          <span className="size-4" />
        )}

        {addToCollectionState.isActive ? (
          <FolderInput className="size-4 shrink-0 text-amber-500" />
        ) : (
          <img
            alt="Collection"
            className="size-4 shrink-0"
            height={16}
            src="/icons/collection.png"
            width={16}
          />
        )}

        <span
          className="flex-1 cursor-text truncate"
          onDoubleClick={(e) => {
            e.stopPropagation()
            if (!addToCollectionState.isActive) {
              setIsRenaming(true)
            }
          }}
          ref={labelRef}
        >
          {collection.name}
        </span>

        {nodeCount > 0 && <span className="text-muted-foreground text-xs">({nodeCount})</span>}

        <RenamePopover
          anchorRef={labelRef}
          currentName={collection.name}
          isOpen={isRenaming}
          onOpenChange={setIsRenaming}
          onRename={handleRename}
        />

        {!addToCollectionState.isActive && (
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
            <TooltipContent>Delete collection</TooltipContent>
          </Tooltip>
        )}
      </div>

      {isExpanded && nodeCount > 0 && (
        <div className="ml-2 border-l border-border pl-2">
          {collection.nodeIds.map((nodeId, index) => (
            <CollectionNodeItem
              collectionId={collection.id}
              index={index}
              key={nodeId}
              nodeId={nodeId}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function CollectionsPanel() {
  const collections = useEditor(useShallow((state: StoreState) => state.scene.collections || []))
  const addToCollectionState = useEditor((state) => state.addToCollectionState)
  const cancelAddToCollection = useEditor((state) => state.cancelAddToCollection)

  useEffect(() => {
    if (!addToCollectionState.isActive) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancelAddToCollection()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [addToCollectionState.isActive, cancelAddToCollection])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {addToCollectionState.isActive && (
        <div className="mx-2 mt-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-600 text-xs dark:text-amber-400">
          Click a collection to add {addToCollectionState.nodeIds.length} node
          {addToCollectionState.nodeIds.length > 1 ? 's' : ''}
        </div>
      )}

      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {collections.length === 0 ? (
          <div className="py-4 text-center text-muted-foreground text-sm">
            No collections yet. Click + to create one.
          </div>
        ) : (
          collections.map((collection) => (
            <CollectionItem collection={collection} key={collection.id} />
          ))
        )}
      </div>
    </div>
  )
}
