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
import { useShallow } from 'zustand/react/shallow'
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
  isElementSelected,
  selectElementRange,
  toggleElementSelection,
} from '@/lib/building-elements'
import { cn } from '@/lib/utils'

const buildingElementConfig: Record<
  'wall' | 'roof' | 'column',
  {
    icon: ReactNode
    getLabel: (index: number) => string
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
}

interface LayersMenuProps {
  mounted: boolean
}

interface DraggableLevelItemProps {
  level: ComponentGroup
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
  handleElementSelect: (id: string, type: any, event: React.MouseEvent) => void
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
  handleUpload: (file: File, level: number) => void
  handleScanUpload: (file: File, level: number) => void
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
                return (
                  <TreeNode
                    isLast={
                      index === all.length - 1 &&
                      elementTypes.indexOf(type) === elementTypes.length - 1 &&
                      levelDoors.length === 0 &&
                      levelWindows.length === 0
                    }
                    key={element.id}
                    level={2}
                    nodeId={element.id}
                  >
                    <TreeNodeTrigger
                      className={cn(
                        isElementSelected(selectedElements, element.id, type) && 'bg-accent',
                        element.visible === false && 'opacity-50',
                      )}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleElementSelect(element.id, type, e as any)
                      }}
                    >
                      <TreeExpander />
                      <TreeIcon icon={config.icon} />
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
                  </TreeNode>
                )
              }),
            )}

            {/* Doors */}
            {levelDoors.map((door, index, doors) => (
              <TreeNode
                isLast={index === doors.length - 1 && levelWindows.length === 0}
                key={door.id}
                level={2}
                nodeId={door.id}
              >
                <TreeNodeTrigger
                  className={cn(selectedElements.find((el) => el.id === door.id) && 'bg-accent')}
                  onClick={(e) => {
                    e.stopPropagation()
                    // Select door for deletion
                    setSelectedElements([{ id: door.id, type: 'door' }])
                    setControlMode('building')
                  }}
                >
                  <TreeExpander />
                  <TreeIcon icon={<DoorOpen className="h-4 w-4 text-orange-600" />} />
                  <TreeLabel>Door {index + 1}</TreeLabel>
                </TreeNodeTrigger>
              </TreeNode>
            ))}

            {/* Windows */}
            {levelWindows.map((window, index, windows) => (
              <TreeNode
                isLast={index === windows.length - 1}
                key={window.id}
                level={2}
                nodeId={window.id}
              >
                <TreeNodeTrigger
                  className={cn(selectedElements.find((el) => el.id === window.id) && 'bg-accent')}
                  onClick={(e) => {
                    e.stopPropagation()
                    // Select window for deletion
                    setSelectedElements([{ id: window.id, type: 'window' }])
                    setControlMode('building')
                  }}
                >
                  <TreeExpander />
                  <TreeIcon icon={<RectangleVertical className="h-4 w-4 text-blue-500" />} />
                  <TreeLabel>Window {index + 1}</TreeLabel>
                </TreeNodeTrigger>
              </TreeNode>
            ))}
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
                      if (file) handleScanUpload(file, level.level || 0)
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
  const handleUpload = useEditor((state) => state.handleUpload)
  const handleScanUpload = useEditor((state) => state.handleScanUpload)
  const components = useEditor((state) => state.components)
  const selectedElements = useEditor((state) => state.selectedElements)
  const setSelectedElements = useEditor((state) => state.setSelectedElements)
  const images = useEditor((state) => state.images)
  const scans = useEditor((state) => state.scans)
  const selectedImageIds = useEditor((state) => state.selectedImageIds)
  const selectedScanIds = useEditor((state) => state.selectedScanIds)
  const setSelectedImageIds = useEditor((state) => state.setSelectedImageIds)
  const setSelectedScanIds = useEditor((state) => state.setSelectedScanIds)
  const handleDeleteSelectedImages = useEditor((state) => state.handleDeleteSelectedImages)
  const handleDeleteSelectedScans = useEditor((state) => state.handleDeleteSelectedScans)
  const groups = useEditor((state) => state.groups)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const selectFloor = useEditor((state) => state.selectFloor)
  const addGroup = useEditor((state) => state.addGroup)
  const deleteGroup = useEditor((state) => state.deleteGroup)
  const reorderGroups = useEditor((state) => state.reorderGroups)
  const setControlMode = useEditor((state) => state.setControlMode)
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

  const handleElementSelect = (
    elementId: string,
    type: BuildingElementType,
    event: React.MouseEvent,
  ) => {
    const segments = getAllElementsOfType(components, selectedFloorId || '', type)

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
      // Shift+click: select range
      const selectedIndices = selectedImageIds
        .map((id) => images.findIndex((img) => img.id === id))
        .filter((idx) => idx !== -1)

      const closestSelectedIndex = selectedIndices.reduce((closest, current) => {
        const currentDist = Math.abs(current - clickedIndex)
        const closestDist = Math.abs(closest - clickedIndex)
        return currentDist < closestDist ? current : closest
      })

      const start = Math.min(closestSelectedIndex, clickedIndex)
      const end = Math.max(closestSelectedIndex, clickedIndex)

      const rangeIds = []
      for (let i = start; i <= end; i++) {
        rangeIds.push(images[i].id)
      }
      next = [...new Set([...selectedImageIds, ...rangeIds])]
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
      // Shift+click: select range
      const selectedIndices = selectedScanIds
        .map((id) => scans.findIndex((scan) => scan.id === id))
        .filter((idx) => idx !== -1)

      const closestSelectedIndex = selectedIndices.reduce((closest, current) => {
        const currentDist = Math.abs(current - clickedIndex)
        const closestDist = Math.abs(closest - clickedIndex)
        return currentDist < closestDist ? current : closest
      })

      const start = Math.min(closestSelectedIndex, clickedIndex)
      const end = Math.max(closestSelectedIndex, clickedIndex)

      const rangeIds = []
      for (let i = start; i <= end; i++) {
        rangeIds.push(scans[i].id)
      }
      next = [...new Set([...selectedScanIds, ...rangeIds])]
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

  const handleReorder = (newOrder: typeof groups) => {
    // Reassign level numbers based on new order (highest in list = highest level)
    // The visual order is reversed (highest level shown first), so we reverse the array
    // when assigning numbers
    const reversedOrder = [...newOrder].reverse()
    const updatedFloorGroups = reversedOrder.map((group, index) => ({
      ...group,
      level: index,
    }))

    // Create a map of floor ID to old level and new level
    const oldLevelMap = new Map(
      groups.filter((g) => g.type === 'floor').map((g) => [g.id, g.level || 0]),
    )
    const newLevelMap = new Map(updatedFloorGroups.map((g) => [g.id, g.level!]))

    // Update images to use new level numbers
    const updatedImages = images.map((img) => {
      // Find which floor this image belongs to (by matching old level)
      const floorGroup = groups.find((g) => g.type === 'floor' && g.level === img.level)
      if (floorGroup && newLevelMap.has(floorGroup.id)) {
        return { ...img, level: newLevelMap.get(floorGroup.id)! }
      }
      return img
    })

    // Combine updated floor groups with non-floor groups
    const nonFloorGroups = groups.filter((g) => g.type !== 'floor')
    const allUpdatedGroups = [...updatedFloorGroups, ...nonFloorGroups]

    // Update groups and images in store
    reorderGroups(allUpdatedGroups)
    useEditor.getState().setImages(updatedImages, false)

    // Update currentLevel if the selected floor's level changed
    if (selectedFloorId) {
      const newLevel = updatedFloorGroups.find((g) => g.id === selectedFloorId)?.level
      if (newLevel !== undefined) {
        // Trigger selectFloor to ensure currentLevel is updated
        useEditor.getState().selectFloor(selectedFloorId)
      }
    }
  }

  // Get sorted floor groups for rendering
  const floorGroups = groups
    .filter((g) => g.type === 'floor')
    .sort((a, b) => (b.level || 0) - (a.level || 0))

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
