'use client'

import JsonView from '@uiw/react-json-view'
import {
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  FileCode,
  HelpCircle,
  Save,
  Settings,
  Trash2,
  Upload,
} from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { LayersMenu } from '@/components/layers-menu'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { useEditor } from '@/hooks/use-editor'
import { cn } from '@/lib/utils'

export function AppSidebar() {
  const isHelpOpen = useEditor((state) => state.isHelpOpen)
  const setIsHelpOpen = useEditor((state) => state.setIsHelpOpen)
  const isJsonInspectorOpen = useEditor((state) => state.isJsonInspectorOpen)
  const setIsJsonInspectorOpen = useEditor((state) => state.setIsJsonInspectorOpen)
  const handleExport = useEditor((state) => state.handleExport)
  const selectedElements = useEditor((state) => state.selectedElements)
  const handleDeleteSelectedElements = useEditor((state) => state.handleDeleteSelectedElements)
  const handleSaveLayout = useEditor((state) => state.handleSaveLayout)
  const handleLoadLayout = useEditor((state) => state.handleLoadLayout)
  const handleResetToDefault = useEditor((state) => state.handleResetToDefault)
  const serializeLayout = useEditor((state) => state.serializeLayout)
  const [jsonCollapsed, setJsonCollapsed] = useState<boolean | number>(1)
  const [mounted, setMounted] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Wait for client-side hydration to complete before rendering store-dependent content
  useEffect(() => {
    setMounted(true)
  }, [])

  // Handle backspace key to delete selected elements
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Backspace' && selectedElements.length > 0) {
        event.preventDefault()
        handleDeleteSelectedElements()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selectedElements, handleDeleteSelectedElements])

  const handleLoadBuildClick = () => {
    fileInputRef.current?.click()
  }

  return (
    <Sidebar className={cn('dark text-white')} variant="floating">
      <SidebarHeader className="flex-row items-center justify-between px-2 py-3">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-lg">Pascal Editor</h3>
          <Button asChild size="icon-sm" variant="ghost">
            <Link href="/viewer">
              <Eye className="h-4 w-4" />
            </Link>
          </Button>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost">
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
              className="text-destructive focus:text-destructive"
              onClick={handleResetToDefault}
            >
              <Trash2 className="h-4 w-4" />
              <span>Clear & Start New</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarHeader>

      <SidebarContent className={cn('no-scrollbar flex flex-1 flex-col')}>
        <SidebarMenu className="flex-1">
          {/* Tree-based Hierarchical Layers View */}
          <SidebarMenuItem className="flex flex-1 flex-col">
            <LayersMenu mounted={mounted} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarContent>

      {/* Hidden file input for Load Build */}
      <input
        accept="application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleLoadLayout(file)
        }}
        ref={fileInputRef}
        type="file"
      />

      {/* Dialogs */}
      <Dialog onOpenChange={setIsJsonInspectorOpen} open={isJsonInspectorOpen}>
        <DialogContent className="max-h-[80vh] max-w-3xl overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>Build Data Inspector</span>
              <div className="flex gap-2">
                <Button
                  className="gap-1"
                  onClick={() => setJsonCollapsed(false)}
                  size="sm"
                  variant="outline"
                >
                  <ChevronDown className="h-3 w-3" />
                  Expand All
                </Button>
                <Button
                  className="gap-1"
                  onClick={() => setJsonCollapsed(true)}
                  size="sm"
                  variant="outline"
                >
                  <ChevronRight className="h-3 w-3" />
                  Collapse All
                </Button>
              </div>
            </DialogTitle>
            <DialogDescription>View the raw JSON structure of your current build</DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            <JsonView
              collapsed={jsonCollapsed}
              style={{
                fontSize: '12px',
              }}
              value={serializeLayout()}
            />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setIsHelpOpen} open={isHelpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>House Builder Controls</DialogTitle>
            <DialogDescription>
              - Click on grid intersections to place walls using the building tools.
              <br />- Hold spacebar to enable camera controls (orbit, pan, zoom).
              <br />- Use control modes (Select/Delete/Building) to switch between different
              interactions.
              <br />- Create multiple levels and organize your 3D objects and guides within each
              level.
              <br />- Click on level names to select them and expand/collapse with the chevron
              icons.
              <br />- Upload PNG/JPEG reference images as guides within each level.
              <br />- Save your build as JSON file for later use or database storage.
              <br />- Load previously saved builds from JSON files.
              <br />- Inspect data to view the raw JSON structure of your current build.
              <br />- Export your 3D model as GLB file.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </Sidebar>
  )
}
