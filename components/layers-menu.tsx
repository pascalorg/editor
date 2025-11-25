'use client'

import { Box, Eye, EyeOff, GripVertical, MapPin, Plus } from 'lucide-react'
import { Reorder, useDragControls } from 'motion/react'
import type { ReactNode } from 'react'
import { createContext, useContext, useEffect, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import {
  TreeExpander,
  TreeIcon,
  TreeLabel,
  TreeNode,
  TreeNodeContent,
  TreeNodeTrigger,
  TreeProvider,
  TreeView,
  useTree,
} from '@/components/tree'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { type StoreState, useEditor } from '@/hooks/use-editor'
import type { SceneNode, SceneNodeHandle } from '@/lib/scenegraph/index'
import { type AnyNodeId, ImageNode, LevelNode, ScanNode } from '@/lib/scenegraph/schema/index'
import { cn } from '@/lib/utils'

// Context for layers menu interaction
interface LayersMenuContextType {
  handleNodeClick: (nodeId: string, hasChildren: boolean) => void
}

const LayersMenuContext = createContext<LayersMenuContextType | null>(null)

function useLayersMenu() {
  const context = useContext(LayersMenuContext)
  if (!context) {
    throw new Error('useLayersMenu must be used within a LayersMenu')
  }
  return context
}

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
function getNodeLabel(type: string, index: number, name?: string): string {
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
      return name || `Room ${index + 1}`
    case 'door':
      return `Door ${index + 1}`
    case 'window':
      return `Window ${index + 1}`
    case 'image':
      return `Reference ${index + 1}`
    case 'scan':
      return `Scan ${index + 1}`
    case 'level':
      return name || `Level ${index + 1}`
    case 'site':
      return name || 'Site'
    case 'building':
      return name || 'Building'
    case 'environment':
      return 'Environment'
    default:
      return `Node ${index + 1}`
  }
}

function VisibilityToggle({ visible, onToggle }: { visible: boolean; onToggle: () => void }) {
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

interface LayersMenuProps {
  mounted: boolean
}

// Generic node item that uses useShallow to get node data
interface NodeItemProps {
  nodeId: string
  index: number
  isLast: boolean
  level: number
  selectedNodeIds: string[]
  onNodeSelect: (nodeId: string, event: React.MouseEvent) => void
}

function NodeItem({ nodeId, index, isLast, level, selectedNodeIds, onNodeSelect }: NodeItemProps) {
  const { handleNodeClick } = useLayersMenu()
  const { nodeType, nodeName, nodeVisible } = useEditor(
    useShallow((state: StoreState) => {
      const handle = state.graph.getNodeById(nodeId as AnyNodeId)
      const node = handle?.data()
      return {
        nodeType: node?.type || 'unknown',
        nodeName: node?.name,
        nodeVisible: node?.visible ?? true,
      }
    }),
  )
  const childrenIds = useEditor(
    useShallow((state: StoreState) => {
      const handle = state.graph.getNodeById(nodeId as AnyNodeId)
      return handle?.children().map((c: SceneNodeHandle) => c.id) || []
    }),
  )

  const toggleNodeVisibility = useEditor((state) => state.toggleNodeVisibility)
  const moveNode = useEditor((state) => state.moveNode)
  const graph = useEditor((state) => state.graph)

  const [isDragOver, setIsDragOver] = useState(false)

  const isSelected = selectedNodeIds.includes(nodeId)
  const hasChildren = childrenIds.length > 0

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
          handleNodeClick(nodeId, hasChildren)
        }}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDragStart={handleDragStart as any}
        onDrop={handleDrop}
      >
        <TreeExpander hasChildren={hasChildren} />
        <TreeIcon hasChildren={hasChildren} icon={getNodeIcon(nodeType)} />
        <TreeLabel>{getNodeLabel(nodeType, index, nodeName)}</TreeLabel>
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
              selectedNodeIds={selectedNodeIds}
            />
          ))}
        </TreeNodeContent>
      )}
    </TreeNode>
  )
}

function EnvironmentItem({ level = 1 }: { level?: number }) {
  const { handleNodeClick } = useLayersMenu()
  const environment = useEditor(useShallow((state: StoreState) => state.scene.root.environment))
  const { indent } = useTree()

  return (
    <TreeNode level={level} nodeId="environment">
      <TreeNodeTrigger
        onClick={(e) => {
          e.stopPropagation()
          handleNodeClick('environment', true)
        }}
      >
        <TreeExpander hasChildren={true} />
        <TreeIcon hasChildren={true} icon={getNodeIcon('environment')} />
        <TreeLabel>Environment</TreeLabel>
      </TreeNodeTrigger>
      <TreeNodeContent hasChildren={true}>
        <div
          className="flex items-center gap-2 py-2 text-muted-foreground text-xs"
          style={{ paddingLeft: (level + 1) * (indent ?? 20) + 8 }}
        >
          <MapPin className="h-3 w-3" />
          <span>
            {environment?.latitude?.toFixed(4) ?? 0}, {environment?.longitude?.toFixed(4) ?? 0}
          </span>
        </div>
      </TreeNodeContent>
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

  const { levelVisible, levelName } = useEditor(
    useShallow((state: StoreState) => {
      const handle = state.graph.getNodeById(levelId)
      const level = handle?.data()

      return {
        levelVisible: level?.visible ?? true,
        levelName: level?.name || 'Level',
      }
    }),
  )

  const childrenIds = useEditor(
    useShallow((state: StoreState) => {
      const handle = state.graph.getNodeById(levelId as AnyNodeId)
      const children = handle?.children() || []
      const objects = children.filter((c: SceneNodeHandle) => {
        const data = c.data()
        return data.type !== 'image' && data.type !== 'scan'
      })

      return objects.map((c: SceneNodeHandle) => c.id)
    }),
  )

  const guideIds = useEditor(
    useShallow((state: StoreState) => {
      const handle = state.graph.getNodeById(levelId as AnyNodeId)
      const children = handle?.children() || []
      const guides = children.filter((c: SceneNodeHandle) => c.data().type === 'image')

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

  const selectedNodeIds = useEditor((state) => state.selectedNodeIds)
  const handleNodeSelect = useEditor((state) => state.handleNodeSelect)
  const setControlMode = useEditor((state) => state.setControlMode)
  const toggleNodeVisibility = useEditor((state) => state.toggleNodeVisibility)
  const moveNode = useEditor((state) => state.moveNode)

  const [isDragOver, setIsDragOver] = useState(false)

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
          handleNodeClick(levelId, hasContent)
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
        <TreeLabel className="flex-1">{levelName}</TreeLabel>
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
            selectedNodeIds={selectedNodeIds}
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
                selectedNodeIds={selectedNodeIds}
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
                selectedNodeIds={selectedNodeIds}
              />
            ))}
          </TreeNodeContent>
        </TreeNode>
      </TreeNodeContent>
    </TreeNode>
  )
}

interface LevelReorderItemProps extends Omit<DraggableLevelItemProps, 'controls'> {}

function LevelReorderItem(props: LevelReorderItemProps) {
  const controls = useDragControls()

  return (
    <Reorder.Item as="div" dragControls={controls} dragListener={false} value={props.levelId}>
      <DraggableLevelItem {...props} controls={controls} />
    </Reorder.Item>
  )
}

function BuildingItem({ nodeId, level }: { nodeId: string; level: number }) {
  const { handleNodeClick } = useLayersMenu()
  const { nodeVisible, nodeName } = useEditor(
    useShallow((state: StoreState) => {
      const handle = state.graph.getNodeById(nodeId as AnyNodeId)
      const node = handle?.data()
      return {
        nodeVisible: node?.visible ?? true,
        nodeName: node?.name || 'Building',
      }
    }),
  )

  const levelIds = useEditor(
    useShallow((state: StoreState) => {
      const handle = state.graph.getNodeById(nodeId as AnyNodeId)
      return handle?.children().map((c: SceneNodeHandle) => c.id) || []
    }),
  )

  const toggleNodeVisibility = useEditor((state) => state.toggleNodeVisibility)
  const selectFloor = useEditor((state) => state.selectFloor)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const reorderLevels = useEditor((state) => state.reorderLevels)
  const addNode = useEditor((state) => state.addNode)
  const addLevel = useEditor((state) => state.addLevel)

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
    const reader = new FileReader()
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

    const scanNode = ScanNode.parse({
      parentId: levelId,
      name: file.name,
      url: dataUrl,
      opacity: 100,
    } satisfies Partial<ScanNode>)

    addNode(scanNode as any, levelId)
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

  return (
    <TreeNode level={level} nodeId={nodeId}>
      <TreeNodeTrigger onClick={() => handleNodeClick(nodeId, levelIds.length > 0)}>
        <TreeExpander hasChildren={levelIds.length > 0} />
        <TreeIcon hasChildren={levelIds.length > 0} icon={getNodeIcon('building')} />
        <TreeLabel className="flex-1">{nodeName}</TreeLabel>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button className="h-5 w-5 p-0" onClick={handleAddLevel} size="sm" variant="ghost">
              <Plus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Add new level</TooltipContent>
        </Tooltip>
        <VisibilityToggle onToggle={() => toggleNodeVisibility(nodeId)} visible={nodeVisible} />
      </TreeNodeTrigger>
      <TreeNodeContent hasChildren={levelIds.length > 0}>
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
    </TreeNode>
  )
}

function SiteItem({ nodeId, level }: { nodeId: string; level: number }) {
  const { handleNodeClick } = useLayersMenu()
  const { nodeVisible, nodeName } = useEditor(
    useShallow((state: StoreState) => {
      const handle = state.graph.getNodeById(nodeId as AnyNodeId)
      const node = handle?.data()
      return {
        nodeVisible: node?.visible ?? true,
        nodeName: node?.name || 'Site',
      }
    }),
  )

  const childrenIds = useEditor(
    useShallow((state: StoreState) => {
      const handle = state.graph.getNodeById(nodeId as AnyNodeId)
      return handle?.children().map((c: SceneNodeHandle) => c.id) || []
    }),
  )

  const toggleNodeVisibility = useEditor((state) => state.toggleNodeVisibility)
  const selectedNodeIds = useEditor((state) => state.selectedNodeIds)
  const handleNodeSelect = useEditor((state) => state.handleNodeSelect)

  return (
    <TreeNode level={level} nodeId={nodeId}>
      <TreeNodeTrigger onClick={() => handleNodeClick(nodeId, childrenIds.length > 0)}>
        <TreeExpander hasChildren={childrenIds.length > 0} />
        <TreeIcon hasChildren={childrenIds.length > 0} icon={getNodeIcon('site')} />
        <TreeLabel>{nodeName}</TreeLabel>
        <VisibilityToggle onToggle={() => toggleNodeVisibility(nodeId)} visible={nodeVisible} />
      </TreeNodeTrigger>
      <TreeNodeContent hasChildren={childrenIds.length > 0}>
        {childrenIds.map((childId: string, index: number) => {
          const handle = useEditor.getState().graph.getNodeById(childId as AnyNodeId)
          const child = handle?.data()
          if (child?.type === 'building') {
            return <BuildingItem key={childId} level={level + 1} nodeId={childId} />
          }
          return (
            <NodeItem
              index={index}
              isLast={index === childrenIds.length - 1}
              key={childId}
              level={level + 1}
              nodeId={childId}
              onNodeSelect={handleNodeSelect}
              selectedNodeIds={selectedNodeIds}
            />
          )
        })}
      </TreeNodeContent>
    </TreeNode>
  )
}

export function LayersMenu({ mounted }: LayersMenuProps) {
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const selectFloor = useEditor((state) => state.selectFloor)
  const levelIds = useEditor(
    useShallow((state: StoreState) => {
      // Helper to find level IDs for expansion logic
      // Use graph traversal
      return state.graph.nodes.find({ type: 'level' }).map((h: SceneNodeHandle) => h.id)
    }),
  )

  // Get Site IDs
  const siteIds = useEditor(
    useShallow((state: StoreState) => state.scene.root.children?.map((c: SceneNode) => c.id) || []),
  )

  // Track expanded state
  const [expandedIds, setExpandedIds] = useState<string[]>([])

  // Sync selection with expanded state
  useEffect(() => {
    if (selectedFloorId) {
      const graph = useEditor.getState().graph
      const handle = graph.getNodeById(selectedFloorId as AnyNodeId)
      if (handle) {
        const ancestors = new Set<string>()
        let curr = handle.parent()
        while (curr) {
          ancestors.add(curr.id)
          curr = curr.parent()
        }

        setExpandedIds((prev) => {
          const next = new Set(prev)
          ancestors.forEach((id) => {
            next.add(id)
          })
          next.add(selectedFloorId)
          return Array.from(next)
        })
      }
    }
  }, [selectedFloorId])

  // Handle node click for "accordion" behavior
  const handleNodeClick = (nodeId: string, hasChildren: boolean) => {
    if (!hasChildren) return

    setExpandedIds((prev) => {
      const next = new Set(prev)

      // Toggle current node
      if (next.has(nodeId)) {
        next.delete(nodeId)
        return Array.from(next)
      }

      next.add(nodeId)

      // Handle virtual nodes in Level
      if (nodeId.endsWith('-guides') || nodeId.endsWith('-scans')) {
        // Extract level ID by removing the suffix
        // Note: scan IDs might contain dashes, but the suffix is known
        let levelId = ''
        if (nodeId.endsWith('-guides')) levelId = nodeId.slice(0, -7)
        else if (nodeId.endsWith('-scans')) levelId = nodeId.slice(0, -6)

        const siblings = [`${levelId}-guides`, `${levelId}-scans`]
        siblings.forEach((siblingId) => {
          if (siblingId !== nodeId) {
            next.delete(siblingId)
          }
        })
        return Array.from(next)
      }

      // Handle Environment vs Sites (Root level)
      if (nodeId === 'environment') {
        siteIds.forEach((id) => {
          next.delete(id)
        })
        return Array.from(next)
      }
      if (siteIds.includes(nodeId as AnyNodeId)) {
        next.delete('environment')
        siteIds.forEach((id) => {
          if (id !== nodeId) next.delete(id)
        })
        // Continue to graph check for children of this site?
        // Site siblings handled here.
      }

      // Handle Graph Nodes
      const graph = useEditor.getState().graph
      const handle = graph.getNodeById(nodeId as AnyNodeId)
      if (handle) {
        const parent = handle.parent()
        if (parent) {
          const siblings = parent.children()
          siblings.forEach((sibling: SceneNodeHandle) => {
            if (sibling.id !== nodeId) {
              next.delete(sibling.id)
            }
          })
        }
      }

      return Array.from(next)
    })
  }

  // Initialize expanded state
  const [initialized, setInitialized] = useState(false)
  useEffect(() => {
    // Auto expand first site
    if (!initialized && siteIds.length > 0) {
      if (!expandedIds.some((id) => siteIds.includes(id as AnyNodeId))) {
        setExpandedIds((prev) => [...prev, siteIds[0]])
      }
      setInitialized(true)
    }
  }, [siteIds, expandedIds, initialized])

  const handleTreeSelectionChange = (selectedIds: string[]) => {
    const selectedId = selectedIds[0]
    if (!selectedId) {
      // Don't clear selection on tree click, handled by items
      return
    }
    const isLevel = levelIds.some((levelId: string) => levelId === selectedId)
    if (isLevel) selectFloor(selectedId)
  }

  return (
    <LayersMenuContext.Provider value={{ handleNodeClick }}>
      <div className="flex flex-1 flex-col px-2 py-2">
        <div className="mb-2 flex items-center justify-between">
          <label className="font-medium text-muted-foreground text-sm">Hierarchy</label>
        </div>

        <div className="no-scrollbar flex-1">
          {mounted ? (
            <TreeProvider
              expandedIds={expandedIds}
              indent={16}
              multiSelect={false}
              onExpandedChange={setExpandedIds}
              onSelectionChange={handleTreeSelectionChange}
              selectedIds={selectedFloorId ? [selectedFloorId] : []}
              showLines={true}
            >
              <TreeView className="p-0">
                <EnvironmentItem level={1} />
                {siteIds.map((siteId) => (
                  <SiteItem key={siteId} level={1} nodeId={siteId} />
                ))}
              </TreeView>
            </TreeProvider>
          ) : (
            <div className="p-2 text-muted-foreground text-xs italic">Loading...</div>
          )}
        </div>
      </div>
    </LayersMenuContext.Provider>
  )
}
