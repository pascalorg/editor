'use client'

import JsonView from '@uiw/react-json-view'
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import { IconRail, type PanelId } from '@/components/icon-rail'
import { CollectionsPanel, SettingsPanel, SitePanel, ZonesPanel } from '@/components/panels'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Sidebar, SidebarContent, SidebarHeader } from '@/components/ui/sidebar'
import { useEditor } from '@/hooks/use-editor'
import { cn } from '@/lib/utils'

export function AppSidebar() {
  const sidebarWidth = useEditor((state) => state.sidebarWidth)
  const setSidebarWidth = useEditor((state) => state.setSidebarWidth)
  const isHelpOpen = useEditor((state) => state.isHelpOpen)
  const setIsHelpOpen = useEditor((state) => state.setIsHelpOpen)
  const isJsonInspectorOpen = useEditor((state) => state.isJsonInspectorOpen)
  const setIsJsonInspectorOpen = useEditor((state) => state.setIsJsonInspectorOpen)
  const selectedNodeIds = useEditor((state) => state.selectedNodeIds)
  const handleDeleteSelected = useEditor((state) => state.handleDeleteSelected)
  const serializeLayout = useEditor((state) => state.serializeLayout)
  const activeTool = useEditor((state) => state.activeTool)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const setActiveTool = useEditor((state) => state.setActiveTool)
  const addCollection = useEditor((state) => state.addCollection)
  const collections = useEditor(useShallow((state) => state.scene.collections || []))
  const addToCollectionState = useEditor((state) => state.addToCollectionState)
  const cancelAddToCollection = useEditor((state) => state.cancelAddToCollection)

  const [jsonCollapsed, setJsonCollapsed] = useState<boolean | number>(1)
  const [mounted, setMounted] = useState(false)
  const [activePanel, setActivePanel] = useState<PanelId>('site')
  const [isResizing, setIsResizing] = useState(false)
  const sidebarRef = useRef<HTMLDivElement>(null)

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

  // Auto-switch to zones panel when zone tool is active
  useEffect(() => {
    if (activeTool === 'zone') {
      setActivePanel('zones')
    }
  }, [activeTool])

  // Handle mouse move during resize
  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(200, Math.min(600, e.clientX))
      setSidebarWidth(newWidth)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, setSidebarWidth])

  const renderPanelContent = () => {
    switch (activePanel) {
      case 'site':
        return <SitePanel mounted={mounted} />
      case 'zones':
        return <ZonesPanel />
      case 'collections':
        return <CollectionsPanel />
      case 'settings':
        return (
          <SettingsPanel
            onOpenHelp={() => setIsHelpOpen(true)}
            onOpenJsonInspector={() => setIsJsonInspectorOpen(true)}
          />
        )
      default:
        return null
    }
  }

  const getPanelTitle = () => {
    switch (activePanel) {
      case 'site':
        return 'Site'
      case 'zones':
        return 'Zones'
      case 'collections':
        return 'Collections'
      case 'settings':
        return 'Settings'
      default:
        return ''
    }
  }

  const handleAddZone = () => {
    if (selectedFloorId) {
      setActiveTool('zone')
    }
  }

  const handleAddCollection = () => {
    const existingNames = collections.map((c) => c.name)
    let counter = 1
    let newName = `Collection ${counter}`
    while (existingNames.includes(newName)) {
      counter++
      newName = `Collection ${counter}`
    }
    addCollection(newName)
  }

  const renderHeaderAction = () => {
    switch (activePanel) {
      case 'zones':
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="size-6 p-0"
                disabled={!selectedFloorId}
                onClick={handleAddZone}
                size="sm"
                variant="ghost"
              >
                <Plus className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {selectedFloorId ? 'Add new zone' : 'Select a level first'}
            </TooltipContent>
          </Tooltip>
        )
      case 'collections':
        if (addToCollectionState.isActive) {
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  className="size-6 p-0 text-destructive"
                  onClick={cancelAddToCollection}
                  size="sm"
                  variant="ghost"
                >
                  <X className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Cancel</TooltipContent>
            </Tooltip>
          )
        }
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="size-6 p-0"
                onClick={handleAddCollection}
                size="sm"
                variant="ghost"
              >
                <Plus className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Add new collection</TooltipContent>
          </Tooltip>
        )
      default:
        return null
    }
  }

  return (
    <Sidebar
      ref={sidebarRef}
      className={cn('dark text-white')}
      variant="floating"
      style={{
        width: `${sidebarWidth}px`,
        // Disable animations only when resizing for better performance
        ...(isResizing && {
          animationDuration: '0s',
          transitionDuration: '0s',
        }),
      }}
    >
      <div className="flex h-full relative">
        {/* Icon Rail */}
        <IconRail activePanel={activePanel} onPanelChange={setActivePanel} />

        {/* Panel Content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <SidebarHeader className="flex-row items-center justify-between px-3 py-2">
            <h3 className="font-semibold text-base">{getPanelTitle()}</h3>
            {renderHeaderAction()}
          </SidebarHeader>

          <SidebarContent className={cn('no-scrollbar flex flex-1 flex-col overflow-hidden')}>
            {renderPanelContent()}
          </SidebarContent>
        </div>

        {/* Resize Handle */}
        <div
          className="absolute top-0 bottom-0 right-0 w-1 bg-border cursor-col-resize hover:bg-accent z-50 opacity-0 hover:opacity-100 transition-opacity"
          onMouseDown={(e) => {
            e.preventDefault()
            setIsResizing(true)
          }}
        />
      </div>

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
