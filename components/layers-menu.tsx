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
import { isElementSelected } from '@/lib/building-elements'
import { type AnyNodeId, LevelNode } from '@/lib/scenegraph/schema/index'
import { cn, createId } from '@/lib/utils'

const buildingElementConfig: Record<
  'wall' | 'roof' | 'column' | 'slab' | 'group',
  {
    icon: ReactNode
    getLabel: (index: number, data?: any) => string
  }
> = {
  wall: {
    icon: <Square className="h-4 w-4 text-gray-600" />,
    getLabel: (index) => `Wall ${index + 1}`,
  },
  roof: {
    icon: <Triangle className="h-4 w-4 text-amber-600" />,
    getLabel: (index) => `Roof ${index + 1}`,
  },
  column: {
    icon: <CylinderIcon className="h-4 w-4 text-gray-500" />,
    getLabel: (index) => `Column ${index + 1}`,
  },
  slab: {
    icon: <CuboidIcon className="h-4 w-4 text-gray-300" />,
    getLabel: (index) => `Floor ${index + 1}`,
  },
  group: {
    icon: <Building className="h-4 w-4 text-purple-600" />,
    getLabel: (index, data) => data?.name || `Room ${index + 1}`,
  },
}

interface LayersMenuProps {
  mounted: boolean
}

interface DraggableLevelItemProps {
  level: LevelNode
  levelIndex: number
  levelsCount: number
  isSelected: boolean
  elements: Record<string, any[]>
  levelDoors: any[]
  levelWindows: any[]
  levelImages: any[]
  levelScans: any[]
  selectedElements: any[]
  selectedImageIds: string[]
  selectedScanIds: string[]
  handleElementSelect: (elementId: AnyNodeId, event: React.MouseEvent) => void
  handleImageSelect: (id: AnyNodeId, event: React.MouseEvent) => void
  handleScanSelect: (id: string, event: React.MouseEvent) => void
  toggleNodeVisibility: (id: string) => void
  setNodeOpacity: (id: string, opacity: number) => void
  handleUpload: (file: File, levelId: string) => Promise<void>
  handleScanUpload: (file: File, levelId: string) => Promise<void>
  controls: ReturnType<typeof useDragControls>
}

function DraggableLevelItem({
  level,
  levelIndex,
  levelsCount,
  isSelected,
  elements,
  levelDoors,
  levelWindows,
  levelImages,
  levelScans,
  selectedElements,
  selectedImageIds,
  selectedScanIds,
  handleElementSelect,
  handleImageSelect,
  handleScanSelect,
  toggleNodeVisibility,
  setNodeOpacity,
  handleUpload,
  handleScanUpload,
  controls,
}: DraggableLevelItemProps) {
  const isLastLevel = levelIndex === levelsCount - 1
  const elementTypes = Object.keys(elements) as (keyof typeof buildingElementConfig)[]
  const totalElements = elementTypes.reduce((acc, type) => acc + elements[type].length, 0)

  const hasContent =
    isSelected &&
    (totalElements > 0 ||
      levelDoors.length > 0 ||
      levelWindows.length > 0 ||
      levelImages.length > 0)

  return (
    <TreeNode isLast={isLastLevel} nodeId={level.id}>
      <TreeNodeTrigger
        className={cn(
          'group/drag-item',
          isSelected && 'sticky top-0 z-10 bg-background',
          level.visible === false && 'opacity-50',
        )}
      >
        <div
          className="cursor-grab touch-none p-1 hover:bg-accent active:cursor-grabbing"
          onPointerDown={(e) => controls.start(e)}
        >
          <GripVertical className="h-3 w-3 text-muted-foreground" />
        </div>
        <TreeExpander hasChildren={hasContent} />
        <TreeIcon hasChildren={hasContent} icon={<Layers className="h-4 w-4 text-blue-500" />} />
        <TreeLabel className="flex-1">{level.name}</TreeLabel>
        <OpacityControl
          onOpacityChange={(opacity) => setNodeOpacity(level.id, opacity)}
          onVisibilityToggle={() => toggleNodeVisibility(level.id)}
          opacity={level.opacity}
          visible={level.visible}
        />
      </TreeNodeTrigger>

      <TreeNodeContent hasChildren={hasContent}>
        {/* 3D Objects Section */}
        <TreeNode level={1} nodeId={`${level.id}-3d-objects`}>
          <TreeNodeTrigger>
            <TreeExpander
              hasChildren={totalElements > 0 || levelDoors.length > 0 || levelWindows.length > 0}
            />
            <TreeIcon
              hasChildren={totalElements > 0 || levelDoors.length > 0 || levelWindows.length > 0}
              icon={<Building className="h-4 w-4 text-green-500" />}
            />
            <TreeLabel>
              3D Objects ({totalElements + levelDoors.length + levelWindows.length})
            </TreeLabel>
          </TreeNodeTrigger>

          <TreeNodeContent
            hasChildren={totalElements > 0 || levelDoors.length > 0 || levelWindows.length > 0}
          >
            {elementTypes.map((type) =>
              elements[type].map((element, index, all) => {
                const config = buildingElementConfig[type]
                if (!config) return null

                // For groups, render walls as children
                if (type === 'group') {
                  const groupWalls = element.data?.walls || []
                  return (
                    <TreeNode
                      isLast={
                        index === all.length - 1 &&
                        elementTypes.indexOf(type) === elementTypes.length - 1
                      }
                      key={element.id}
                      level={2}
                      nodeId={element.id}
                    >
                      <TreeNodeTrigger
                        className={cn(
                          isElementSelected(selectedElements, element.id) && 'bg-accent',
                          element.visible === false && 'opacity-50',
                        )}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleElementSelect(element.id, e as React.MouseEvent)
                        }}
                      >
                        <TreeExpander hasChildren={groupWalls.length > 0} />
                        <TreeIcon hasChildren={groupWalls.length > 0} icon={config.icon} />
                        <TreeLabel>{config.getLabel(index, element.data)}</TreeLabel>
                        <OpacityControl
                          onOpacityChange={(opacity) => setNodeOpacity(element.id, opacity)}
                          onVisibilityToggle={() => toggleNodeVisibility(element.id)}
                          opacity={element.opacity || 100}
                          visible={element.visible !== false}
                        />
                      </TreeNodeTrigger>

                      {/* Render walls within the group */}
                      {groupWalls.length > 0 && (
                        <TreeNodeContent hasChildren={true}>
                          {groupWalls.map((wall: any, wallIndex: number) => {
                            // Get doors/windows for this wall
                            const wallChildren = [...levelDoors, ...levelWindows].filter(
                              (child) => child.data?.parentWallId === wall.id,
                            )

                            return (
                              <TreeNode
                                isLast={wallIndex === groupWalls.length - 1}
                                key={wall.id}
                                level={3}
                                nodeId={wall.id}
                              >
                                <TreeNodeTrigger
                                  className={cn(
                                    isElementSelected(selectedElements, wall.id) && 'bg-accent',
                                    wall.visible === false && 'opacity-50',
                                  )}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleElementSelect(wall.id, e as React.MouseEvent)
                                  }}
                                >
                                  <TreeExpander hasChildren={wallChildren.length > 0} />
                                  <TreeIcon
                                    hasChildren={wallChildren.length > 0}
                                    icon={<Square className="h-4 w-4 text-gray-600" />}
                                  />
                                  <TreeLabel>Wall {wallIndex + 1}</TreeLabel>
                                  <OpacityControl
                                    onOpacityChange={(opacity) => setNodeOpacity(wall.id, opacity)}
                                    onVisibilityToggle={() => toggleNodeVisibility(wall.id)}
                                    opacity={wall.opacity}
                                    visible={wall.visible}
                                  />
                                </TreeNodeTrigger>

                                {/* Render doors/windows under walls */}
                                {wallChildren.length > 0 && (
                                  <TreeNodeContent hasChildren={true}>
                                    {wallChildren.map((child, childIndex) => {
                                      const isDoor = child.type === 'door'
                                      return (
                                        <TreeNode
                                          isLast={childIndex === wallChildren.length - 1}
                                          key={child.id}
                                          level={4}
                                          nodeId={child.id}
                                        >
                                          <TreeNodeTrigger
                                            className={cn(
                                              selectedElements.includes(child.id) && 'bg-accent',
                                            )}
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              handleElementSelect(child.id, e as React.MouseEvent)
                                            }}
                                          >
                                            <TreeExpander />
                                            <TreeIcon
                                              icon={
                                                isDoor ? (
                                                  <DoorOpen className="h-4 w-4 text-orange-600" />
                                                ) : (
                                                  <RectangleVertical className="h-4 w-4 text-blue-500" />
                                                )
                                              }
                                            />
                                            <TreeLabel>
                                              {isDoor
                                                ? `Door ${wallChildren.filter((c) => c.type === 'door').indexOf(child) + 1}`
                                                : `Window ${wallChildren.filter((c) => c.type === 'window').indexOf(child) + 1}`}
                                            </TreeLabel>
                                          </TreeNodeTrigger>
                                        </TreeNode>
                                      )
                                    })}
                                  </TreeNodeContent>
                                )}
                              </TreeNode>
                            )
                          })}
                        </TreeNodeContent>
                      )}
                    </TreeNode>
                  )
                }

                // Get children for this element (doors/windows for walls)
                const elementChildren =
                  type === 'wall'
                    ? [...levelDoors, ...levelWindows].filter(
                        (child) =>
                          child.data?.parentWallId === element.id && !child.data?.parentGroupId, // Exclude walls in groups
                      )
                    : []
                const hasChildren = elementChildren.length > 0

                return (
                  <TreeNode
                    isLast={
                      index === all.length - 1 &&
                      elementTypes.indexOf(type) === elementTypes.length - 1
                    }
                    key={element.id}
                    level={2}
                    nodeId={element.id}
                  >
                    <TreeNodeTrigger
                      className={cn(
                        isElementSelected(selectedElements, element.id) && 'bg-accent',
                        element.visible === false && 'opacity-50',
                      )}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleElementSelect(element.id, e as React.MouseEvent)
                      }}
                    >
                      <TreeExpander hasChildren={hasChildren} />
                      <TreeIcon hasChildren={hasChildren} icon={config.icon} />
                      <TreeLabel>{config.getLabel(index)}</TreeLabel>
                      <OpacityControl
                        onOpacityChange={(opacity) => setNodeOpacity(element.id, opacity)}
                        onVisibilityToggle={() => toggleNodeVisibility(element.id)}
                        opacity={element.opacity}
                        visible={element.visible}
                      />
                    </TreeNodeTrigger>

                    {/* Render children (doors/windows) under walls */}
                    {hasChildren && (
                      <TreeNodeContent hasChildren={true}>
                        {elementChildren.map((child, childIndex) => {
                          const isDoor = child.type === 'door'
                          return (
                            <TreeNode
                              isLast={childIndex === elementChildren.length - 1}
                              key={child.id}
                              level={3}
                              nodeId={child.id}
                            >
                              <TreeNodeTrigger
                                className={cn(selectedElements.includes(child.id) && 'bg-accent')}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleElementSelect(child.id, e as React.MouseEvent)
                                }}
                              >
                                <TreeExpander />
                                <TreeIcon
                                  icon={
                                    isDoor ? (
                                      <DoorOpen className="h-4 w-4 text-orange-600" />
                                    ) : (
                                      <RectangleVertical className="h-4 w-4 text-blue-500" />
                                    )
                                  }
                                />
                                <TreeLabel>
                                  {isDoor
                                    ? `Door ${elementChildren.filter((c) => c.type === 'door').indexOf(child) + 1}`
                                    : `Window ${elementChildren.filter((c) => c.type === 'window').indexOf(child) + 1}`}
                                </TreeLabel>
                              </TreeNodeTrigger>
                            </TreeNode>
                          )
                        })}
                      </TreeNodeContent>
                    )}
                  </TreeNode>
                )
              }),
            )}
          </TreeNodeContent>
        </TreeNode>

        {/* Guides Section */}
        <TreeNode level={1} nodeId={`${level.id}-guides`}>
          <TreeNodeTrigger>
            <TreeExpander hasChildren={levelImages.length > 0} />
            <TreeIcon
              hasChildren={levelImages.length > 0}
              icon={<Image className="h-4 w-4 text-purple-500" />}
            />
            <TreeLabel>Guides ({levelImages.length})</TreeLabel>
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
                        handleUpload(file, level.id).catch((error: unknown) => {
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

          <TreeNodeContent hasChildren={true}>
            {/* Reference Images */}
            {levelImages.map((image, index, imgs) => (
              <TreeNode
                isLast={index === imgs.length - 1}
                key={image.id}
                level={2}
                nodeId={image.id}
              >
                <TreeNodeTrigger
                  className={cn(
                    selectedImageIds.includes(image.id) && 'bg-accent',
                    image.visible === false && 'opacity-50',
                  )}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleImageSelect(image.id, e as any)
                  }}
                >
                  <TreeExpander />
                  <TreeIcon icon={<Image className="h-4 w-4 text-purple-400" />} />
                  <TreeLabel>Reference {index + 1}</TreeLabel>
                  <OpacityControl
                    onOpacityChange={(opacity) => setNodeOpacity(image.id, opacity)}
                    onVisibilityToggle={() => toggleNodeVisibility(image.id)}
                    opacity={image.opacity}
                    visible={image.visible}
                  />
                </TreeNodeTrigger>
              </TreeNode>
            ))}
          </TreeNodeContent>
        </TreeNode>

        {/* Scans Section */}
        <TreeNode isLast level={1} nodeId={`${level.id}-scans`}>
          <TreeNodeTrigger>
            <TreeExpander hasChildren={levelScans.length > 0} />
            <TreeIcon
              hasChildren={levelScans.length > 0}
              icon={<Box className="h-4 w-4 text-cyan-500" />}
            />
            <TreeLabel>Scans ({levelScans.length})</TreeLabel>
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
                        handleScanUpload(file, level.id).catch((error: unknown) => {
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

          <TreeNodeContent hasChildren={true}>
            {/* 3D Scans */}
            {levelScans.map((scan, index, scans) => (
              <TreeNode
                isLast={index === scans.length - 1}
                key={scan.id}
                level={2}
                nodeId={scan.id}
              >
                <TreeNodeTrigger
                  className={cn(
                    selectedScanIds.includes(scan.id) && 'bg-accent',
                    scan.visible === false && 'opacity-50',
                  )}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleScanSelect(scan.id, e as any)
                  }}
                >
                  <TreeExpander />
                  <TreeIcon icon={<Box className="h-4 w-4 text-cyan-400" />} />
                  <TreeLabel>Scan {index + 1}</TreeLabel>
                  <OpacityControl
                    onOpacityChange={(opacity) => setNodeOpacity(scan.id, opacity)}
                    onVisibilityToggle={() => toggleNodeVisibility(scan.id)}
                    opacity={scan.opacity}
                    visible={scan.visible}
                  />
                </TreeNodeTrigger>
              </TreeNode>
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
    <Reorder.Item as="div" dragControls={controls} dragListener={false} value={props.level}>
      <DraggableLevelItem {...props} controls={controls} />
    </Reorder.Item>
  )
}

const EMPTY_LEVELS: LevelNode[] = []

export function LayersMenu({ mounted }: LayersMenuProps) {
  // Retrieve editor state
  const addNode = useEditor((state) => state.addNode)
  const selectedElements = useEditor((state) => state.selectedElements)
  const setControlMode = useEditor((state) => state.setControlMode)
  const selectedImageIds = useEditor((state) => state.selectedImageIds)
  const selectedScanIds = useEditor((state) => state.selectedScanIds)
  const setSelectedImageIds = useEditor((state) => state.setSelectedImageIds)
  const setSelectedScanIds = useEditor((state) => state.setSelectedScanIds)
  const toggleNodeVisibility = useEditor((state) => state.toggleNodeVisibility)
  const setNodeOpacity = useEditor((state) => state.setNodeOpacity)
  const handleElementSelect = useEditor((state) => state.handleElementSelect)

  // Select levels from scene.root (new structure)
  const levels = useEditor((state) => {
    const building = state.scene.root.children?.[0]?.children.find((c) => c.type === 'building')
    return building ? building.children : EMPTY_LEVELS
  }) as LevelNode[]

  const addLevel = useEditor((state) => state.addLevel)
  const deleteLevel = useEditor((state) => state.deleteLevel)
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
    if (levels.length > 0 && expandedIds.length === 0) {
      setExpandedIds([levels[0].id])
    }
  }, [levels, expandedIds.length])

  // Extract data from node tree for hierarchy display
  const components: any[] = []
  const images: any[] = []
  const scans: any[] = []

  levels.forEach((level) => {
    const walls: any[] = []
    const roofs: any[] = []
    const columns: any[] = []
    const slabs: any[] = []
    const groups: any[] = []

    level.children.forEach((child: any) => {
      if (child.type === 'wall') {
        walls.push({
          id: child.id,
          visible: child.visible ?? true,
          opacity: child.opacity ?? 100,
        })

        if (child.children) {
          child.children.forEach((wallChild: any) => {
            if (wallChild.type === 'door' || wallChild.type === 'window') {
              components.push({
                id: wallChild.id,
                type: wallChild.type,
                group: level.id,
                data: {
                  position: wallChild.position,
                  rotation: wallChild.rotation,
                  visible: wallChild.visible ?? true,
                  opacity: wallChild.opacity ?? 100,
                  parentWallId: child.id,
                },
              })
            }
          })
        }
      } else if (child.type === 'group') {
        const groupWalls: any[] = []
        child.children.forEach((groupChild: any) => {
          if (groupChild.type === 'wall') {
            groupWalls.push({
              id: groupChild.id,
              visible: groupChild.visible ?? true,
              opacity: groupChild.opacity ?? 100,
            })
            if (groupChild.children) {
              groupChild.children.forEach((wallChild: any) => {
                if (wallChild.type === 'door' || wallChild.type === 'window') {
                  components.push({
                    id: wallChild.id,
                    type: wallChild.type,
                    group: level.id,
                    data: {
                      position: wallChild.position,
                      rotation: wallChild.rotation,
                      visible: wallChild.visible ?? true,
                      opacity: wallChild.opacity ?? 100,
                      parentWallId: groupChild.id,
                      parentGroupId: child.id,
                    },
                  })
                }
              })
            }
          }
        })
        groups.push({
          id: child.id,
          name: child.name,
          groupType: child.groupType,
          visible: child.visible ?? true,
          opacity: child.opacity ?? 100,
          walls: groupWalls,
        })
      } else if (child.type === 'roof') {
        roofs.push({
          id: child.id,
          visible: child.visible ?? true,
          opacity: child.opacity ?? 100,
        })
      } else if (child.type === 'column') {
        columns.push({
          id: child.id,
          position: child.position,
          visible: child.visible ?? true,
          opacity: child.opacity ?? 100,
        })
      } else if (child.type === 'slab') {
        slabs.push({
          id: child.id,
          position: child.position,
          size: child.size,
          visible: child.visible ?? true,
          opacity: child.opacity ?? 100,
        })
      } else if (child.type === 'reference-image') {
        images.push({
          id: child.id,
          url: child.url,
          name: child.name,
          level: level.level || 0,
          visible: child.visible ?? true,
          opacity: child.opacity ?? 100,
        })
      } else if (child.type === 'scan') {
        scans.push({
          id: child.id,
          url: child.url,
          name: child.name,
          level: level.level || 0,
          visible: child.visible ?? true,
          opacity: child.opacity ?? 100,
        })
      }
    })

    if (walls.length > 0)
      components.push({
        id: `${level.id}-walls`,
        type: 'wall',
        group: level.id,
        data: { segments: walls },
      })
    if (roofs.length > 0)
      components.push({
        id: `${level.id}-roofs`,
        type: 'roof',
        group: level.id,
        data: { segments: roofs },
      })
    if (columns.length > 0)
      components.push({
        id: `${level.id}-columns`,
        type: 'column',
        group: level.id,
        data: { columns },
      })
    if (slabs.length > 0)
      components.push({ id: `${level.id}-slabs`, type: 'slab', group: level.id, data: { slabs } })
    groups.forEach((g) => {
      components.push({ id: g.id, type: 'group', group: level.id, data: g })
    })
  })

  const handleImageSelect = (imageId: string, event: React.MouseEvent) => {
    const clickedIndex = images.findIndex((img) => img.id === imageId)
    let next: string[]

    if (event.metaKey || event.ctrlKey) {
      if (selectedImageIds.includes(imageId)) {
        next = selectedImageIds.filter((id) => id !== imageId)
      } else {
        next = [...selectedImageIds, imageId]
      }
    } else if (event.shiftKey && selectedImageIds.length > 0) {
      const lastSelectedId = selectedImageIds[selectedImageIds.length - 1]
      const lastSelectedIndex = images.findIndex((img) => img.id === lastSelectedId)

      if (lastSelectedIndex !== -1) {
        const start = Math.min(lastSelectedIndex, clickedIndex)
        const end = Math.max(lastSelectedIndex, clickedIndex)
        const rangeIds = []
        for (let i = start; i <= end; i++) rangeIds.push(images[i].id)
        next = rangeIds
      } else {
        next = [imageId]
      }
    } else {
      next = [imageId]
    }

    setSelectedImageIds(next)
    setControlMode('guide')
  }

  const handleScanSelect = (scanId: string, event: React.MouseEvent) => {
    const clickedIndex = scans.findIndex((scan) => scan.id === scanId)
    let next: string[]

    if (event.metaKey || event.ctrlKey) {
      if (selectedScanIds.includes(scanId)) {
        next = selectedScanIds.filter((id) => id !== scanId)
      } else {
        next = [...selectedScanIds, scanId]
      }
    } else if (event.shiftKey && selectedScanIds.length > 0) {
      const lastSelectedId = selectedScanIds[selectedScanIds.length - 1]
      const lastSelectedIndex = scans.findIndex((scan) => scan.id === lastSelectedId)

      if (lastSelectedIndex !== -1) {
        const start = Math.min(lastSelectedIndex, clickedIndex)
        const end = Math.max(lastSelectedIndex, clickedIndex)
        const rangeIds = []
        for (let i = start; i <= end; i++) rangeIds.push(scans[i].id)
        next = rangeIds
      } else {
        next = [scanId]
      }
    } else {
      next = [scanId]
    }

    setSelectedScanIds(next)
    setControlMode('guide')
  }

  const handleTreeSelectionChange = (selectedIds: string[]) => {
    const selectedId = selectedIds[0]
    if (!selectedId) {
      selectFloor(null)
      return
    }
    const isLevel = levels.some((level) => level.id === selectedId)
    if (isLevel) selectFloor(selectedId)
  }

  const handleAddLevel = () => {
    const levelNumbers = levels.map((l) => l.level || 0).filter((n) => n > 0)
    let nextNumber = 1
    while (levelNumbers.includes(nextNumber)) nextNumber++

    const newLevel = LevelNode.parse({
      name: `level ${nextNumber}`,
      level: nextNumber,
    })

    addLevel(newLevel)
    selectFloor(newLevel.id)
  }

  const handleReorder = (newOrder: typeof levels) => {
    const reversedOrder = [...newOrder].reverse()
    const updatedLevels = reversedOrder.map((level, index) => ({
      ...level,
      level: index,
    }))
    reorderLevels(updatedLevels)
    if (selectedFloorId) {
      const newLevel = updatedLevels.find((l) => l.id === selectedFloorId)?.level
      if (newLevel !== undefined) useEditor.getState().selectFloor(selectedFloorId)
    }
  }

  const floorGroups = [...levels].sort((a, b) => (b.level || 0) - (a.level || 0))

  useEffect(() => {
    const newExpanded = new Set(expandedIds)
    let hasChanges = false

    selectedElements.forEach((selectedId) => {
      const levelId = components.find((c) => {
        if (c.type === 'wall' || c.type === 'roof' || c.type === 'column') {
          return c.data?.segments?.some?.((seg: any) => seg.id === selectedId)
        }
        return c.id === selectedId
      })?.group

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

      const component = components.find((c) => c.id === selectedId)
      if (component && (component.type === 'door' || component.type === 'window')) {
        const parentWallId = component?.data?.parentWallId
        if (parentWallId && !newExpanded.has(parentWallId)) {
          newExpanded.add(parentWallId)
          hasChanges = true
        }
      }
    })

    selectedImageIds.forEach((imageId) => {
      const image = images.find((img) => img.id === imageId)
      if (image) {
        const levelId = levels.find((l) => (l.level || 0) === image.level)?.id
        if (levelId) {
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
      }
    })

    selectedScanIds.forEach((scanId) => {
      const scan = scans.find((s) => s.id === scanId)
      if (scan) {
        const levelId = levels.find((l) => (l.level || 0) === scan.level)?.id
        if (levelId) {
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
      }
    })

    if (hasChanges) setExpandedIds(Array.from(newExpanded))
  }, [
    selectedElements,
    selectedImageIds,
    selectedScanIds,
    levels,
    expandedIds,
    components,
    images,
    scans,
  ])

  return (
    <div className="flex flex-1 flex-col px-2 py-2">
      <div className="mb-2 flex items-center justify-between">
        <label className="font-medium text-muted-foreground text-sm">
          Levels ({mounted ? levels.length : 0})
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
                {floorGroups.map((level, levelIndex) => {
                  const isSelected = selectedFloorId === level.id
                  const levelElements = (
                    Object.keys(buildingElementConfig) as (keyof typeof buildingElementConfig)[]
                  ).reduce(
                    (acc, type) => {
                      acc[type] = isSelected
                        ? (level.children || []).filter((child: any) => child.type === type)
                        : []
                      return acc
                    },
                    {} as Record<string, any[]>,
                  )

                  const levelDoors = isSelected
                    ? components.filter((c) => c.type === 'door' && c.group === level.id)
                    : []
                  const levelWindows = isSelected
                    ? components.filter((c) => c.type === 'window' && c.group === level.id)
                    : []
                  const levelImages = images.filter((img) => img.level === (level.level || 0))
                  const levelScans = scans.filter((scan) => scan.level === (level.level || 0))

                  return (
                    <LevelReorderItem
                      elements={levelElements}
                      handleElementSelect={handleElementSelect}
                      handleImageSelect={handleImageSelect}
                      handleScanSelect={handleScanSelect}
                      handleScanUpload={handleScanUpload}
                      handleUpload={handleUpload}
                      isSelected={isSelected}
                      key={level.id}
                      level={level}
                      levelDoors={levelDoors}
                      levelImages={levelImages}
                      levelIndex={levelIndex}
                      levelScans={levelScans}
                      levelsCount={floorGroups.length}
                      levelWindows={levelWindows}
                      selectedElements={selectedElements}
                      selectedImageIds={selectedImageIds}
                      selectedScanIds={selectedScanIds}
                      setNodeOpacity={setNodeOpacity}
                      toggleNodeVisibility={toggleNodeVisibility}
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
