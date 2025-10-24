"use client"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { useEditorContext } from "@/hooks/use-editor"
import JsonView from '@uiw/react-json-view'
import { 
  ChevronDown, 
  ChevronRight, 
  Download, 
  FileCode, 
  HelpCircle, 
  Save, 
  Trash2
} from "lucide-react"
import { useEffect, useState } from "react"
import { LayersMenu } from "@/components/layers-menu"

export function AppSidebar() {
  const {
    isHelpOpen,
    setIsHelpOpen,
    isJsonInspectorOpen,
    setIsJsonInspectorOpen,
    handleExport,
    wallSegments,
    selectedWallIds,
    handleDeleteSelectedWalls,
    handleSaveLayout,
    handleLoadLayout,
    serializeLayout,
    handleClear,
  } = useEditorContext()
  const [jsonCollapsed, setJsonCollapsed] = useState<boolean | number>(1)
  const [mounted, setMounted] = useState(false)

  // Wait for client-side hydration to complete before rendering store-dependent content
  useEffect(() => {
    setMounted(true)
  }, [])

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

  return (
    <Sidebar variant="floating">
      <SidebarHeader>
        <h3 className="text-lg font-semibold px-2">Pascal Editor</h3>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {/* Tree-based Hierarchical Layers View */}
          <SidebarMenuItem>
            <LayersMenu mounted={mounted} />
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
                disabled={!mounted || wallSegments.length === 0}
              >
                <Trash2 className="h-4 w-4" />
                <span>Clear All ({mounted ? wallSegments.length : 0})</span>
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
                    - Click on grid intersections to place walls using the building tools.<br/>
                    - Hold spacebar to enable camera controls (orbit, pan, zoom).<br/>
                    - Use control modes (Select/Delete/Building) to switch between different interactions.<br/>
                    - Create multiple levels and organize your 3D objects and guides within each level.<br/>
                    - Click on level names to select them and expand/collapse with the chevron icons.<br/>
                    - Upload PNG/JPEG reference images as guides within each level.<br/>
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
