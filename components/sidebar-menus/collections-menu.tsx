'use client'

import { Folder, FolderInput, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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
import { type StoreState, useEditor } from '@/hooks/use-editor'
import type { Collection } from '@/lib/scenegraph/schema/collections'
import type { AnyNodeId } from '@/lib/scenegraph/schema/types'
import { cn } from '@/lib/utils'
import { getNodeIcon, getNodeLabel, RenamePopover } from './shared'

// Node item inside a collection
interface CollectionNodeItemProps {
  nodeId: string
  collectionId: string
  index: number
  isLast: boolean
  level: number
}

function CollectionNodeItem({
  nodeId,
  collectionId,
  index,
  isLast,
  level,
}: CollectionNodeItemProps) {
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
    <TreeNode isLast={isLast} level={level} nodeId={`${collectionId}-${nodeId}`}>
      <TreeNodeTrigger
        className={cn('group', isSelected && 'bg-accent')}
        onClick={(e) => {
          e.stopPropagation()
          handleNodeSelect(nodeId, e)
        }}
      >
        <TreeExpander hasChildren={false} />
        <TreeIcon hasChildren={false} icon={getNodeIcon(nodeType)} />
        <TreeLabel>{getNodeLabel(nodeType, index, nodeName)}</TreeLabel>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className="h-5 w-5 p-0 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              onClick={handleRemove}
              size="sm"
              variant="ghost"
            >
              <X className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Remove from collection</TooltipContent>
        </Tooltip>
      </TreeNodeTrigger>
    </TreeNode>
  )
}

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
  const confirmAddToCollection = useEditor((state) => state.confirmAddToCollection)
  const addToCollectionState = useEditor((state) => state.addToCollectionState)

  const [isRenaming, setIsRenaming] = useState(false)
  const labelRef = useRef<HTMLSpanElement>(null)

  const handleRename = (newName: string) => {
    renameCollection(collection.id, newName)
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    deleteCollection(collection.id)
  }

  const handleClick = (e: React.MouseEvent) => {
    // If in add-to-collection mode, confirm the add and prevent bubbling
    if (addToCollectionState.isActive) {
      e.stopPropagation()
      e.preventDefault()
      confirmAddToCollection(collection.id)
      return
    }
    // Otherwise, toggle expand/collapse
    onNodeClick(collection.id, nodeCount > 0)
  }

  const nodeCount = collection.nodeIds?.length || 0

  return (
    <TreeNode isLast={isLast} level={level} nodeId={collection.id}>
      <TreeNodeTrigger
        className={cn(
          'group',
          addToCollectionState.isActive &&
            'cursor-pointer ring-1 ring-amber-500/50 hover:bg-amber-500/10',
        )}
        onClick={(e) => handleClick(e)}
      >
        <TreeExpander hasChildren={nodeCount > 0} />
        <TreeIcon
          hasChildren={nodeCount > 0}
          icon={
            addToCollectionState.isActive ? (
              <FolderInput className="h-4 w-4 text-amber-500" />
            ) : (
              <Folder className="h-4 w-4 text-amber-500" />
            )
          }
        />
        <TreeLabel
          className="flex-1 cursor-text"
          onDoubleClick={(e) => {
            e.stopPropagation()
            if (!addToCollectionState.isActive) {
              setIsRenaming(true)
            }
          }}
          ref={labelRef}
        >
          {collection.name}
          {nodeCount > 0 && (
            <span className="ml-1 text-muted-foreground text-xs">({nodeCount})</span>
          )}
        </TreeLabel>
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
                className="h-5 w-5 p-0 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                onClick={handleDelete}
                size="sm"
                variant="ghost"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete collection</TooltipContent>
          </Tooltip>
        )}
      </TreeNodeTrigger>

      {/* Show node items inside the collection */}
      {nodeCount > 0 && (
        <TreeNodeContent hasChildren>
          {collection.nodeIds.map((nodeId, index) => (
            <CollectionNodeItem
              collectionId={collection.id}
              index={index}
              isLast={index === collection.nodeIds.length - 1}
              key={nodeId}
              level={level + 1}
              nodeId={nodeId}
            />
          ))}
        </TreeNodeContent>
      )}
    </TreeNode>
  )
}

// Collections section component
interface CollectionsSectionProps {
  level: number
  onNodeClick: (nodeId: string, hasChildren: boolean) => void
}

export function CollectionsSection({ level, onNodeClick }: CollectionsSectionProps) {
  const collections = useEditor(useShallow((state: StoreState) => state.scene.collections || []))
  const addCollection = useEditor((state) => state.addCollection)
  const addToCollectionState = useEditor((state) => state.addToCollectionState)
  const cancelAddToCollection = useEditor((state) => state.cancelAddToCollection)

  // Handle Escape key to cancel add-to-collection mode
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

  const handleAddCollection = (e: React.MouseEvent) => {
    e.stopPropagation()
    // Generate a default name like "Collection 1", "Collection 2", etc.
    const existingNames = collections.map((c) => c.name)
    let counter = 1
    let newName = `Collection ${counter}`
    while (existingNames.includes(newName)) {
      counter++
      newName = `Collection ${counter}`
    }
    addCollection(newName)
  }

  const hasCollections = collections.length > 0

  return (
    <TreeNode level={level} nodeId="collections-section">
      <TreeNodeTrigger
        className="group"
        onClick={() => onNodeClick('collections-section', hasCollections)}
      >
        <TreeExpander hasChildren={hasCollections} />
        <TreeIcon
          hasChildren={hasCollections}
          icon={<Folder className="h-4 w-4 text-amber-500" />}
        />
        <TreeLabel>Collections</TreeLabel>
        {addToCollectionState.isActive && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="h-5 w-5 p-0 text-destructive"
                onClick={(e) => {
                  e.stopPropagation()
                  cancelAddToCollection()
                }}
                size="sm"
                variant="ghost"
              >
                <X className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Cancel</TooltipContent>
          </Tooltip>
        )}
        {!addToCollectionState.isActive && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="h-5 w-5 p-0"
                onClick={handleAddCollection}
                size="sm"
                variant="ghost"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Add new collection</TooltipContent>
          </Tooltip>
        )}
      </TreeNodeTrigger>

      {/* Status message when in add-to-collection mode */}
      {addToCollectionState.isActive && (
        <div className="mx-2 mb-1 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-600 text-xs dark:text-amber-400">
          Click a collection to add {addToCollectionState.nodeIds.length} node
          {addToCollectionState.nodeIds.length > 1 ? 's' : ''}
        </div>
      )}

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

