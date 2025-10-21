"use client"

import { useEffect, useState } from "react"
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { Home, Settings, Upload, Download, HelpCircle, Trash2, Save, FolderOpen, FileCode, ChevronDown, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import type { WallSegment } from "@/hooks/use-editor"
import { useEditorContext } from "@/hooks/use-editor"
import JsonView from '@uiw/react-json-view'

export function AppSidebar() {
  const { 
    isHelpOpen, 
    setIsHelpOpen, 
    isJsonInspectorOpen, 
    setIsJsonInspectorOpen, 
    handleExport, 
    handleUpload, 
    wallSegments, 
    selectedWallIds, 
    setSelectedWallIds, 
    handleDeleteSelectedWalls, 
    handleSaveLayout, 
    handleLoadLayout, 
    serializeLayout, 
    handleClear,
    images,
    selectedImageIds,
    setSelectedImageIds,
    handleDeleteSelectedImages,
  } = useEditorContext()
  const [jsonCollapsed, setJsonCollapsed] = useState<boolean | number>(1)

  // Handle backspace key to delete selected walls
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Backspace' && selectedWallIds.size > 0) {
        event.preventDefault()
        handleDeleteSelectedWalls()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selectedWallIds, handleDeleteSelectedWalls])

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

  const formatWallDescription = (segment: WallSegment) => {
    const [x1, y1] = segment.start
    const [x2, y2] = segment.end
    
    const dx = Math.abs(x2 - x1)
    const dy = Math.abs(y2 - y1)
    const length = Math.sqrt(dx * dx + dy * dy) * 0.5 // 0.5m per grid spacing
    
    const orientation = segment.isHorizontal ? 'Horizontal' : 'Vertical'
    const position = `(${x1},${y1}) → (${x2},${y2})`
    
    return `${orientation} wall: ${length.toFixed(2)}m ${position}`
  }

  return (
    <Sidebar variant="floating">
      <SidebarHeader>
        <h3 className="text-lg font-semibold px-2">Pascal Editor</h3>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {/* Editor Controls */}
          <SidebarMenuItem>
            <div className="px-2 py-2">
              <label className="text-sm font-medium text-muted-foreground mb-2 block">
                Reference Image
              </label>
              <Input
                type="file"
                accept="image/png,image/jpeg"
                onChange={(e) => { const file = e.target.files?.[0]; if (file) handleUpload(file); }}
                className="w-full text-xs"
              />
            </div>
          </SidebarMenuItem>

          {/* Reference Images List */}
          <SidebarMenuItem>
            <div className="px-2 py-2">
              <label className="text-sm font-medium text-muted-foreground mb-2 block">
                Reference Images ({images.length})
              </label>
              <div className="max-h-48 overflow-y-auto space-y-1 select-none">
                {images.length === 0 ? (
                  <div className="text-xs text-muted-foreground italic">
                    No images uploaded yet
                  </div>
                ) : (
                  images.map((image, index) => (
                    <div
                      key={image.id}
                      className={`p-2 rounded text-xs cursor-pointer transition-colors select-none ${
                        selectedImageIds.has(image.id)
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted hover:bg-muted/80'
                      }`}
                      onClick={(e) => handleImageSelect(image.id, e)}
                    >
                      <div className="font-medium truncate" title={image.name}>
                        Image {index + 1}
                      </div>
                      <div className="text-muted-foreground truncate" title={image.name}>
                        {image.name}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </SidebarMenuItem>

          {/* Delete Selected Images Button */}
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={handleDeleteSelectedImages}
                disabled={selectedImageIds.size === 0}
              >
                <Trash2 className="h-4 w-4" />
                <span>Delete Selected Images ({selectedImageIds.size})</span>
              </Button>
            </SidebarMenuButton>
          </SidebarMenuItem>

          {/* Wall Segments List */}
          <SidebarMenuItem>
            <div className="px-2 py-2">
              <label className="text-sm font-medium text-muted-foreground mb-2 block">
                Wall Segments ({wallSegments.length})
              </label>
              <div className="max-h-48 overflow-y-auto space-y-1 select-none">
                {wallSegments.length === 0 ? (
                  <div className="text-xs text-muted-foreground italic">
                    No walls placed yet
                  </div>
                ) : (
                  wallSegments.map((segment, index) => (
                    <div
                      key={segment.id}
                      className={`p-2 rounded text-xs cursor-pointer transition-colors select-none ${
                        selectedWallIds.has(segment.id)
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted hover:bg-muted/80'
                      }`}
                      onClick={(e) => handleWallSelect(segment.id, e)}
                    >
                      <div className="font-medium">
                        Wall {index + 1}
                      </div>
                      <div className="text-muted-foreground">
                        {formatWallDescription(segment)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </SidebarMenuItem>

          {/* Delete Selected Walls Button */}
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={handleDeleteSelectedWalls}
                disabled={selectedWallIds.size === 0}
              >
                <Trash2 className="h-4 w-4" />
                <span>Delete Selected ({selectedWallIds.size})</span>
              </Button>
            </SidebarMenuButton>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={handleExport}
              >
                <Download className="h-4 w-4" />
                <span>Export 3D Model</span>
              </Button>
            </SidebarMenuButton>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={handleSaveLayout}
              >
                <Save className="h-4 w-4" />
                <span>Save Layout</span>
              </Button>
            </SidebarMenuButton>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={handleClear}
                disabled={wallSegments.length === 0}
              >
                <Trash2 className="h-4 w-4" />
                <span>Clear All ({wallSegments.length})</span>
              </Button>
            </SidebarMenuButton>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <div className="px-2 py-2">
              <label className="text-sm font-medium text-muted-foreground mb-2 block">
                Load Layout
              </label>
              <Input
                type="file"
                accept="application/json"
                onChange={(e) => { const file = e.target.files?.[0]; if (file) handleLoadLayout(file); }}
                className="w-full text-xs"
              />
            </div>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <Dialog open={isJsonInspectorOpen} onOpenChange={setIsJsonInspectorOpen}>
              <DialogTrigger asChild>
                <SidebarMenuButton asChild>
                  <Button variant="ghost" className="w-full justify-start gap-2">
                    <FileCode className="h-4 w-4" />
                    <span>Inspect JSON</span>
                  </Button>
                </SidebarMenuButton>
              </DialogTrigger>
              <DialogContent className="max-w-3xl max-h-[80vh] overflow-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center justify-between">
                    <span>Layout JSON Inspector</span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setJsonCollapsed(false)}
                        className="gap-1"
                      >
                        <ChevronDown className="h-3 w-3" />
                        Expand All
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setJsonCollapsed(true)}
                        className="gap-1"
                      >
                        <ChevronRight className="h-3 w-3" />
                        Collapse All
                      </Button>
                    </div>
                  </DialogTitle>
                  <DialogDescription>
                    View the raw JSON structure of your current layout
                  </DialogDescription>
                </DialogHeader>
                <div className="mt-4">
                  <JsonView 
                    value={serializeLayout()} 
                    collapsed={jsonCollapsed}
                    style={{
                      fontSize: '12px',
                    }}
                  />
                </div>
              </DialogContent>
            </Dialog>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <Dialog open={isHelpOpen} onOpenChange={setIsHelpOpen}>
              <DialogTrigger asChild>
                <SidebarMenuButton asChild>
                  <Button variant="ghost" className="w-full justify-start gap-2">
                    <HelpCircle className="h-4 w-4" />
                    <span>Help</span>
                  </Button>
                </SidebarMenuButton>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>House Builder Controls</DialogTitle>
                  <DialogDescription>
                    - Click on grid tiles to place or remove walls.<br/>
                    - Hold spacebar to enable camera controls (orbit, pan, zoom).<br/>
                    - Use Leva panel (top-right) to adjust wall height, tile size, grid visibility, etc.<br/>
                    - Upload PNG/JPEG floorplan images as reference.<br/>
                    - Adjust image position, scale, rotation, opacity in Leva 'Reference Image' section.<br/>
                    - Save your layout as JSON file for later use or database storage.<br/>
                    - Load previously saved layouts from JSON files.<br/>
                    - Inspect JSON to view the raw data structure of your current layout.<br/>
                    - Export your 3D model as GLB file.
                  </DialogDescription>
                </DialogHeader>
              </DialogContent>
            </Dialog>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarContent>
    </Sidebar>
  )
}
