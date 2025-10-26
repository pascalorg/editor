"use client"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
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
  Settings,
  Trash2,
  Upload
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { LayersMenu } from "@/components/layers-menu"
import { cn } from "@/lib/utils"

export function AppSidebar() {
  const {
    isHelpOpen,
    setIsHelpOpen,
    isJsonInspectorOpen,
    setIsJsonInspectorOpen,
    handleExport,
    selectedWallIds,
    handleDeleteSelectedWalls,
    handleSaveLayout,
    handleLoadLayout,
    handleResetToDefault,
    serializeLayout,
  } = useEditorContext()
  const [jsonCollapsed, setJsonCollapsed] = useState<boolean | number>(1)
  const [mounted, setMounted] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  const handleLoadBuildClick = () => {
    fileInputRef.current?.click()
  }

  return (
    <Sidebar variant="floating" className={cn(
      'dark text-white',
      )}>
      <SidebarHeader className="flex-row items-center justify-between px-2 py-3">
        <h3 className="text-lg font-semibold">Pascal Editor</h3>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm">
              <Settings className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={handleExport}>
              <Download className="h-4 w-4" />
              <span>Export 3D Model</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSaveLayout}>
              <Save className="h-4 w-4" />
              <span>Save Build</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleLoadBuildClick}>
              <Upload className="h-4 w-4" />
              <span>Load Build</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setIsJsonInspectorOpen(true)}>
              <FileCode className="h-4 w-4" />
              <span>Inspect Data</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setIsHelpOpen(true)}>
              <HelpCircle className="h-4 w-4" />
              <span>Help</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem 
              onClick={handleResetToDefault}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
              <span>Clear & Start New</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu> 
      </SidebarHeader> 

      <SidebarContent className={cn(
      'flex-1 flex flex-col no-scrollbar')}>
        <SidebarMenu className="flex-1">
          {/* Tree-based Hierarchical Layers View */}
          <SidebarMenuItem className="flex-1 flex flex-col">
            <LayersMenu mounted={mounted} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarContent>

      {/* Hidden file input for Load Build */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleLoadLayout(file)
        }}
        className="hidden"
      />

      {/* Dialogs */}
      <Dialog open={isJsonInspectorOpen} onOpenChange={setIsJsonInspectorOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>Build Data Inspector</span>
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
              View the raw JSON structure of your current build
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

      <Dialog open={isHelpOpen} onOpenChange={setIsHelpOpen}>
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
              - Save your build as JSON file for later use or database storage.<br/>
              - Load previously saved builds from JSON files.<br/>
              - Inspect data to view the raw JSON structure of your current build.<br/>
              - Export your 3D model as GLB file.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </Sidebar>
  )
}
