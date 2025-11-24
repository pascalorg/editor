'use client'

import { CylinderIcon, Globe, Sun } from '@phosphor-icons/react'
import {
  Box,
  Building,
  CuboidIcon,
  DoorOpen,
  GripVertical,
  Image,
  Layers,
  MapPin,
  Plus,
  RectangleVertical,
  Square,
  Triangle,
} from 'lucide-react'
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
import { OpacityControl } from '@/components/ui/opacity-control'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { type StoreState, useEditor } from '@/hooks/use-editor'
import type { SceneNode, SceneNodeHandle } from '@/lib/scenegraph/index'
import { type AnyNodeId, LevelNode } from '@/lib/scenegraph/schema/index'
import { cn, createId } from '@/lib/utils'

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
  switch (type) {
    case 'wall':
      return <Square className="h-4 w-4 text-gray-600" />
    case 'roof':
      return <Triangle className="h-4 w-4 text-amber-600" />
    case 'column':
      return <CylinderIcon className="h-4 w-4 text-gray-500" />
    case 'slab':
      return <CuboidIcon className="h-4 w-4 text-gray-300" />
    case 'group':
      return <Building className="h-4 w-4 text-purple-600" />
    case 'door':
      return <DoorOpen className="h-4 w-4 text-orange-600" />
    case 'window':
      return <RectangleVertical className="h-4 w-4 text-blue-500" />
    case 'image':
      return <Image className="h-4 w-4 text-purple-400" />
    case 'scan':
      return <Box className="h-4 w-4 text-cyan-400" />
    case 'level':
      return <Layers className="h-4 w-4 text-blue-500" />
    case 'site':
      return <MapPin className="h-4 w-4 text-emerald-600" />
    case 'building':
      return <Building className="h-4 w-4 text-indigo-600" />
    case 'environment':
      return <Sun className="h-4 w-4 text-yellow-500" />
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
  const { nodeType, nodeName, nodeVisible, nodeOpacity } = useEditor(
    useShallow((state: StoreState) => {
      const handle = state.graph.getNodeById(nodeId as AnyNodeId)
      const node = handle?.data()
      return {
        nodeType: node?.type || 'unknown',
        nodeName: node?.name,
        nodeVisible: node?.visible ?? true,
        nodeOpacity: node?.opacity ?? 100,
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
  const setNodeOpacity = useEditor((state) => state.setNodeOpacity)

  const isSelected = selectedNodeIds.includes(nodeId)
  const hasChildren = childrenIds.length > 0

  return (
    <TreeNode isLast={isLast} level={level} nodeId={nodeId}>
      <TreeNodeTrigger
        className={cn(isSelected && 'bg-accent', nodeVisible === false && 'opacity-50')}
        onClick={(e) => {
          e.stopPropagation()
          onNodeSelect(nodeId, e as React.MouseEvent)
          handleNodeClick(nodeId, hasChildren)
        }}
      >
        <TreeExpander hasChildren={hasChildren} />
        <TreeIcon hasChildren={hasChildren} icon={getNodeIcon(nodeType)} />
        <TreeLabel>{getNodeLabel(nodeType, index, nodeName)}</TreeLabel>
        <OpacityControl
          onOpacityChange={(opacity) => setNodeOpacity(nodeId, opacity)}
          onVisibilityToggle={() => toggleNodeVisibility(nodeId)}
          opacity={nodeOpacity}
          visible={nodeVisible}
        />
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

  const { levelVisible, levelName, levelOpacity } = useEditor(
    useShallow((state: StoreState) => {
      const handle = state.graph.getNodeById(levelId)
      const level = handle?.data()

      return {
        levelVisible: level?.visible ?? true,
        levelName: level?.name || 'Level',
        levelOpacity: level?.opacity ?? 100,
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
  const setNodeOpacity = useEditor((state) => state.setNodeOpacity)

  const hasContent =
    isSelected && (childrenIds.length > 0 || guideIds.length > 0 || scanIds.length > 0)

  return (
    <TreeNode isLast={isLastLevel} level={level} nodeId={levelId}>
      <TreeNodeTrigger
        className={cn(
          'group/drag-item',
          isSelected && 'sticky top-0 z-10 bg-background',
          levelVisible === false && 'opacity-50',
        )}
        onClick={(e) => {
          handleNodeClick(levelId, hasContent)
        }}
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
        <OpacityControl
          onOpacityChange={(opacity) => setNodeOpacity(levelId, opacity)}
          onVisibilityToggle={() => toggleNodeVisibility(levelId)}
          opacity={levelOpacity}
          visible={levelVisible}
        />
      </TreeNodeTrigger>

      <TreeNodeContent hasChildren={hasContent}>
        {/* 3D Objects Section */}
        {childrenIds.length > 0 && (
          <TreeNode level={level + 1} nodeId={`${levelId}-3d-objects`}>
            <TreeNodeTrigger
              onClick={() => handleNodeClick(`${levelId}-3d-objects`, childrenIds.length > 0)}
            >
              <TreeExpander hasChildren={childrenIds.length > 0} />
              <TreeIcon
                hasChildren={childrenIds.length > 0}
                icon={<Building className="h-4 w-4 text-green-500" />}
              />
              <TreeLabel>3D Objects ({childrenIds.length})</TreeLabel>
            </TreeNodeTrigger>

            <TreeNodeContent hasChildren={true}>
              {childrenIds.map((childId: string, index: number) => (
                <NodeItem
                  index={index}
                  isLast={index === childrenIds.length - 1}
                  key={childId}
                  level={level + 2}
                  nodeId={childId}
                  onNodeSelect={handleNodeSelect}
                  selectedNodeIds={selectedNodeIds}
                />
              ))}
            </TreeNodeContent>
          </TreeNode>
        )}

        {/* Guides Section */}
        <TreeNode level={level + 1} nodeId={`${levelId}-guides`}>
          <TreeNodeTrigger
            className="group"
            onClick={() => handleNodeClick(`${levelId}-guides`, guideIds.length > 0)}
          >
            <TreeExpander hasChildren={guideIds.length > 0} />
            <TreeIcon
              hasChildren={guideIds.length > 0}
              icon={<Image className="h-4 w-4 text-purple-500" />}
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
              icon={<Box className="h-4 w-4 text-cyan-500" />}
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
  const { nodeVisible, nodeName, nodeOpacity } = useEditor(
    useShallow((state: StoreState) => {
      const handle = state.graph.getNodeById(nodeId as AnyNodeId)
      const node = handle?.data()
      return {
        nodeVisible: node?.visible ?? true,
        nodeName: node?.name || 'Building',
        nodeOpacity: node?.opacity ?? 100,
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
  const setNodeOpacity = useEditor((state) => state.setNodeOpacity)
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

    const imageNode = {
      id: createId('image'),
      type: 'image',
      name: file.name,
      url: dataUrl,
      createdAt: new Date().toISOString(),
      position: [0, 0],
      rotationY: 0,
      size: [10, 10],
      scale: 1,
      visible: true,
      opacity: 50,
      children: [],
    }

    addNode(imageNode, levelId)
  }

  const handleScanUpload = async (file: File, levelId: string) => {
    const reader = new FileReader()
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

    const scanId = `scan-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`

    const scanNode = {
      id: scanId,
      type: 'scan',
      name: file.name,
      url: dataUrl,
      createdAt: new Date().toISOString(),
      position: [0, 0],
      rotation: 0,
      size: [10, 10],
      scale: 1,
      yOffset: 0,
      visible: true,
      opacity: 100,
      children: [],
    }

    addNode(scanNode, levelId)
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
        <OpacityControl
          onOpacityChange={(opacity) => setNodeOpacity(nodeId, opacity)}
          onVisibilityToggle={() => toggleNodeVisibility(nodeId)}
          opacity={nodeOpacity}
          visible={nodeVisible}
        />
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
  const { nodeVisible, nodeName, nodeOpacity } = useEditor(
    useShallow((state: StoreState) => {
      const handle = state.graph.getNodeById(nodeId as AnyNodeId)
      const node = handle?.data()
      return {
        nodeVisible: node?.visible ?? true,
        nodeName: node?.name || 'Site',
        nodeOpacity: node?.opacity ?? 100,
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
  const setNodeOpacity = useEditor((state) => state.setNodeOpacity)
  const selectedNodeIds = useEditor((state) => state.selectedNodeIds)
  const handleNodeSelect = useEditor((state) => state.handleNodeSelect)

  return (
    <TreeNode level={level} nodeId={nodeId}>
      <TreeNodeTrigger onClick={() => handleNodeClick(nodeId, childrenIds.length > 0)}>
        <TreeExpander hasChildren={childrenIds.length > 0} />
        <TreeIcon hasChildren={childrenIds.length > 0} icon={getNodeIcon('site')} />
        <TreeLabel>{nodeName}</TreeLabel>
        <OpacityControl
          onOpacityChange={(opacity) => setNodeOpacity(nodeId, opacity)}
          onVisibilityToggle={() => toggleNodeVisibility(nodeId)}
          opacity={nodeOpacity}
          visible={nodeVisible}
        />
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
      if (
        nodeId.endsWith('-3d-objects') ||
        nodeId.endsWith('-guides') ||
        nodeId.endsWith('-scans')
      ) {
        // Extract level ID by removing the suffix
        // Note: scan IDs might contain dashes, but the suffix is known
        let levelId = ''
        if (nodeId.endsWith('-3d-objects')) levelId = nodeId.slice(0, -11)
        else if (nodeId.endsWith('-guides')) levelId = nodeId.slice(0, -7)
        else if (nodeId.endsWith('-scans')) levelId = nodeId.slice(0, -6)

        const siblings = [`${levelId}-3d-objects`, `${levelId}-guides`, `${levelId}-scans`]
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
