'use client'

import { Building, Eye, EyeOff, Image, Layers, Plus, Square, Triangle } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useEditorContext } from '@/hooks/use-editor'
import {
  type BuildingElementType,
  getElementIcon,
  getElementLabel,
  isElementSelected,
  selectElementRange,
  toggleElementSelection,
} from '@/lib/building-elements'
import { cn } from '@/lib/utils'

interface LayersMenuProps {
  mounted: boolean
}

export function LayersMenu({ mounted }: LayersMenuProps) {
  const {
    handleUpload,
    wallSegments,
    roofSegments,
    selectedElements,
    setSelectedElements,
    images,
    selectedImageIds,
    setSelectedImageIds,
    handleDeleteSelectedImages,
    groups,
    selectedFloorId,
    selectFloor,
    addGroup,
    deleteGroup,
    setControlMode,
    toggleFloorVisibility,
    toggleBuildingElementVisibility,
    toggleImageVisibility,
  } = useEditorContext()

  const handleElementSelect = (
    elementId: string,
    type: BuildingElementType,
    event: React.MouseEvent,
  ) => {
    const segments = type === 'wall' ? wallSegments : roofSegments

    if (event.metaKey || event.ctrlKey) {
      // Cmd/Ctrl+click: toggle selection
      const updatedSelection = toggleElementSelection(selectedElements, elementId, type, true)
      setSelectedElements(updatedSelection)
    } else if (event.shiftKey && selectedElements.length > 0) {
      // Shift+click: select range
      const updatedSelection = selectElementRange(selectedElements, segments, elementId, type)
      setSelectedElements(updatedSelection)
    } else {
      // Regular click: single select
      const updatedSelection = toggleElementSelection(selectedElements, elementId, type, false)
      setSelectedElements(updatedSelection)
    }

    // Automatically activate building mode when selecting a building element
    setControlMode('building')
  }

  const handleImageSelect = (imageId: string, event: React.MouseEvent) => {
    setSelectedImageIds((prev) => {
      const next = new Set(prev)
      const clickedIndex = images.findIndex((img) => img.id === imageId)

      if (event.metaKey || event.ctrlKey) {
        // Cmd/Ctrl+click: add/remove from selection
        if (next.has(imageId)) {
          next.delete(imageId)
        } else {
          next.add(imageId)
        }
      } else if (event.shiftKey && next.size > 0) {
        // Shift+click: select range
        const selectedIndices = Array.from(next)
          .map((id) => images.findIndex((img) => img.id === id))
          .filter((idx) => idx !== -1)

        const closestSelectedIndex = selectedIndices.reduce((closest, current) => {
          const currentDist = Math.abs(current - clickedIndex)
          const closestDist = Math.abs(closest - clickedIndex)
          return currentDist < closestDist ? current : closest
        })

        const start = Math.min(closestSelectedIndex, clickedIndex)
        const end = Math.max(closestSelectedIndex, clickedIndex)

        for (let i = start; i <= end; i++) {
          next.add(images[i].id)
        }
      } else {
        // Regular click: select only this image
        next.clear()
        next.add(imageId)
      }

      return next
    })

    // Automatically activate guide mode when selecting an image
    setControlMode('guide')
  }

  const handleTreeSelectionChange = (selectedIds: string[]) => {
    const selectedId = selectedIds[0]
    if (!selectedId) {
      selectFloor(null)
      return
    }

    // Check if it's a level/floor ID
    const isLevel = groups.some((g) => g.id === selectedId)
    if (isLevel) {
      selectFloor(selectedId)
    }
  }

  const handleAddLevel = () => {
    // Get all existing level numbers (excluding base level which is 0)
    const levelNumbers = groups
      .filter((g) => g.type === 'floor')
      .map((g) => g.level || 0)
      .filter((n) => n > 0)

    // Find the next available number (starting from 1)
    let nextNumber = 1
    while (levelNumbers.includes(nextNumber)) {
      nextNumber++
    }

    const newLevel = {
      id: `level_${nextNumber}`,
      name: `level ${nextNumber}`,
      type: 'floor' as const,
      color: '#ffffff',
      level: nextNumber,
      visible: true,
    }

    addGroup(newLevel)
    // Automatically select the newly created level
    selectFloor(newLevel.id)
  }

  return (
    <div className="flex flex-1 flex-col px-2 py-2">
      <div className="mb-2 flex items-center justify-between">
        <label className="font-medium text-muted-foreground text-sm">
          Levels ({mounted ? groups.filter((g) => g.type === 'floor').length : 0})
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
            defaultExpandedIds={['level_0']}
            indent={16}
            multiSelect={false}
            onSelectionChange={handleTreeSelectionChange}
            selectedIds={selectedFloorId ? [selectedFloorId] : []}
            showLines={true}
          >
            <TreeView className="p-0">
              {groups
                .filter((g) => g.type === 'floor')
                .sort((a, b) => (b.level || 0) - (a.level || 0)) // Reverse order: highest to lowest
                .map((level, levelIndex, levels) => {
                  const isSelected = selectedFloorId === level.id
                  const levelWalls = isSelected ? wallSegments : []
                  const levelRoofs = isSelected ? roofSegments : []
                  const levelImages = images.filter((img) => img.level === (level.level || 0))
                  const isLastLevel = levelIndex === levels.length - 1
                  const hasContent =
                    isSelected &&
                    (levelWalls.length > 0 || levelRoofs.length > 0 || levelImages.length > 0)

                  return (
                    <TreeNode isLast={isLastLevel} key={level.id} nodeId={level.id}>
                      <TreeNodeTrigger
                        className={cn(
                          isSelected && 'sticky top-0 z-10 bg-background',
                          level.visible === false && 'opacity-50',
                        )}
                      >
                        <TreeExpander hasChildren={hasContent} />
                        <TreeIcon
                          hasChildren={hasContent}
                          icon={<Layers className="h-4 w-4 text-blue-500" />}
                        />
                        <TreeLabel className="flex-1">{level.name}</TreeLabel>
                        <Button
                          className={cn(
                            'h-5 w-5 p-0 transition-opacity',
                            level.visible === false
                              ? 'opacity-100'
                              : 'opacity-0 group-hover/item:opacity-100',
                          )}
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleFloorVisibility(level.id)
                          }}
                          size="sm"
                          variant="ghost"
                        >
                          {level.visible === false ? (
                            <EyeOff className="h-3 w-3" />
                          ) : (
                            <Eye className="h-3 w-3" />
                          )}
                        </Button>
                      </TreeNodeTrigger>

                      <TreeNodeContent hasChildren={hasContent}>
                        {/* 3D Objects Section */}
                        <TreeNode level={1} nodeId={`${level.id}-3d-objects`}>
                          <TreeNodeTrigger>
                            <TreeExpander
                              hasChildren={levelWalls.length > 0 || levelRoofs.length > 0}
                            />
                            <TreeIcon
                              hasChildren={levelWalls.length > 0 || levelRoofs.length > 0}
                              icon={<Building className="h-4 w-4 text-green-500" />}
                            />
                            <TreeLabel>
                              3D Objects ({levelWalls.length + levelRoofs.length})
                            </TreeLabel>
                          </TreeNodeTrigger>

                          <TreeNodeContent
                            hasChildren={levelWalls.length > 0 || levelRoofs.length > 0}
                          >
                            {/* Walls */}
                            {levelWalls.map((segment, index, walls) => (
                              <TreeNode
                                isLast={index === walls.length - 1 && levelRoofs.length === 0}
                                key={segment.id}
                                level={2}
                                nodeId={segment.id}
                              >
                                <TreeNodeTrigger
                                  className={cn(
                                    isElementSelected(selectedElements, segment.id, 'wall') &&
                                      'bg-accent',
                                    segment.visible === false && 'opacity-50',
                                  )}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleElementSelect(segment.id, 'wall', e as any)
                                  }}
                                >
                                  <TreeExpander />
                                  <TreeIcon icon={<Square className="h-4 w-4 text-gray-600" />} />
                                  <TreeLabel>{getElementLabel('wall', index)}</TreeLabel>
                                  <Button
                                    className={cn(
                                      'h-5 w-5 p-0 transition-opacity',
                                      segment.visible === false
                                        ? 'opacity-100'
                                        : 'opacity-0 group-hover/item:opacity-100',
                                    )}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      toggleBuildingElementVisibility(segment.id, 'wall')
                                    }}
                                    size="sm"
                                    variant="ghost"
                                  >
                                    {segment.visible === false ? (
                                      <EyeOff className="h-3 w-3" />
                                    ) : (
                                      <Eye className="h-3 w-3" />
                                    )}
                                  </Button>
                                </TreeNodeTrigger>
                              </TreeNode>
                            ))}

                            {/* Roofs */}
                            {levelRoofs.map((segment, index, roofs) => (
                              <TreeNode
                                isLast={index === roofs.length - 1}
                                key={segment.id}
                                level={2}
                                nodeId={segment.id}
                              >
                                <TreeNodeTrigger
                                  className={cn(
                                    isElementSelected(selectedElements, segment.id, 'roof') &&
                                      'bg-accent',
                                    segment.visible === false && 'opacity-50',
                                  )}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleElementSelect(segment.id, 'roof', e as any)
                                  }}
                                >
                                  <TreeExpander />
                                  <TreeIcon
                                    icon={<Triangle className="h-4 w-4 text-amber-600" />}
                                  />
                                  <TreeLabel>{getElementLabel('roof', index)}</TreeLabel>
                                  <Button
                                    className={cn(
                                      'h-5 w-5 p-0 transition-opacity',
                                      segment.visible === false
                                        ? 'opacity-100'
                                        : 'opacity-0 group-hover/item:opacity-100',
                                    )}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      toggleBuildingElementVisibility(segment.id, 'roof')
                                    }}
                                    size="sm"
                                    variant="ghost"
                                  >
                                    {segment.visible === false ? (
                                      <EyeOff className="h-3 w-3" />
                                    ) : (
                                      <Eye className="h-3 w-3" />
                                    )}
                                  </Button>
                                </TreeNodeTrigger>
                              </TreeNode>
                            ))}
                          </TreeNodeContent>
                        </TreeNode>

                        {/* Guides Section */}
                        <TreeNode isLast level={1} nodeId={`${level.id}-guides`}>
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
                                      if (file) handleUpload(file, level.level || 0)
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

                          <TreeNodeContent hasChildren={levelImages.length > 0}>
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
                                    selectedImageIds.has(image.id) && 'bg-accent',
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
                                  <Button
                                    className={cn(
                                      'h-5 w-5 p-0 transition-opacity',
                                      image.visible === false
                                        ? 'opacity-100'
                                        : 'opacity-0 group-hover/item:opacity-100',
                                    )}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      toggleImageVisibility(image.id)
                                    }}
                                    size="sm"
                                    variant="ghost"
                                  >
                                    {image.visible === false ? (
                                      <EyeOff className="h-3 w-3" />
                                    ) : (
                                      <Eye className="h-3 w-3" />
                                    )}
                                  </Button>
                                </TreeNodeTrigger>
                              </TreeNode>
                            ))}
                          </TreeNodeContent>
                        </TreeNode>
                      </TreeNodeContent>
                    </TreeNode>
                  )
                })}
            </TreeView>
          </TreeProvider>
        ) : (
          <div className="p-2 text-muted-foreground text-xs italic">Loading...</div>
        )}
      </div>
    </div>
  )
}
