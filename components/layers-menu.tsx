'use client'

import { CylinderIcon } from '@phosphor-icons/react'
import {
  Box,
  Building,
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
import type { ComponentGroup } from '@/hooks/use-editor'
import { useEditor } from '@/hooks/use-editor'
import {
  type BuildingElementType,
  getAllElementsOfType,
  getElementLabel,
  getElementsOfType,
  handleSimpleClick,
  isElementSelected,
  selectElementRange,
  toggleElementSelection,
} from '@/lib/building-elements'
import type { LevelNode } from '@/lib/nodes/types'
import { cn, createId } from '@/lib/utils'

const buildingElementConfig: Record<
  'wall' | 'roof' | 'column' | 'group',
  {
    icon: ReactNode
    getLabel: (index: number, data?: any) => string
  }
> = {
  wall: {
    icon: <Square className="h-4 w-4 text-gray-600" />,
    getLabel: (index) => getElementLabel('wall', index),
  },
  roof: {
    icon: <Triangle className="h-4 w-4 text-amber-600" />,
    getLabel: (index) => getElementLabel('roof', index),
  },
  column: {
    icon: <CylinderIcon className="h-4 w-4 text-gray-500" />,
    getLabel: (index) => getElementLabel('column', index),
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
  controlMode: string
  handleElementSelect: (
    elementId: string,
    event: React.MouseEvent,
    segments?: { id: string }[],
  ) => void
  handleImageSelect: (id: string, event: React.MouseEvent) => void
  handleScanSelect: (id: string, event: React.MouseEvent) => void
  toggleFloorVisibility: (id: string) => void
  toggleBuildingElementVisibility: (id: string, type: 'wall' | 'roof' | 'column') => void
  toggleImageVisibility: (id: string) => void
  toggleScanVisibility: (id: string) => void
  setFloorOpacity: (id: string, opacity: number) => void
  setBuildingElementOpacity: (id: string, type: 'wall' | 'roof' | 'column', opacity: number) => void
  setImageOpacity: (id: string, opacity: number) => void
  setScanOpacity: (id: string, opacity: number) => void
  handleUpload: (file: File, levelId: string) => Promise<void>
  handleScanUpload: (file: File, levelId: string) => Promise<void>
  setSelectedElements: (elements: any[]) => void
  setControlMode: (mode: any) => void
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
  controlMode,
  handleElementSelect,
  handleImageSelect,
  handleScanSelect,
  toggleFloorVisibility,
  toggleBuildingElementVisibility,
  toggleImageVisibility,
  toggleScanVisibility,
  setFloorOpacity,
  setBuildingElementOpacity,
  setImageOpacity,
  setScanOpacity,
  handleUpload,
  handleScanUpload,
  setSelectedElements,
  setControlMode,
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
          onOpacityChange={(opacity) => setFloorOpacity(level.id, opacity)}
          onVisibilityToggle={() => toggleFloorVisibility(level.id)}
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
                          // Groups can be selected with Figma-style modifiers
                          const updatedSelection = handleSimpleClick(
                            selectedElements,
                            element.id,
                            e as React.MouseEvent,
                          )
                          setSelectedElements(updatedSelection)
                          // Switch to building mode unless we're in select mode
                          if (controlMode !== 'select') {
                            setControlMode('building')
                          }
                        }}
                      >
                        <TreeExpander hasChildren={groupWalls.length > 0} />
                        <TreeIcon hasChildren={groupWalls.length > 0} icon={config.icon} />
                        <TreeLabel>{config.getLabel(index, element.data)}</TreeLabel>
                        <OpacityControl
                          onOpacityChange={(opacity) => {
                            // Update group opacity
                            // TODO: implement group opacity control
                          }}
                          onVisibilityToggle={() => {
                            // Toggle group visibility
                            // TODO: implement group visibility toggle
                          }}
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
                                    handleElementSelect(wall.id, e as React.MouseEvent, groupWalls)
                                  }}
                                >
                                  <TreeExpander hasChildren={wallChildren.length > 0} />
                                  <TreeIcon
                                    hasChildren={wallChildren.length > 0}
                                    icon={<Square className="h-4 w-4 text-gray-600" />}
                                  />
                                  <TreeLabel>Wall {wallIndex + 1}</TreeLabel>
                                  <OpacityControl
                                    onOpacityChange={(opacity) =>
                                      setBuildingElementOpacity(wall.id, 'wall', opacity)
                                    }
                                    onVisibilityToggle={() =>
                                      toggleBuildingElementVisibility(wall.id, 'wall')
                                    }
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
                                              setSelectedElements([child.id])
                                              // Switch to building mode unless we're in select mode
                                              if (controlMode !== 'select') {
                                                setControlMode('building')
                                              }
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
                        handleElementSelect(element.id, e as React.MouseEvent, all)
                      }}
                    >
                      <TreeExpander hasChildren={hasChildren} />
                      <TreeIcon hasChildren={hasChildren} icon={config.icon} />
                      <TreeLabel>{config.getLabel(index)}</TreeLabel>
                      <OpacityControl
                        onOpacityChange={(opacity) =>
                          setBuildingElementOpacity(element.id, type, opacity)
                        }
                        onVisibilityToggle={() => toggleBuildingElementVisibility(element.id, type)}
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
                                className={cn(
                                  selectedElements.includes(child.id) && 'bg-accent',
                                )}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  const updatedSelection = handleSimpleClick(
                                    selectedElements,
                                    child.id,
                                    e as React.MouseEvent,
                                  )
                                  setSelectedElements(updatedSelection)
                                  // Switch to building mode unless we're in select mode
                                  if (controlMode !== 'select') {
                                    setControlMode('building')
                                  }
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
                    onOpacityChange={(opacity) => setImageOpacity(image.id, opacity)}
                    onVisibilityToggle={() => toggleImageVisibility(image.id)}
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
                    onOpacityChange={(opacity) => setScanOpacity(scan.id, opacity)}
                    onVisibilityToggle={() => toggleScanVisibility(scan.id)}
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

interface LayersMenuProps {
  mounted: boolean
}

export function LayersMenu({ mounted }: LayersMenuProps) {
  // Retrieve editor state
  const handleUpload = useEditor((state) => state.handleUpload)
  const handleScanUpload = useEditor((state) => state.handleScanUpload)
  const selectedElements = useEditor((state) => state.selectedElements)
  const setSelectedElements = useEditor((state) => state.setSelectedElements)
  const controlMode = useEditor((state) => state.controlMode)
  const setControlMode = useEditor((state) => state.setControlMode)
  const selectedImageIds = useEditor((state) => state.selectedImageIds)
  const selectedScanIds = useEditor((state) => state.selectedScanIds)
  const setSelectedImageIds = useEditor((state) => state.setSelectedImageIds)
  const setSelectedScanIds = useEditor((state) => state.setSelectedScanIds)
  const handleDeleteSelectedImages = useEditor((state) => state.handleDeleteSelectedImages)
  const handleDeleteSelectedScans = useEditor((state) => state.handleDeleteSelectedScans)
  const levels = useEditor((state) => state.levels)

  // Track expanded state
  const [expandedIds, setExpandedIds] = useState<string[]>([levels[0].id])

  // Extract data from node tree for hierarchy display
  const components: any[] = []
  const images: any[] = []
  const scans: any[] = []

  levels.forEach((level) => {
    // Group walls, roofs, columns, and groups by type for the legacy format
    const walls: any[] = []
    const roofs: any[] = []
    const columns: any[] = []
    const groups: any[] = []

    level.children.forEach((child) => {
      if (child.type === 'wall') {
        walls.push({
          id: child.id,
          visible: child.visible ?? true,
          opacity: child.opacity ?? 100,
        })

        // Extract doors and windows from walls
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
                  parentWallId: child.id, // Track which wall this door/window belongs to
                },
              })
            }
          })
        }
      } else if (child.type === 'group') {
        // Extract group and its walls
        const groupWalls: any[] = []

        child.children.forEach((groupChild: any) => {
          if (groupChild.type === 'wall') {
            groupWalls.push({
              id: groupChild.id,
              visible: groupChild.visible ?? true,
              opacity: groupChild.opacity ?? 100,
            })

            // Extract doors and windows from walls in the group
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
                      parentGroupId: child.id, // Track which group this belongs to
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
          groupType: (child as any).groupType,
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
          position: (child as any).position,
          visible: child.visible ?? true,
          opacity: child.opacity ?? 100,
        })
      } else if (child.type === 'reference-image') {
        images.push({
          id: child.id,
          url: (child as any).url,
          name: child.name,
          level: level.level || 0,
          visible: child.visible ?? true,
          opacity: child.opacity ?? 100,
        })
      } else if (child.type === 'scan') {
        scans.push({
          id: child.id,
          url: (child as any).url,
          name: child.name,
          level: level.level || 0,
          visible: child.visible ?? true,
          opacity: child.opacity ?? 100,
        })
      }
    })

    // Create aggregated components for walls, roofs, columns, and groups
    if (walls.length > 0) {
      components.push({
        id: `${level.id}-walls`,
        type: 'wall',
        group: level.id,
        data: {
          segments: walls,
        },
      })
    }

    if (roofs.length > 0) {
      components.push({
        id: `${level.id}-roofs`,
        type: 'roof',
        group: level.id,
        data: {
          segments: roofs,
        },
      })
    }

    if (columns.length > 0) {
      components.push({
        id: `${level.id}-columns`,
        type: 'column',
        group: level.id,
        data: {
          columns,
        },
      })
    }

    // Add groups (rooms) to components
    groups.forEach((groupNode) => {
      components.push({
        id: groupNode.id,
        type: 'group',
        group: level.id,
        data: {
          name: groupNode.name,
          groupType: groupNode.groupType,
          visible: groupNode.visible,
          opacity: groupNode.opacity,
          walls: groupNode.walls,
        },
      })
    })
  })
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const selectFloor = useEditor((state) => state.selectFloor)
  const addLevel = useEditor((state) => state.addLevel)
  const deleteLevel = useEditor((state) => state.deleteLevel)
  const reorderLevels = useEditor((state) => state.reorderLevels)
  const toggleFloorVisibility = useEditor((state) => state.toggleFloorVisibility)
  const toggleBuildingElementVisibility = useEditor(
    (state) => state.toggleBuildingElementVisibility,
  )
  const toggleImageVisibility = useEditor((state) => state.toggleImageVisibility)
  const toggleScanVisibility = useEditor((state) => state.toggleScanVisibility)
  const setFloorOpacity = useEditor((state) => state.setFloorOpacity)
  const setBuildingElementOpacity = useEditor((state) => state.setBuildingElementOpacity)
  const setImageOpacity = useEditor((state) => state.setImageOpacity)
  const setScanOpacity = useEditor((state) => state.setScanOpacity)
  const handleElementSelect = useEditor((state) => state.handleElementSelect)

  const handleImageSelect = (imageId: string, event: React.MouseEvent) => {
    const clickedIndex = images.findIndex((img) => img.id === imageId)
    let next: string[]

    if (event.metaKey || event.ctrlKey) {
      // Cmd/Ctrl+click: add/remove from selection
      if (selectedImageIds.includes(imageId)) {
        next = selectedImageIds.filter((id) => id !== imageId)
      } else {
        next = [...selectedImageIds, imageId]
      }
    } else if (event.shiftKey && selectedImageIds.length > 0) {
      // Shift+click: select range from last selected to clicked (Figma-style)
      const lastSelectedId = selectedImageIds[selectedImageIds.length - 1]
      const lastSelectedIndex = images.findIndex((img) => img.id === lastSelectedId)

      if (lastSelectedIndex !== -1) {
        const start = Math.min(lastSelectedIndex, clickedIndex)
        const end = Math.max(lastSelectedIndex, clickedIndex)

        const rangeIds = []
        for (let i = start; i <= end; i++) {
          rangeIds.push(images[i].id)
        }
        next = rangeIds
      } else {
        // Fallback if last selected not found
        next = [imageId]
      }
    } else {
      // Regular click: select only this image
      next = [imageId]
    }

    setSelectedImageIds(next)

    // Automatically activate guide mode when selecting an image
    setControlMode('guide')
  }

  const handleScanSelect = (scanId: string, event: React.MouseEvent) => {
    const clickedIndex = scans.findIndex((scan) => scan.id === scanId)
    let next: string[]

    if (event.metaKey || event.ctrlKey) {
      // Cmd/Ctrl+click: add/remove from selection
      if (selectedScanIds.includes(scanId)) {
        next = selectedScanIds.filter((id) => id !== scanId)
      } else {
        next = [...selectedScanIds, scanId]
      }
    } else if (event.shiftKey && selectedScanIds.length > 0) {
      // Shift+click: select range from last selected to clicked (Figma-style)
      const lastSelectedId = selectedScanIds[selectedScanIds.length - 1]
      const lastSelectedIndex = scans.findIndex((scan) => scan.id === lastSelectedId)

      if (lastSelectedIndex !== -1) {
        const start = Math.min(lastSelectedIndex, clickedIndex)
        const end = Math.max(lastSelectedIndex, clickedIndex)

        const rangeIds = []
        for (let i = start; i <= end; i++) {
          rangeIds.push(scans[i].id)
        }
        next = rangeIds
      } else {
        // Fallback if last selected not found
        next = [scanId]
      }
    } else {
      // Regular click: select only this scan
      next = [scanId]
    }

    setSelectedScanIds(next)

    // Automatically activate guide mode when selecting a scan
    setControlMode('guide')
  }

  const handleTreeSelectionChange = (selectedIds: string[]) => {
    const selectedId = selectedIds[0]
    if (!selectedId) {
      selectFloor(null)
      return
    }

    // Check if it's a level/floor ID
    const isLevel = levels.some((level) => level.id === selectedId)
    if (isLevel) {
      selectFloor(selectedId)
    }
  }

  const handleAddLevel = () => {
    // Get all existing level numbers (excluding base level which is 0)
    const levelNumbers = levels.map((l) => l.level || 0).filter((n) => n > 0)

    // Find the next available number (starting from 1)
    let nextNumber = 1
    while (levelNumbers.includes(nextNumber)) {
      nextNumber++
    }

    const newLevel = {
      id: createId('level'),
      type: 'level' as const,
      name: `level ${nextNumber}`,
      level: nextNumber,
      visible: true,
    }

    addLevel(newLevel)
    // Automatically select the newly created level
    selectFloor(newLevel.id)
  }

  const handleReorder = (newOrder: typeof levels) => {
    // Reassign level numbers based on new order (highest in list = highest level)
    // The visual order is reversed (highest level shown first), so we reverse the array
    // when assigning numbers
    const reversedOrder = [...newOrder].reverse()
    const updatedLevels = reversedOrder.map((level, index) => ({
      ...level,
      level: index,
    }))

    // Update levels in store
    reorderLevels(updatedLevels)

    // Update currentLevel if the selected floor's level changed
    if (selectedFloorId) {
      const newLevel = updatedLevels.find((l) => l.id === selectedFloorId)?.level
      if (newLevel !== undefined) {
        // Trigger selectFloor to ensure currentLevel is updated
        useEditor.getState().selectFloor(selectedFloorId)
      }
    }
  }

  // Get sorted levels for rendering
  const floorGroups = [...levels].sort((a, b) => (b.level || 0) - (a.level || 0))

  // Update expanded IDs when selection changes to reveal selected items
  useEffect(() => {
    const newExpanded = new Set(expandedIds)
    let hasChanges = false

    // Expand parents of selected elements (walls, roofs, columns, doors, windows)
    selectedElements.forEach((selectedId) => {
      // Find which level contains this element
      const levelId = components.find((c) => {
        if (c.type === 'wall' || c.type === 'roof' || c.type === 'column') {
          return c.data?.segments?.some?.((seg: any) => seg.id === selectedId)
        }
        // For doors/windows, find by their direct match
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

      // If it's a door or window, also expand its parent wall
      const component = components.find((c) => c.id === selectedId)
      if (component && (component.type === 'door' || component.type === 'window')) {
        const parentWallId = component?.data?.parentWallId
        if (parentWallId && !newExpanded.has(parentWallId)) {
          newExpanded.add(parentWallId)
          hasChanges = true
        }
      }
    })

    // Expand parents of selected images
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

    // Expand parents of selected scans
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

    if (hasChanges) {
      setExpandedIds(Array.from(newExpanded))
    }
  }, [selectedElements, selectedImageIds, selectedScanIds, components, images, scans, levels])

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
                      acc[type] = isSelected ? getElementsOfType(components, level.id, type) : []
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
                      controlMode={controlMode}
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
                      setBuildingElementOpacity={setBuildingElementOpacity}
                      setControlMode={setControlMode}
                      setFloorOpacity={setFloorOpacity}
                      setImageOpacity={setImageOpacity}
                      setScanOpacity={setScanOpacity}
                      setSelectedElements={setSelectedElements}
                      toggleBuildingElementVisibility={toggleBuildingElementVisibility}
                      toggleFloorVisibility={toggleFloorVisibility}
                      toggleImageVisibility={toggleImageVisibility}
                      toggleScanVisibility={toggleScanVisibility}
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
