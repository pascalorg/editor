"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { WallSegment } from "@/hooks/use-editor"
import { useEditorContext } from "@/hooks/use-editor"
import { 
  Layers, 
  Plus, 
  Trash2,
  Square,
  Image,
  Building,
  Upload
} from "lucide-react"
import {
  TreeProvider,
  TreeView,
  TreeNode,
  TreeNodeTrigger,
  TreeNodeContent,
  TreeExpander,
  TreeIcon,
  TreeLabel,
} from "@/components/tree"
import { cn } from "@/lib/utils"

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
    setSelectedWallIds(prev => {
      const next = new Set(prev)
      const clickedIndex = wallSegments.findIndex(seg => seg.id === wallId)

      if (event.metaKey || event.ctrlKey) {
        // Cmd/Ctrl+click: add/remove from selection
        if (next.has(wallId)) {
          next.delete(wallId)
        } else {
          next.add(wallId)
        }
      } else if (event.shiftKey && next.size > 0) {
        // Shift+click: select range between closest selected wall and clicked wall
        const selectedIndices = Array.from(next).map(id =>
          wallSegments.findIndex(seg => seg.id === id)
        ).filter(idx => idx !== -1)

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
    setSelectedImageIds(prev => {
      const next = new Set(prev)
      const clickedIndex = images.findIndex(img => img.id === imageId)

      if (event.metaKey || event.ctrlKey) {
        // Cmd/Ctrl+click: add/remove from selection
        if (next.has(imageId)) {
          next.delete(imageId)
        } else {
          next.add(imageId)
        }
      } else if (event.shiftKey && next.size > 0) {
        // Shift+click: select range
        const selectedIndices = Array.from(next).map(id =>
          images.findIndex(img => img.id === id)
        ).filter(idx => idx !== -1)

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
    const isLevel = groups.some(g => g.id === selectedId)
    if (isLevel) {
      selectFloor(selectedId)
    }
  }

  const handleAddLevel = () => {
    // Get all existing level numbers (excluding base level which is 0)
    const levelNumbers = groups
      .filter(g => g.type === 'floor')
      .map(g => g.level || 0)
      .filter(n => n > 0)

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
    <div className="px-2 py-2 flex flex-col flex-1">
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-muted-foreground">
          Levels ({mounted ? groups.filter(g => g.type === 'floor').length : 0})
        </label>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={handleAddLevel}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      
      <div className="flex-1 no-scrollbar">
        {!mounted ? (
          <div className="text-xs text-muted-foreground italic p-2">
            Loading...
          </div>
        ) : (
          <TreeProvider
            defaultExpandedIds={['level_0']}
            selectedIds={selectedFloorId ? [selectedFloorId] : []}
            onSelectionChange={handleTreeSelectionChange}
            multiSelect={false}
            indent={16}
            showLines={true}
          >
            <TreeView className="p-0">
              {groups
                .filter(g => g.type === 'floor')
                .sort((a, b) => (b.level || 0) - (a.level || 0)) // Reverse order: highest to lowest
                .map((level, levelIndex, levels) => {
                  const isSelected = selectedFloorId === level.id
                  const levelWalls = isSelected ? wallSegments : []
                  const isLastLevel = levelIndex === levels.length - 1
                  const hasContent = isSelected && (levelWalls.length > 0 || images.length > 0)
                  
                  return (
                    <TreeNode key={level.id} nodeId={level.id} isLast={isLastLevel}>
                      <TreeNodeTrigger className={cn(
                        isSelected && "sticky top-0 z-10 bg-background"
                      )}>
                        <TreeExpander hasChildren={hasContent} />
                        <TreeIcon 
                          icon={<Layers className="h-4 w-4 text-blue-500" />} 
                          hasChildren={hasContent}
                        />
                        <TreeLabel className="flex-1">{level.name}</TreeLabel>
                        {level.id !== 'level_0' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => {
                              e.stopPropagation()
                              deleteGroup(level.id)
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </TreeNodeTrigger>
                      
                      <TreeNodeContent hasChildren={hasContent}>
                        {/* 3D Objects Section */}
                        <TreeNode nodeId={`${level.id}-3d-objects`} level={1}>
                          <TreeNodeTrigger>
                            <TreeExpander hasChildren={levelWalls.length > 0} />
                            <TreeIcon 
                              icon={<Building className="h-4 w-4 text-green-500" />} 
                              hasChildren={levelWalls.length > 0}
                            />
                            <TreeLabel>3D Objects ({levelWalls.length})</TreeLabel>
                            {levelWalls.length > 0 && selectedWallIds.size > 0 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleDeleteSelectedWalls()
                                }}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </TreeNodeTrigger>
                          
                          <TreeNodeContent hasChildren={levelWalls.length > 0}>
                            {levelWalls.map((segment, index, walls) => (
                              <TreeNode 
                                key={segment.id} 
                                nodeId={segment.id}
                                level={2}
                                isLast={index === walls.length - 1}
                              >
                                <TreeNodeTrigger
                                  className={selectedWallIds.has(segment.id) ? 'bg-primary/30 border-l-2 border-primary' : ''}
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
                        <TreeNode nodeId={`${level.id}-guides`} level={1} isLast>
                          <TreeNodeTrigger>
                            <TreeExpander hasChildren={images.length > 0} />
                            <TreeIcon 
                              icon={<Image className="h-4 w-4 text-purple-500" />} 
                              hasChildren={images.length > 0}
                            />
                            <TreeLabel>Guides ({images.length})</TreeLabel>
                            {images.length > 0 && selectedImageIds.size > 0 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleDeleteSelectedImages()
                                }}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </TreeNodeTrigger>
                          
                          <TreeNodeContent hasChildren={images.length > 0}>
                            {/* Reference Image Upload Node */}
                            <TreeNode nodeId={`${level.id}-upload`} level={2}>
                              <TreeNodeTrigger>
                                <TreeExpander />
                                <TreeIcon icon={<Upload className="h-4 w-4 text-orange-500" />} />
                                <div className="flex-1">
                                  <Input
                                    type="file"
                                    accept="image/png,image/jpeg"
                                    onChange={(e) => { 
                                      const file = e.target.files?.[0]; 
                                      if (file) handleUpload(file); 
                                    }}
                                    className="w-full text-xs h-6 cursor-pointer"
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                </div>
                              </TreeNodeTrigger>
                            </TreeNode>
                            
                            {/* Reference Images */}
                            {images.map((image, index, imgs) => (
                              <TreeNode 
                                key={image.id} 
                                nodeId={image.id}
                                level={2}
                                isLast={index === imgs.length - 1}
                              >
                                <TreeNodeTrigger
                                  className={selectedImageIds.has(image.id) ? 'bg-primary/30 border-l-2 border-primary' : ''}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleImageSelect(image.id, e as any)
                                  }}
                                >
                                  <TreeExpander />
                                  <TreeIcon icon={<Image className="h-4 w-4 text-purple-400" />} />
                                  <div className="flex-1">
                                    <TreeLabel>Reference {index + 1}</TreeLabel>
                                    <div className="text-xs text-muted-foreground truncate">
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
        )}
      </div>
    </div>
  )
}
