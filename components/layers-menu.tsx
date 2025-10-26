'use client'

import { Building, Image, Layers, Plus, Square, Trash2, Upload } from 'lucide-react'
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
import type { WallSegment } from '@/hooks/use-editor'
import { useEditorContext } from '@/hooks/use-editor'
import { cn } from '@/lib/utils'

interface LayersMenuProps {
  mounted: boolean
}

export function LayersMenu({ mounted }: LayersMenuProps) {
  const {
    handleUpload,
    wallSegments,
    selectedWallIds,
    setSelectedWallIds,
    handleDeleteSelectedWalls,
    images,
    selectedImageIds,
    setSelectedImageIds,
    handleDeleteSelectedImages,
    groups,
    selectedFloorId,
    selectFloor,
    addGroup,
    deleteGroup,
  } = useEditorContext()

  const handleWallSelect = (wallId: string, event: React.MouseEvent) => {
    setSelectedWallIds((prev) => {
      const next = new Set(prev)
      const clickedIndex = wallSegments.findIndex((seg) => seg.id === wallId)

      if (event.metaKey || event.ctrlKey) {
        // Cmd/Ctrl+click: add/remove from selection
        if (next.has(wallId)) {
          next.delete(wallId)
        } else {
          next.add(wallId)
        }
      } else if (event.shiftKey && next.size > 0) {
        // Shift+click: select range between closest selected wall and clicked wall
        const selectedIndices = Array.from(next)
          .map((id) => wallSegments.findIndex((seg) => seg.id === id))
          .filter((idx) => idx !== -1)

        // Find closest selected wall index
        const closestSelectedIndex = selectedIndices.reduce((closest, current) => {
          const currentDist = Math.abs(current - clickedIndex)
          const closestDist = Math.abs(closest - clickedIndex)
          return currentDist < closestDist ? current : closest
        })

        // Select all walls between closest selected and clicked
        const start = Math.min(closestSelectedIndex, clickedIndex)
        const end = Math.max(closestSelectedIndex, clickedIndex)

        for (let i = start; i <= end; i++) {
          next.add(wallSegments[i].id)
        }
      } else {
        // Regular click: select only this wall
        next.clear()
        next.add(wallId)
      }

      return next
    })
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
        <Button className="h-6 w-6 p-0" onClick={handleAddLevel} size="sm" variant="ghost">
          <Plus className="h-4 w-4" />
        </Button>
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
                  const isLastLevel = levelIndex === levels.length - 1
                  const hasContent = isSelected && (levelWalls.length > 0 || images.length > 0)

                  return (
                    <TreeNode isLast={isLastLevel} key={level.id} nodeId={level.id}>
                      <TreeNodeTrigger
                        className={cn(isSelected && 'sticky top-0 z-10 bg-background')}
                      >
                        <TreeExpander hasChildren={hasContent} />
                        <TreeIcon
                          hasChildren={hasContent}
                          icon={<Layers className="h-4 w-4 text-blue-500" />}
                        />
                        <TreeLabel className="flex-1">{level.name}</TreeLabel>
                        {level.id !== 'level_0' && (
                          <Button
                            className="h-5 w-5 p-0 opacity-0 transition-opacity group-hover:opacity-100"
                            onClick={(e) => {
                              e.stopPropagation()
                              deleteGroup(level.id)
                            }}
                            size="sm"
                            variant="ghost"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </TreeNodeTrigger>

                      <TreeNodeContent hasChildren={hasContent}>
                        {/* 3D Objects Section */}
                        <TreeNode level={1} nodeId={`${level.id}-3d-objects`}>
                          <TreeNodeTrigger>
                            <TreeExpander hasChildren={levelWalls.length > 0} />
                            <TreeIcon
                              hasChildren={levelWalls.length > 0}
                              icon={<Building className="h-4 w-4 text-green-500" />}
                            />
                            <TreeLabel>3D Objects ({levelWalls.length})</TreeLabel>
                            {levelWalls.length > 0 && selectedWallIds.size > 0 && (
                              <Button
                                className="h-5 w-5 p-0 opacity-0 transition-opacity group-hover:opacity-100"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleDeleteSelectedWalls()
                                }}
                                size="sm"
                                variant="ghost"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </TreeNodeTrigger>

                          <TreeNodeContent hasChildren={levelWalls.length > 0}>
                            {levelWalls.map((segment, index, walls) => (
                              <TreeNode
                                isLast={index === walls.length - 1}
                                key={segment.id}
                                level={2}
                                nodeId={segment.id}
                              >
                                <TreeNodeTrigger
                                  className={
                                    selectedWallIds.has(segment.id)
                                      ? 'border-primary border-l-2 bg-primary/30'
                                      : ''
                                  }
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleWallSelect(segment.id, e as any)
                                  }}
                                >
                                  <TreeExpander />
                                  <TreeIcon icon={<Square className="h-4 w-4 text-gray-600" />} />
                                  <TreeLabel>Wall {index + 1}</TreeLabel>
                                </TreeNodeTrigger>
                              </TreeNode>
                            ))}
                          </TreeNodeContent>
                        </TreeNode>

                        {/* Guides Section */}
                        <TreeNode isLast level={1} nodeId={`${level.id}-guides`}>
                          <TreeNodeTrigger>
                            <TreeExpander hasChildren={images.length > 0} />
                            <TreeIcon
                              hasChildren={images.length > 0}
                              icon={<Image className="h-4 w-4 text-purple-500" />}
                            />
                            <TreeLabel>Guides ({images.length})</TreeLabel>
                            {images.length > 0 && selectedImageIds.size > 0 && (
                              <Button
                                className="h-5 w-5 p-0 opacity-0 transition-opacity group-hover:opacity-100"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleDeleteSelectedImages()
                                }}
                                size="sm"
                                variant="ghost"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </TreeNodeTrigger>

                          <TreeNodeContent hasChildren={images.length > 0}>
                            {/* Reference Image Upload Node */}
                            <TreeNode level={2} nodeId={`${level.id}-upload`}>
                              <TreeNodeTrigger>
                                <TreeExpander />
                                <TreeIcon icon={<Upload className="h-4 w-4 text-orange-500" />} />
                                <div className="flex-1">
                                  <Input
                                    accept="image/png,image/jpeg"
                                    className="h-6 w-full cursor-pointer text-xs"
                                    onChange={(e) => {
                                      const file = e.target.files?.[0]
                                      if (file) handleUpload(file)
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    type="file"
                                  />
                                </div>
                              </TreeNodeTrigger>
                            </TreeNode>

                            {/* Reference Images */}
                            {images.map((image, index, imgs) => (
                              <TreeNode
                                isLast={index === imgs.length - 1}
                                key={image.id}
                                level={2}
                                nodeId={image.id}
                              >
                                <TreeNodeTrigger
                                  className={
                                    selectedImageIds.has(image.id)
                                      ? 'border-primary border-l-2 bg-primary/30'
                                      : ''
                                  }
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleImageSelect(image.id, e as any)
                                  }}
                                >
                                  <TreeExpander />
                                  <TreeIcon icon={<Image className="h-4 w-4 text-purple-400" />} />
                                  <div className="flex-1">
                                    <TreeLabel>Reference {index + 1}</TreeLabel>
                                    <div className="truncate text-muted-foreground text-xs">
                                      {image.name}
                                    </div>
                                  </div>
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
