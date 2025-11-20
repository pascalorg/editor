'use client'

import { CylinderIcon } from '@phosphor-icons/react'
import {
  Box,
  Building,
  CuboidIcon,
  DoorOpen,
  GripVertical,
  Image,
  Layers,
  Plus,
  RectangleVertical,
  Square,
  Triangle,
} from 'lucide-react'
import { Reorder, useDragControls } from 'motion/react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
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
} from '@/components/tree'
import { Button } from '@/components/ui/button'
import { OpacityControl } from '@/components/ui/opacity-control'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useEditor } from '@/hooks/use-editor'
import { type AnyNodeId, LevelNode } from '@/lib/scenegraph/schema/index'
import { cn, createId } from '@/lib/utils'

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
    case 'reference-image':
      return <Image className="h-4 w-4 text-purple-400" />
    case 'scan':
      return <Box className="h-4 w-4 text-cyan-400" />
    case 'level':
      return <Layers className="h-4 w-4 text-blue-500" />
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
    case 'reference-image':
      return `Reference ${index + 1}`
    case 'scan':
      return `Scan ${index + 1}`
    case 'level':
      return name || `Level ${index + 1}`
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
  const { nodeType, nodeName, nodeVisible, nodeOpacity } = useEditor(
    useShallow((state) => {
      const node = state.nodeIndex.get(nodeId) as any
      return {
        nodeType: node?.type || 'unknown',
        nodeName: node?.name,
        nodeVisible: node?.visible ?? true,
        nodeOpacity: node?.opacity ?? 100,
      }
    }),
  )
  const childrenIds = useEditor(
    useShallow((state) => {
      const node = state.nodeIndex.get(nodeId) as any
      return node?.children?.map((c: any) => c.id) || []
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

interface DraggableLevelItemProps {
  levelId: LevelNode['id']
  levelIndex: number
  levelsCount: number
  isSelected: boolean
  handleUpload: (file: File, levelId: string) => Promise<void>
  handleScanUpload: (file: File, levelId: string) => Promise<void>
  controls: ReturnType<typeof useDragControls>
}

function DraggableLevelItem({
  levelId,
  levelIndex,
  levelsCount,
  isSelected,
  handleUpload,
  handleScanUpload,
  controls,
}: DraggableLevelItemProps) {
  const isLastLevel = levelIndex === levelsCount - 1

  const { levelVisible, levelName, levelOpacity } = useEditor(
    useShallow((state) => {
      const level = state.nodeIndex.get(levelId) as any

      return {
        levelVisible: level?.visible ?? true,
        levelName: level?.name || 'Level',
        levelOpacity: level?.opacity ?? 100,
      }
    }),
  )

  const childrenIds = useEditor(
    useShallow((state) => {
      const level = state.nodeIndex.get(levelId) as any
      const children = level?.children || []
      const objects = children.filter((c: any) => c.type !== 'reference-image' && c.type !== 'scan')

      return objects.map((c: any) => c.id)
    }),
  )

  const guideIds = useEditor(
    useShallow((state) => {
      const level = state.nodeIndex.get(levelId) as any
      const children = level?.children || []
      const guides = children.filter((c: any) => c.type === 'reference-image')

      return guides.map((c: any) => c.id)
    }),
  )

  const scanIds = useEditor(
    useShallow((state) => {
      const level = state.nodeIndex.get(levelId) as any
      const children = level?.children || []
      const scans = children.filter((c: any) => c.type === 'scan')

      return scans.map((c: any) => c.id)
    }),
  )

  const toggleNodeVisibility = useEditor((state) => state.toggleNodeVisibility)
  const setNodeOpacity = useEditor((state) => state.setNodeOpacity)
  const selectedElements = useEditor((state) => state.selectedElements)
  const selectedImageIds = useEditor((state) => state.selectedImageIds)
  const selectedScanIds = useEditor((state) => state.selectedScanIds)
  const handleElementSelect = useEditor((state) => state.handleElementSelect)
  const setControlMode = useEditor((state) => state.setControlMode)
  const setSelectedImageIds = useEditor((state) => state.setSelectedImageIds)
  const setSelectedScanIds = useEditor((state) => state.setSelectedScanIds)

  const hasContent =
    isSelected && (childrenIds.length > 0 || guideIds.length > 0 || scanIds.length > 0)

  const handleNodeSelect = (nodeId: string, event: React.MouseEvent) => {
    // Determine node type to handle selection appropriately
    const node = useEditor.getState().nodeIndex.get(nodeId) as any
    if (!node) return

    if (node.type === 'reference-image') {
      // Handle image selection
      if (event.metaKey || event.ctrlKey) {
        if (selectedImageIds.includes(nodeId)) {
          setSelectedImageIds(selectedImageIds.filter((id) => id !== nodeId))
        } else {
          setSelectedImageIds([...selectedImageIds, nodeId])
        }
      } else {
        setSelectedImageIds([nodeId])
      }
      setControlMode('guide')
    } else if (node.type === 'scan') {
      // Handle scan selection
      if (event.metaKey || event.ctrlKey) {
        if (selectedScanIds.includes(nodeId)) {
          setSelectedScanIds(selectedScanIds.filter((id) => id !== nodeId))
        } else {
          setSelectedScanIds([...selectedScanIds, nodeId])
        }
      } else {
        setSelectedScanIds([nodeId])
      }
      setControlMode('guide')
    } else {
      // Handle building element selection
      handleElementSelect(nodeId as AnyNodeId, event)
    }
  }

  return (
    <TreeNode isLast={isLastLevel} nodeId={levelId}>
      <TreeNodeTrigger
        className={cn(
          'group/drag-item',
          isSelected && 'sticky top-0 z-10 bg-background',
          levelVisible === false && 'opacity-50',
        )}
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
          <TreeNode level={1} nodeId={`${levelId}-3d-objects`}>
            <TreeNodeTrigger>
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
                  level={2}
                  nodeId={childId}
                  onNodeSelect={handleNodeSelect}
                  selectedNodeIds={selectedElements}
                />
              ))}
            </TreeNodeContent>
          </TreeNode>
        )}

        {/* Guides Section */}
        <TreeNode level={1} nodeId={`${levelId}-guides`}>
          <TreeNodeTrigger className="group">
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
                level={2}
                nodeId={guideId}
                onNodeSelect={handleNodeSelect}
                selectedNodeIds={selectedImageIds}
              />
            ))}
          </TreeNodeContent>
        </TreeNode>

        {/* Scans Section */}
        <TreeNode isLast level={1} nodeId={`${levelId}-scans`}>
          <TreeNodeTrigger className="group">
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
                level={2}
                nodeId={scanId}
                onNodeSelect={handleNodeSelect}
                selectedNodeIds={selectedScanIds}
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

const EMPTY_LEVELS: LevelNode[] = []

export function LayersMenu({ mounted }: LayersMenuProps) {
  // Retrieve editor state
  const addNode = useEditor((state) => state.addNode)
  const selectedElements = useEditor((state) => state.selectedElements)
  const selectedImageIds = useEditor((state) => state.selectedImageIds)
  const selectedScanIds = useEditor((state) => state.selectedScanIds)

  // Select levels from scene.root (new structure)
  const levelIds = useEditor(
    useShallow((state) => {
      const building = state.scene.root.children?.[0]?.children.find((c) => c.type === 'building')
      return building ? building.children.map((child) => child.id) : []
    }),
  ) as LevelNode['id'][]

  const addLevel = useEditor((state) => state.addLevel)
  const reorderLevels = useEditor((state) => state.reorderLevels)
  const selectFloor = useEditor((state) => state.selectFloor)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)

  // Local implementations for uploads
  const handleUpload = async (file: File, levelId: string) => {
    const reader = new FileReader()
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

    // Create ReferenceImageNode
    const imageNode = {
      id: createId('image'),
      type: 'reference-image',
      name: file.name,
      url: dataUrl,
      createdAt: new Date().toISOString(),
      position: [0, 0],
      rotation: 0,
      size: [10, 10],
      scale: 1,
      visible: true,
      opacity: 50,
      children: [],
    }

    // @ts-expect-error - node data
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

    // @ts-expect-error - node data
    addNode(scanNode, levelId)
  }

  // Track expanded state
  const [expandedIds, setExpandedIds] = useState<string[]>([])

  // Initialize expanded state with first level ID if available
  useEffect(() => {
    if (levelIds.length > 0 && expandedIds.length === 0) {
      setExpandedIds([levelIds[0]])
    }
  }, [levelIds, expandedIds.length])

  const handleTreeSelectionChange = (selectedIds: string[]) => {
    const selectedId = selectedIds[0]
    if (!selectedId) {
      selectFloor(null)
      return
    }
    const isLevel = levelIds.some((levelId) => levelId === selectedId)
    if (isLevel) selectFloor(selectedId)
  }

  const handleAddLevel = () => {
    // Get level numbers from all existing levels using nodeIndex
    const levelNumbers = levelIds
      .map((id) => {
        const level = useEditor.getState().nodeIndex.get(id) as any
        return level?.level || 0
      })
      .filter((n) => n > 0)

    let nextNumber = 1
    while (levelNumbers.includes(nextNumber)) nextNumber++

    const newLevel = LevelNode.parse({
      name: `level ${nextNumber}`,
      level: nextNumber,
    })

    addLevel(newLevel)
    selectFloor(newLevel.id)
  }

  const handleReorder = (newLevelIds: string[]) => {
    const reversedOrder = [...newLevelIds].reverse()
    const updatedLevels = reversedOrder
      .map((levelId, index) => {
        const level = useEditor.getState().nodeIndex.get(levelId) as any
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

  const floorGroups = [...levelIds].sort((a, b) => {
    const levelA = useEditor.getState().nodeIndex.get(a) as any
    const levelB = useEditor.getState().nodeIndex.get(b) as any
    return (levelB?.level || 0) - (levelA?.level || 0)
  })

  // Auto-expand selected items
  useEffect(() => {
    const newExpanded = new Set(expandedIds)
    let hasChanges = false

    // Expand levels containing selected elements
    selectedElements.forEach((selectedId) => {
      const node = useEditor.getState().nodeIndex.get(selectedId)
      if (!node) return

      // Find parent level by traversing up
      let currentNode: any = node
      let levelId: string | null = null

      while (currentNode) {
        if ((currentNode as any).type === 'level') {
          levelId = currentNode.id
          break
        }
        // Try to find parent
        const parentId = levelIds.find((id) => {
          const level = useEditor.getState().nodeIndex.get(id) as any
          return level?.children?.some((c: any) => c.id === currentNode.id)
        })
        if (parentId) {
          levelId = parentId
          break
        }
        break
      }

      if (levelId) {
        if (!newExpanded.has(levelId)) {
          newExpanded.add(levelId)
          hasChanges = true
        }
        const objectsId = `${levelId}-3d-objects`
        if (!newExpanded.has(objectsId)) {
          newExpanded.add(objectsId)
          hasChanges = true
        }
      }
    })

    // Expand levels containing selected images
    selectedImageIds.forEach((imageId) => {
      levelIds.forEach((levelId) => {
        const level = useEditor.getState().nodeIndex.get(levelId) as any
        const hasImage = level?.children?.some((c: any) => c.id === imageId)
        if (hasImage) {
          if (!newExpanded.has(levelId)) {
            newExpanded.add(levelId)
            hasChanges = true
          }
          const guidesId = `${levelId}-guides`
          if (!newExpanded.has(guidesId)) {
            newExpanded.add(guidesId)
            hasChanges = true
          }
        }
      })
    })

    // Expand levels containing selected scans
    selectedScanIds.forEach((scanId) => {
      levelIds.forEach((levelId) => {
        const level = useEditor.getState().nodeIndex.get(levelId) as any
        const hasScan = level?.children?.some((c: any) => c.id === scanId)
        if (hasScan) {
          if (!newExpanded.has(levelId)) {
            newExpanded.add(levelId)
            hasChanges = true
          }
          const scansId = `${levelId}-scans`
          if (!newExpanded.has(scansId)) {
            newExpanded.add(scansId)
            hasChanges = true
          }
        }
      })
    })

    if (hasChanges) setExpandedIds(Array.from(newExpanded))
  }, [selectedElements, selectedImageIds, selectedScanIds, levelIds, expandedIds])

  return (
    <div className="flex flex-1 flex-col px-2 py-2">
      <div className="mb-2 flex items-center justify-between">
        <label className="font-medium text-muted-foreground text-sm">
          Levels ({mounted ? levelIds.length : 0})
        </label>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button className="h-6 w-6 p-0" onClick={handleAddLevel} size="sm" variant="ghost">
              <Plus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Add new level</TooltipContent>
        </Tooltip>
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
              <Reorder.Group as="div" axis="y" onReorder={handleReorder} values={floorGroups}>
                {floorGroups.map((levelId, levelIndex) => {
                  const isSelected = selectedFloorId === levelId

                  return (
                    <LevelReorderItem
                      handleScanUpload={handleScanUpload}
                      handleUpload={handleUpload}
                      isSelected={isSelected}
                      key={levelId}
                      levelId={levelId}
                      levelIndex={levelIndex}
                      levelsCount={floorGroups.length}
                    />
                  )
                })}
              </Reorder.Group>
            </TreeView>
          </TreeProvider>
        ) : (
          <div className="p-2 text-muted-foreground text-xs italic">Loading...</div>
        )}
      </div>
    </div>
  )
}
