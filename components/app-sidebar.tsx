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
import { useCallback, useEffect, useRef, useState } from 'react'
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
import { Switch } from '@/components/ui/switch'
import { useEditor } from '@/hooks/use-editor'
import { cn } from '@/lib/utils'

export function AppSidebar() {
  const isHelpOpen = useEditor((state) => state.isHelpOpen)
  const setIsHelpOpen = useEditor((state) => state.setIsHelpOpen)
  const isJsonInspectorOpen = useEditor((state) => state.isJsonInspectorOpen)
  const setIsJsonInspectorOpen = useEditor((state) => state.setIsJsonInspectorOpen)
  const handleExport = useEditor((state) => state.handleExport)
  const selectedNodeIds = useEditor((state) => state.selectedNodeIds)
  const handleDeleteSelected = useEditor((state) => state.handleDeleteSelected)
  const handleResetToDefault = useEditor((state) => state.handleResetToDefault)
  const serializeLayout = useEditor((state) => state.serializeLayout)
  const loadLayout = useEditor((state) => state.loadLayout)

  const [jsonCollapsed, setJsonCollapsed] = useState<boolean | number>(1)
  const [mounted, setMounted] = useState(false)
  const [excludeImages, setExcludeImages] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Sidebar resize state
  const [sidebarWidth, setSidebarWidth] = useState(256)
  const [isResizing, setIsResizing] = useState(false)

  const MIN_WIDTH = 200
  const MAX_WIDTH = 800

  // Wait for client-side hydration to complete before rendering store-dependent content
  useEffect(() => {
    setMounted(true)
  }, [])

  // Handle backspace key to delete selected elements
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Backspace' && selectedNodeIds.length > 0) {
        event.preventDefault()
        handleDeleteSelected()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selectedNodeIds, handleDeleteSelected])

  const handleLoadBuildClick = () => {
    fileInputRef.current?.click()
  }

  const handleSaveLayout = () => {
    let layout = serializeLayout()

    if (excludeImages) {
      // Deep clone to avoid mutating state
      layout = JSON.parse(JSON.stringify(layout))

      const filterNodes = (node: any) => {
        if (node.children && Array.isArray(node.children)) {
          node.children = node.children.filter((child: any) => child.type !== 'reference-image')
          node.children.forEach(filterNodes)
        }
      }

      if (layout.root) {
        filterNodes(layout.root)
      }
    }

    const blob = new Blob([JSON.stringify(layout, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `layout_${new Date().toISOString().split('T')[0]}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleFileLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && file.type === 'application/json') {
      const reader = new FileReader()
      reader.onload = (event) => {
        try {
          const json = JSON.parse(event.target?.result as string)
          loadLayout(json)
        } catch (error) {
          console.error('Failed to parse layout JSON:', error)
        }
      }
      reader.readAsText(file)
    }
  }

  // Resize functionality
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsResizing(true)
    e.preventDefault()
  }, [])

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return

      const gapX = 10
      const newWidth = e.clientX
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth + gapX)
      }
    },
    [isResizing],
  )

  const handleMouseUp = useCallback(() => {
    setIsResizing(false)
  }, [])

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'ew-resize'
      document.body.style.userSelect = 'none'
    } else {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing, handleMouseMove, handleMouseUp])

  return (
    <Sidebar
      className={cn('dark text-white')}
      style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
      variant="floating"
    >
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
            <DropdownMenuItem
              className="flex items-center justify-between"
              onSelect={(e) => {
                e.preventDefault()
                setExcludeImages(!excludeImages)
              }}
            >
              <span className="text-xs">Exclude Images</span>
              <Switch checked={excludeImages} className="scale-75" />
            </DropdownMenuItem>
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

      <SidebarContent className={cn('no-scrollbar flex flex-1 flex-col overflow-hidden')}>
        <SidebarMenu className="flex-1 overflow-hidden">
          {/* Tree-based Hierarchical Layers View */}
          <SidebarMenuItem className="flex h-full flex-1 flex-col overflow-hidden">
            <LayersMenu mounted={mounted} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarContent>

      {/* Hidden file input for Load Build */}
      <input
        accept="application/json"
        className="hidden"
        onChange={handleFileLoad}
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

      {/* Resize Handle */}
      <div
        className={cn(
          'absolute top-2.5 right-0 bottom-2.5 w-1 cursor-ew-resize bg-transparent hover:bg-blue-500/20',
          isResizing && 'bg-blue-500/40',
        )}
        onMouseDown={handleMouseDown}
        style={{ right: '8px' }}
      />
    </Sidebar>
  )
}
