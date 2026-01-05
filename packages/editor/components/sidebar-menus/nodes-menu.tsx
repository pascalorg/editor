'use client'

import type { AnyNodeId } from '@pascal/core'
import { emitter } from '@pascal/core/events'
import type { SceneNodeHandle } from '@pascal/core/scenegraph'
import { ImageNode } from '@pascal/core/scenegraph/schema/nodes/image'
import { LevelNode } from '@pascal/core/scenegraph/schema/nodes/level'
import { ScanNode } from '@pascal/core/scenegraph/schema/nodes/scan'
import { Camera, GripVertical, Pencil, Plus } from 'lucide-react'
import { Reorder, useDragControls } from 'motion/react'
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
import { type StoreState, useEditor } from '@/hooks/use-editor'
import { saveAsset } from '@/lib/asset-storage'
import { cn } from '@/lib/utils'
import {
  getNodeIcon,
  getNodeLabel,
  ModelPositionPopover,
  RenamePopover,
  useLayersMenu,
  VisibilityToggle,
} from './shared'

// Generic node item that uses useShallow to get node data
interface NodeItemProps {
  nodeId: string
  index: number
  isLast: boolean
  level: number
  onNodeSelect: (nodeId: string, event: React.MouseEvent) => void
}

const useNodeActions = () =>
  useEditor(
    useShallow((state) => ({
      toggleNodeVisibility: state.toggleNodeVisibility,
      moveNode: state.moveNode,
      handleNodeSelect: state.handleNodeSelect,
      setControlMode: state.setControlMode,
      updateNode: state.updateNode,
      graph: state.graph,
    })),
  )

export function NodeItem({ nodeId, index, isLast, level, onNodeSelect }: NodeItemProps) {
  const { handleNodeClick } = useLayersMenu()
  const { nodeType, nodeName, nodeVisible, modelPosition, hasCamera } = useEditor(
    useShallow((state: StoreState) => {
      const handle = state.graph.getNodeById(nodeId as AnyNodeId)
      const node = handle?.data()
      return {
        nodeType: node?.type || 'unknown',
        nodeName: node?.name,
        nodeVisible: node?.visible ?? true,
        modelPosition: (node as any)?.modelPosition as [number, number, number] | undefined,
        hasCamera: !!node?.camera,
      }
    }),
  )
  const childrenIds = useEditor(
    useShallow((state: StoreState) => {
      const handle = state.graph.getNodeById(nodeId as AnyNodeId)
      return handle?.children().map((c: SceneNodeHandle) => c.id) || []
    }),
  )

  const isSelected = useEditor((state) => state.selectedNodeIds.includes(nodeId))
  const { toggleNodeVisibility, moveNode, handleNodeSelect, setControlMode, updateNode, graph } =
    useNodeActions()

  const [isDragOver, setIsDragOver] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [isEditingModelPosition, setIsEditingModelPosition] = useState(false)
  const labelRef = useRef<HTMLSpanElement>(null)
  const triggerRef = useRef<HTMLDivElement>(null)

  const handleRename = (newName: string) => {
    updateNode(nodeId, { name: newName })
  }

  const handleModelPositionChange = (position: [number, number, number]) => {
    updateNode(nodeId, { modelPosition: position })
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    // Only show context menu for item nodes
    if (nodeType === 'item') {
      e.preventDefault()
      e.stopPropagation()
      setIsEditingModelPosition(true)
    }
  }

  const hasChildren = childrenIds.length > 0

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    // Select the site node and switch to edit mode
    handleNodeSelect(nodeId, e)
    setControlMode('edit')
  }

  // Handle Edit Click for Image Nodes
  const handleImageEditClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    handleNodeSelect(nodeId, e)
    setControlMode('guide') // Images use 'guide' mode, but we can treat it similar to edit for UI
  }

  const handleDragStart = (e: React.DragEvent) => {
    e.stopPropagation()
    e.dataTransfer.setData('application/node-id', nodeId)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent) => {
    if (nodeType === 'group') {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    if (nodeType === 'group') {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(false)
      const draggedId = e.dataTransfer.getData('application/node-id')

      // Validation
      if (!draggedId || draggedId === nodeId) return

      // Check circular dependency (can't drop parent into child)
      let current = graph.getNodeById(nodeId as AnyNodeId)
      let isDescendant = false
      while (current) {
        if (current.id === draggedId) {
          isDescendant = true
          break
        }
        current = current.parent()
      }

      if (!isDescendant) {
        moveNode(draggedId, nodeId)
      }
    }
  }

  return (
    <TreeNode isLast={isLast} level={level} nodeId={nodeId}>
      <TreeNodeTrigger
        className={cn(
          isSelected && 'bg-accent',
          nodeVisible === false && 'opacity-50',
          isDragOver && 'bg-accent ring-1 ring-primary',
        )}
        draggable
        onClick={(e) => {
          e.stopPropagation()
          onNodeSelect(nodeId, e as React.MouseEvent)
        }}
        onContextMenu={handleContextMenu}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDragStart={handleDragStart as any}
        onDrop={handleDrop}
        ref={triggerRef}
      >
        <TreeExpander hasChildren={hasChildren} />
        <TreeIcon hasChildren={hasChildren} icon={getNodeIcon(nodeType)} />
        <TreeLabel
          className="flex-1"
          onDoubleClick={(e) => {
            e.stopPropagation()
            setIsRenaming(true)
          }}
          ref={labelRef}
        >
          {getNodeLabel(nodeType, index, nodeName)}
        </TreeLabel>
        <RenamePopover
          anchorRef={labelRef}
          currentName={nodeName || ''}
          isOpen={isRenaming}
          onOpenChange={setIsRenaming}
          onRename={handleRename}
        />
        {nodeType === 'item' && (
          <ModelPositionPopover
            anchorRef={triggerRef}
            isOpen={isEditingModelPosition}
            onOpenChange={setIsEditingModelPosition}
            onPositionChange={handleModelPositionChange}
            position={modelPosition || [0, 0, 0]}
          />
        )}

        {/* Edit Button for Roof */}
        {nodeType === 'roof' && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className={cn(
                  'h-5 w-5 p-0 transition-opacity',
                  isSelected && useEditor.getState().controlMode === 'edit'
                    ? 'text-orange-400 opacity-100'
                    : 'opacity-0 group-hover/item:opacity-100',
                )}
                onClick={handleEditClick}
                size="sm"
                variant="ghost"
              >
                <Pencil className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Edit Roof</TooltipContent>
          </Tooltip>
        )}
        {/* Edit Button for Reference Images */}
        {nodeType === 'reference-image' && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className={cn(
                  'h-5 w-5 p-0 transition-opacity',
                  isSelected && useEditor.getState().controlMode === 'guide'
                    ? 'text-purple-400 opacity-100'
                    : 'opacity-0 group-hover/item:opacity-100',
                )}
                onClick={handleImageEditClick}
                size="sm"
                variant="ghost"
              >
                <Pencil className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Edit Image</TooltipContent>
          </Tooltip>
        )}
        <Button
          className={cn(
            'h-5 w-5 p-0 transition-opacity',
            'opacity-0 group-hover/item:opacity-100',
            (isSelected || hasCamera) && 'opacity-100',
            hasCamera && 'text-blue-500 hover:text-blue-600',
          )}
          onClick={(e) => {
            e.stopPropagation()
            if (hasCamera) {
              updateNode(nodeId, { camera: undefined })
            } else {
              emitter.emit('node:capture-camera', { nodeId })
            }
          }}
          size="sm"
          title={hasCamera ? 'Clear saved camera view' : 'Save current camera view to this node'}
          variant="ghost"
        >
          <Camera className="h-3 w-3" />
        </Button>
        <VisibilityToggle onToggle={() => toggleNodeVisibility(nodeId)} visible={nodeVisible} />
      </TreeNodeTrigger>

      {hasChildren && (
        <TreeNodeContent hasChildren={true}>
          {childrenIds.map((childId: string, childIndex: number) => (
            <NodeItem
              index={childIndex}
              isLast={childIndex === childrenIds.length - 1}
              key={childId}
              level={level + 1}
              nodeId={childId}
              onNodeSelect={onNodeSelect}
            />
          ))}
        </TreeNodeContent>
      )}
    </TreeNode>
  )
}

interface DraggableLevelItemProps {
  levelId: LevelNode['id']
  levelIndex: number
  levelsCount: number
  isSelected: boolean
  handleUpload: (file: File, levelId: string) => Promise<void>
  handleScanUpload: (file: File, levelId: string) => Promise<void>
  controls: ReturnType<typeof useDragControls>
  level: number
}

function DraggableLevelItem({
  levelId,
  levelIndex,
  levelsCount,
  isSelected,
  handleUpload,
  handleScanUpload,
  controls,
  level,
}: DraggableLevelItemProps) {
  const { handleNodeClick } = useLayersMenu()
  const isLastLevel = levelIndex === levelsCount - 1

  const { levelVisible, levelName, hasCamera } = useEditor(
    useShallow((state: StoreState) => {
      const handle = state.graph.getNodeById(levelId)
      const level = handle?.data()

      return {
        levelVisible: level?.visible ?? true,
        levelName: level?.name || 'Level',
        hasCamera: !!level?.camera,
      }
    }),
  )

  const childrenIds = useEditor(
    useShallow((state: StoreState) => {
      const handle = state.graph.getNodeById(levelId as AnyNodeId)
      const children = handle?.children() || []
      const objects = children.filter((c: SceneNodeHandle) => {
        const data = c.data()
        return data.type !== 'reference-image' && data.type !== 'scan'
      })

      return objects.map((c: SceneNodeHandle) => c.id)
    }),
  )

  const guideIds = useEditor(
    useShallow((state: StoreState) => {
      const handle = state.graph.getNodeById(levelId as AnyNodeId)
      const children = handle?.children() || []
      const guides = children.filter((c: SceneNodeHandle) => c.data().type === 'reference-image')

      return guides.map((c: SceneNodeHandle) => c.id)
    }),
  )

  const scanIds = useEditor(
    useShallow((state: StoreState) => {
      const handle = state.graph.getNodeById(levelId as AnyNodeId)
      const children = handle?.children() || []
      const scans = children.filter((c: SceneNodeHandle) => c.data().type === 'scan')

      return scans.map((c: SceneNodeHandle) => c.id)
    }),
  )

  const { toggleNodeVisibility, moveNode, updateNode } = useNodeActions()
  const selectedNodeIds = useEditor((state) => state.selectedNodeIds)
  const handleNodeSelect = useEditor((state) => state.handleNodeSelect)

  const [isDragOver, setIsDragOver] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const labelRef = useRef<HTMLSpanElement>(null)

  const handleRename = (newName: string) => {
    updateNode(levelId, { name: newName })
  }

  const hasContent =
    isSelected && (childrenIds.length > 0 || guideIds.length > 0 || scanIds.length > 0)

  const handleLevelDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    const draggedId = e.dataTransfer.getData('application/node-id')
    if (draggedId) {
      moveNode(draggedId, levelId)
    }
  }

  return (
    <TreeNode isLast={isLastLevel} level={level} nodeId={levelId}>
      <TreeNodeTrigger
        className={cn(
          'group/drag-item',
          isSelected && 'sticky top-0 z-10 bg-background',
          levelVisible === false && 'opacity-50',
          isDragOver && 'bg-accent ring-1 ring-primary',
        )}
        onClick={(e) => {
          e.stopPropagation()
          handleNodeSelect(levelId, e)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setIsDragOver(false)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setIsDragOver(true)
        }}
        onDrop={handleLevelDrop}
      >
        <div
          className="cursor-grab touch-none p-1 hover:bg-accent active:cursor-grabbing"
          onPointerDown={(e) => controls.start(e)}
        >
          <GripVertical className="h-3 w-3 text-muted-foreground" />
        </div>
        <TreeExpander hasChildren={hasContent} />
        <TreeIcon hasChildren={hasContent} icon={getNodeIcon('level')} />
        <TreeLabel
          className="flex-1"
          onDoubleClick={(e) => {
            e.stopPropagation()
            setIsRenaming(true)
          }}
          ref={labelRef}
        >
          {levelName}
        </TreeLabel>
        <RenamePopover
          anchorRef={labelRef}
          currentName={levelName}
          isOpen={isRenaming}
          onOpenChange={setIsRenaming}
          onRename={handleRename}
        />
        <Button
          className={cn(
            'h-5 w-5 p-0 transition-opacity',
            'opacity-0 group-hover/item:opacity-100',
            (isSelected || hasCamera) && 'opacity-100',
            hasCamera && 'text-blue-500 hover:text-blue-600',
          )}
          onClick={(e) => {
            e.stopPropagation()
            if (hasCamera) {
              updateNode(levelId, { camera: undefined })
            } else {
              emitter.emit('node:capture-camera', { nodeId: levelId })
            }
          }}
          size="sm"
          title={hasCamera ? 'Clear saved camera view' : 'Save current camera view to this node'}
          variant="ghost"
        >
          <Camera className="h-3 w-3" />
        </Button>
        <VisibilityToggle onToggle={() => toggleNodeVisibility(levelId)} visible={levelVisible} />
      </TreeNodeTrigger>

      <TreeNodeContent hasChildren={hasContent}>
        {/* 3D Objects Section - Direct Children */}
        {childrenIds.map((childId: string, index: number) => (
          <NodeItem
            index={index}
            isLast={false}
            key={childId}
            level={level + 1}
            nodeId={childId}
            onNodeSelect={handleNodeSelect}
          />
        ))}

        {/* Guides Section */}
        <TreeNode level={level + 1} nodeId={`${levelId}-guides`}>
          <TreeNodeTrigger
            className="group"
            onClick={() => handleNodeClick(`${levelId}-guides`, guideIds.length > 0)}
          >
            <TreeExpander hasChildren={guideIds.length > 0} />
            <TreeIcon
              hasChildren={guideIds.length > 0}
              icon={
                <img
                  alt="Guides"
                  className="h-4 w-4 object-contain"
                  height={16}
                  src="/icons/floorplan.png"
                  width={16}
                />
              }
            />
            <TreeLabel>Guides ({guideIds.length})</TreeLabel>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  className="h-5 w-5 p-0 opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation()
                    const input = document.createElement('input')
                    input.type = 'file'
                    input.accept = 'image/png,image/jpeg'
                    input.onchange = (event) => {
                      const file = (event.target as HTMLInputElement).files?.[0]
                      if (file) {
                        handleUpload(file, levelId).catch((error: unknown) => {
                          console.error('Failed to upload image:', error)
                        })
                      }
                    }
                    input.click()
                  }}
                  size="sm"
                  variant="ghost"
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Add reference image</TooltipContent>
            </Tooltip>
          </TreeNodeTrigger>

          <TreeNodeContent hasChildren={guideIds.length > 0}>
            {guideIds.map((guideId: string, index: number) => (
              <NodeItem
                index={index}
                isLast={index === guideIds.length - 1}
                key={guideId}
                level={level + 2}
                nodeId={guideId}
                onNodeSelect={handleNodeSelect}
              />
            ))}
          </TreeNodeContent>
        </TreeNode>

        {/* Scans Section */}
        <TreeNode isLast level={level + 1} nodeId={`${levelId}-scans`}>
          <TreeNodeTrigger
            className="group"
            onClick={() => handleNodeClick(`${levelId}-scans`, scanIds.length > 0)}
          >
            <TreeExpander hasChildren={scanIds.length > 0} />
            <TreeIcon
              hasChildren={scanIds.length > 0}
              icon={
                <img
                  alt="Scans"
                  className="h-4 w-4 object-contain"
                  height={16}
                  src="/icons/mesh.png"
                  width={16}
                />
              }
            />
            <TreeLabel>Scans ({scanIds.length})</TreeLabel>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  className="h-5 w-5 p-0 opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation()
                    const input = document.createElement('input')
                    input.type = 'file'
                    input.accept = '.glb,.gltf,.ply,model/gltf-binary,model/gltf+json'
                    input.onchange = (event) => {
                      const file = (event.target as HTMLInputElement).files?.[0]
                      if (file) {
                        handleScanUpload(file, levelId).catch((error: unknown) => {
                          console.error('Failed to upload scan:', error)
                        })
                      }
                    }
                    input.click()
                  }}
                  size="sm"
                  variant="ghost"
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Add 3D scan</TooltipContent>
            </Tooltip>
          </TreeNodeTrigger>

          <TreeNodeContent hasChildren={scanIds.length > 0}>
            {scanIds.map((scanId: string, index: number) => (
              <NodeItem
                index={index}
                isLast={index === scanIds.length - 1}
                key={scanId}
                level={level + 2}
                nodeId={scanId}
                onNodeSelect={handleNodeSelect}
              />
            ))}
          </TreeNodeContent>
        </TreeNode>
      </TreeNodeContent>
    </TreeNode>
  )
}

interface LevelReorderItemProps extends Omit<DraggableLevelItemProps, 'controls'> {}

export function LevelReorderItem(props: LevelReorderItemProps) {
  const controls = useDragControls()

  return (
    <Reorder.Item as="div" dragControls={controls} dragListener={false} value={props.levelId}>
      <DraggableLevelItem {...props} controls={controls} />
    </Reorder.Item>
  )
}

export function BuildingItem({
  nodeId,
  level,
  collapsedInSiteMode,
}: {
  nodeId: string
  level: number
  collapsedInSiteMode?: boolean
}) {
  const { handleNodeClick } = useLayersMenu()
  const { nodeVisible, nodeName, hasCamera } = useEditor(
    useShallow((state: StoreState) => {
      const handle = state.graph.getNodeById(nodeId as AnyNodeId)
      const node = handle?.data()
      return {
        nodeVisible: node?.visible ?? true,
        nodeName: node?.name || 'Building',
        hasCamera: !!node?.camera,
      }
    }),
  )

  const isSelected = useEditor((state) => state.selectedNodeIds.includes(nodeId))

  const levelIds = useEditor(
    useShallow((state: StoreState) => {
      const handle = state.graph.getNodeById(nodeId as AnyNodeId)
      return handle?.children().map((c: SceneNodeHandle) => c.id) || []
    }),
  )

  const selectFloor = useEditor((state) => state.selectFloor)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const reorderLevels = useEditor((state) => state.reorderLevels)
  const addLevel = useEditor((state) => state.addLevel)
  const addNode = useEditor((state) => state.addNode)
  const { toggleNodeVisibility, handleNodeSelect, setControlMode, updateNode } = useNodeActions()

  const [isRenaming, setIsRenaming] = useState(false)
  const labelRef = useRef<HTMLSpanElement>(null)

  const handleRename = (newName: string) => {
    updateNode(nodeId, { name: newName })
  }

  // Local implementations for uploads (passed down)
  const handleUpload = async (file: File, levelId: string) => {
    const reader = new FileReader()
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

    const imageNode = ImageNode.parse({
      parentId: levelId,
      name: file.name,
      url: dataUrl,
      opacity: 50,
    } satisfies Partial<ImageNode>)
    addNode(imageNode as any, levelId)
  }

  const handleScanUpload = async (file: File, levelId: string) => {
    try {
      const assetUrl = await saveAsset(file)

      const scanNode = ScanNode.parse({
        parentId: levelId,
        name: file.name,
        url: assetUrl,
        opacity: 100,
      } satisfies Partial<ScanNode>)

      addNode(scanNode as any, levelId)
    } catch (error) {
      console.error('Failed to upload scan:', error)
    }
  }

  const handleReorder = (newLevelIds: string[]) => {
    const reversedOrder = [...newLevelIds].reverse()
    const updatedLevels = reversedOrder
      .map((levelId, index) => {
        const handle = useEditor.getState().graph.getNodeById(levelId as AnyNodeId)
        const level = handle?.data()
        if (!level) return null
        return {
          ...level,
          level: index,
        }
      })
      .filter(Boolean) as any[]

    reorderLevels(updatedLevels)
    if (selectedFloorId) {
      useEditor.getState().selectFloor(selectedFloorId)
    }
  }

  const handleAddLevel = (e: React.MouseEvent) => {
    e.stopPropagation()
    // Get level numbers from all existing levels in this building
    const levelNumbers = levelIds
      .map((id: string) => {
        const handle = useEditor.getState().graph.getNodeById(id as AnyNodeId)
        const level = handle?.data() as any
        return level?.level || 0
      })
      .filter((n: number) => n > 0)

    let nextNumber = 1
    while (levelNumbers.includes(nextNumber)) nextNumber++

    const newLevel = LevelNode.parse({
      name: `level ${nextNumber}`,
      level: nextNumber,
    })

    addLevel(newLevel)
    selectFloor(newLevel.id)
  }

  // Levels are typically rendered in reverse order (top to bottom) visually
  const floorGroups = [...levelIds].sort((a, b) => {
    const handleA = useEditor.getState().graph.getNodeById(a as AnyNodeId)
    const handleB = useEditor.getState().graph.getNodeById(b as AnyNodeId)
    const levelA = handleA?.data() as any
    const levelB = handleB?.data() as any
    return (levelB?.level || 0) - (levelA?.level || 0)
  })

  // In Site mode, building acts as a leaf node (no expandable children)
  const showChildren = !collapsedInSiteMode && levelIds.length > 0

  return (
    <TreeNode level={level} nodeId={nodeId}>
      <TreeNodeTrigger
        className={cn(isSelected && 'bg-accent')}
        onClick={(e) => {
          e.stopPropagation()
          setControlMode('select')
          handleNodeSelect(nodeId, e)
        }}
      >
        <TreeExpander hasChildren={showChildren} />
        <TreeIcon hasChildren={showChildren} icon={getNodeIcon('building')} />
        <TreeLabel
          className="flex-1"
          onDoubleClick={(e) => {
            e.stopPropagation()
            setIsRenaming(true)
          }}
          ref={labelRef}
        >
          {nodeName}
        </TreeLabel>
        <RenamePopover
          anchorRef={labelRef}
          currentName={nodeName}
          isOpen={isRenaming}
          onOpenChange={setIsRenaming}
          onRename={handleRename}
        />
        {/* Hide Add Level button in Site mode */}
        {!collapsedInSiteMode && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button className="h-5 w-5 p-0" onClick={handleAddLevel} size="sm" variant="ghost">
                <Plus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Add new level</TooltipContent>
          </Tooltip>
        )}
        <Button
          className={cn(
            'h-5 w-5 p-0 transition-opacity',
            'opacity-0 group-hover/item:opacity-100',
            (isSelected || hasCamera) && 'opacity-100',
            hasCamera && 'text-blue-500 hover:text-blue-600',
          )}
          onClick={(e) => {
            e.stopPropagation()
            if (hasCamera) {
              updateNode(nodeId, { camera: undefined })
            } else {
              emitter.emit('node:capture-camera', { nodeId })
            }
          }}
          size="sm"
          title={hasCamera ? 'Clear saved camera view' : 'Save current camera view to this node'}
          variant="ghost"
        >
          <Camera className="h-3 w-3" />
        </Button>
        <VisibilityToggle onToggle={() => toggleNodeVisibility(nodeId)} visible={nodeVisible} />
      </TreeNodeTrigger>
      {/* Only render children if not in collapsed Site mode */}
      {showChildren && (
        <TreeNodeContent hasChildren={true}>
          <Reorder.Group as="div" axis="y" onReorder={handleReorder} values={floorGroups}>
            {floorGroups.map((levelId: string, index: number) => (
              <LevelReorderItem
                handleScanUpload={handleScanUpload}
                handleUpload={handleUpload}
                isSelected={selectedFloorId === levelId}
                key={levelId}
                level={level + 1}
                levelId={levelId as LevelNode['id']}
                levelIndex={index}
                levelsCount={floorGroups.length}
              />
            ))}
          </Reorder.Group>
        </TreeNodeContent>
      )}
    </TreeNode>
  )
}

export function SiteItem({
  nodeId,
  level,
  isLast,
  editorMode,
}: {
  nodeId: string
  level: number
  isLast?: boolean
  editorMode?: 'site' | 'structure' | 'furnish'
}) {
  const { handleNodeClick } = useLayersMenu()
  const { nodeVisible, nodeName, hasCamera } = useEditor(
    useShallow((state: StoreState) => {
      const handle = state.graph.getNodeById(nodeId as AnyNodeId)
      const node = handle?.data()
      return {
        nodeVisible: node?.visible ?? true,
        nodeName: node?.name || 'Site',
        hasCamera: !!node?.camera,
      }
    }),
  )

  const childrenIds = useEditor(
    useShallow((state: StoreState) => {
      const handle = state.graph.getNodeById(nodeId as AnyNodeId)
      return handle?.children().map((c: SceneNodeHandle) => c.id) || []
    }),
  )

  const selectedNodeIds = useEditor((state) => state.selectedNodeIds)
  const controlMode = useEditor((state) => state.controlMode)
  const { toggleNodeVisibility, handleNodeSelect, setControlMode, updateNode } = useNodeActions()

  const [isRenaming, setIsRenaming] = useState(false)
  const labelRef = useRef<HTMLSpanElement>(null)

  const isSelected = useEditor((state) => state.selectedNodeIds.includes(nodeId))
  const isEditing = isSelected && controlMode === 'edit'

  const handleRename = (newName: string) => {
    updateNode(nodeId, { name: newName })
  }

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    // Select the site node and switch to edit mode
    handleNodeSelect(nodeId, e)
    setControlMode('edit')
  }

  return (
    <TreeNode isLast={isLast} level={level} nodeId={nodeId}>
      <TreeNodeTrigger
        className={cn(isSelected && 'bg-accent', 'sticky top-0 z-10 bg-background')}
        onClick={(e) => {
          e.stopPropagation()
          handleNodeSelect(nodeId, e)
        }}
      >
        <TreeExpander hasChildren={childrenIds.length > 0} />
        <TreeIcon hasChildren={childrenIds.length > 0} icon={getNodeIcon('site')} />
        <TreeLabel
          className="flex-1"
          onDoubleClick={(e) => {
            e.stopPropagation()
            setIsRenaming(true)
          }}
          ref={labelRef}
        >
          {nodeName}
        </TreeLabel>
        <RenamePopover
          anchorRef={labelRef}
          currentName={nodeName}
          isOpen={isRenaming}
          onOpenChange={setIsRenaming}
          onRename={handleRename}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className={cn(
                'h-5 w-5 p-0 transition-opacity',
                isEditing
                  ? 'text-orange-400 opacity-100'
                  : 'opacity-0 group-hover/item:opacity-100',
              )}
              onClick={handleEditClick}
              size="sm"
              variant="ghost"
            >
              <Pencil className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Edit property line</TooltipContent>
        </Tooltip>
        <Button
          className={cn(
            'h-5 w-5 p-0 transition-opacity',
            'opacity-0 group-hover/item:opacity-100',
            (isSelected || hasCamera) && 'opacity-100',
            hasCamera && 'text-blue-500 hover:text-blue-600',
          )}
          onClick={(e) => {
            e.stopPropagation()
            if (hasCamera) {
              updateNode(nodeId, { camera: undefined })
            } else {
              emitter.emit('node:capture-camera', { nodeId })
            }
          }}
          size="sm"
          title={hasCamera ? 'Clear saved camera view' : 'Save current camera view to this node'}
          variant="ghost"
        >
          <Camera className="h-3 w-3" />
        </Button>
        <VisibilityToggle onToggle={() => toggleNodeVisibility(nodeId)} visible={nodeVisible} />
      </TreeNodeTrigger>
      <TreeNodeContent hasChildren={childrenIds.length > 0}>
        {childrenIds.map((childId: string, index: number) => {
          const handle = useEditor.getState().graph.getNodeById(childId as AnyNodeId)
          const child = handle?.data()
          if (child?.type === 'building') {
            // In Site mode, show buildings without their children (levels)
            return (
              <BuildingItem
                collapsedInSiteMode={editorMode === 'site'}
                key={childId}
                level={level + 1}
                nodeId={childId}
              />
            )
          }
          // In Site mode, don't show non-building children
          if (editorMode === 'site') return null
          return (
            <NodeItem
              index={index}
              isLast={index === childrenIds.length - 1}
              key={childId}
              level={level + 1}
              nodeId={childId}
              onNodeSelect={handleNodeSelect}
            />
          )
        })}
      </TreeNodeContent>
    </TreeNode>
  )
}
