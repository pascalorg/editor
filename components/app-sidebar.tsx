"use client"

import { useEffect } from "react"
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { Home, Settings, Upload, Download, HelpCircle, Trash2 } from "lucide-react"
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
import { useEditorContext, WallSegment } from "@/hooks/use-editor"

export function AppSidebar() {
  const { isHelpOpen, setIsHelpOpen, handleExport, handleUpload, wallSegments, selectedWallIds, setSelectedWallIds, handleDeleteSelectedWalls } = useEditorContext()

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

  const formatWallDescription = (segment: WallSegment) => {
    const length = segment.end - segment.start + 1
    const unit = segment.isHorizontal ? 'tiles wide' : 'tiles tall'
    const position = segment.isHorizontal
      ? `Row ${segment.fixed}, Cols ${segment.start}-${segment.end}`
      : `Col ${segment.fixed}, Rows ${segment.start}-${segment.end}`
    return `${length} ${unit} (${position})`
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
                onChange={handleUpload}
                className="w-full text-xs"
              />
            </div>
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
